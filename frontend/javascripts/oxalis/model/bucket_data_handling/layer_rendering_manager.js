// @flow

import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";

import {
  type Area,
  getAreasFromState,
  getZoomedMatrix,
} from "oxalis/model/accessors/flycam_accessor";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { M4x4 } from "libs/mjs";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { getAddressSpaceDimensions } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getAnchorPositionToCenterDistance } from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import {
  getResolutions,
  getByteCount,
  getElementClass,
  isLayerVisible,
  getLayerByName,
  getResolutionInfo,
  getDatasetResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import AsyncBucketPickerWorker from "oxalis/workers/async_bucket_picker.worker";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import LatestTaskExecutor, { SKIPPED_TASK_REASON } from "libs/latest_task_executor";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import Store from "oxalis/store";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import UpdatableTexture from "libs/UpdatableTexture";
import constants, {
  type ViewMode,
  type OrthoViewMap,
  type Vector3,
  type Vector4,
} from "oxalis/constants";
import shaderEditor from "oxalis/model/helpers/shader_editor";

const asyncBucketPick = memoizeOne(createWorker(AsyncBucketPickerWorker), (oldArgs, newArgs) =>
  _.isEqual(oldArgs, newArgs),
);
const dummyBuffer = new ArrayBuffer(0);

export type EnqueueFunction = (Vector4, number) => void;

// each index of the returned Vector3 is either -1 or +1.
function getSubBucketLocality(position: Vector3, resolution: Vector3): Vector3 {
  // E.g., modAndDivide(63, 32) === 31 / 32 === ~0.97
  const modAndDivide = (a, b) => (a % b) / b;
  const roundToNearestBucketBoundary = (pos, dimension) => {
    const bucketExtentInVoxel = constants.BUCKET_WIDTH * resolution[dimension];
    // Math.round returns 0 or 1 which will be mapped to -1 or 1
    return Math.round(modAndDivide(pos[dimension], bucketExtentInVoxel)) * 2 - 1;
  };

  // $FlowIssue[invalid-tuple-arity]
  return position.map((pos, idx) => roundToNearestBucketBoundary(position, idx));
}

function consumeBucketsFromArrayBuffer(
  buffer: ArrayBuffer,
  cube: DataCube,
  capacity: number,
): Array<{ priority: number, bucket: DataBucket }> {
  const bucketsWithPriorities = [];
  const uint32Array = new Uint32Array(buffer);

  let currentElementIndex = 0;
  const intsPerItem = 5; // [x, y, z, zoomStep, priority]

  // Consume priority queue until we maxed out the capacity
  while (bucketsWithPriorities.length < capacity) {
    const currentBufferIndex = currentElementIndex * intsPerItem;
    if (currentBufferIndex >= uint32Array.length) {
      break;
    }

    const bucketAddress = [
      uint32Array[currentBufferIndex],
      uint32Array[currentBufferIndex + 1],
      uint32Array[currentBufferIndex + 2],
      uint32Array[currentBufferIndex + 3],
    ];
    const priority = uint32Array[currentBufferIndex + 4];

    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      bucketsWithPriorities.push({ bucket, priority });
    }

    currentElementIndex++;
  }

  return bucketsWithPriorities;
}

export default class LayerRenderingManager {
  lastSphericalCapRadius: number;
  // Indicates whether the current position is closer to the previous or next bucket for each dimension
  // For example, if the current position is [31, 10, 25] the value would be [1, -1, 1]
  lastSubBucketLocality: Vector3 = [-1, -1, -1];
  lastAreas: OrthoViewMap<Area>;
  lastZoomedMatrix: typeof M4x4;
  lastViewMode: ViewMode;
  lastIsVisible: boolean;
  textureBucketManager: TextureBucketManager;
  textureWidth: number;
  cube: DataCube;
  pullQueue: PullQueue;
  dataTextureCount: number;
  cachedAnchorPoint: Vector4 = [0, 0, 0, 0];

  name: string;
  needsRefresh: boolean = false;
  currentBucketPickerTick: number = 0;
  latestTaskExecutor: LatestTaskExecutor<Function> = new LatestTaskExecutor();

  constructor(
    name: string,
    pullQueue: PullQueue,
    cube: DataCube,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.name = name;
    this.pullQueue = pullQueue;
    this.cube = cube;
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;
  }

  refresh() {
    this.needsRefresh = true;
  }

  setupDataTextures(): void {
    const { dataset } = Store.getState();
    const bytes = getByteCount(dataset, this.name);
    const elementClass = getElementClass(dataset, this.name);

    this.textureBucketManager = new TextureBucketManager(
      this.textureWidth,
      this.dataTextureCount,
      bytes,
      elementClass,
    );
    this.textureBucketManager.setupDataTextures(bytes);

    shaderEditor.addBucketManagers(this.textureBucketManager);
  }

  getDataTextures(): Array<typeof THREE.DataTexture | typeof UpdatableTexture> {
    if (!this.textureBucketManager) {
      // Initialize lazily since SceneController.renderer is not available earlier
      this.setupDataTextures();
    }
    return this.textureBucketManager.getTextures();
  }

  // Returns the new anchorPoints if they are new
  updateDataTextures(position: Vector3, logZoomStep: number): ?Vector4 {
    const state = Store.getState();
    const { dataset, datasetConfiguration } = state;
    const isAnchorPointNew = this.maybeUpdateAnchorPoint(position, logZoomStep);

    const layer = getLayerByName(dataset, this.name);
    const resolutionInfo = getResolutionInfo(layer.resolutions);
    const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
    const maximumResolutionIndex = resolutionInfo.getHighestResolutionIndex();

    if (logZoomStep > maximumResolutionIndex) {
      // Don't render anything if the zoomStep is too high
      this.textureBucketManager.setActiveBuckets([], this.cachedAnchorPoint, isAnchorPointNew);
      return this.cachedAnchorPoint;
    }

    const resolutions = getResolutions(dataset);
    const subBucketLocality = getSubBucketLocality(
      position,
      resolutionInfo.getResolutionByIndexWithFallback(logZoomStep, datasetResolutionInfo),
    );
    const areas = getAreasFromState(state);

    const matrix = getZoomedMatrix(state.flycam);

    const { viewMode } = state.temporaryConfiguration;
    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const { sphericalCapRadius } = state.userConfiguration;
    const isVisible = isLayerVisible(dataset, this.name, datasetConfiguration, viewMode);
    if (
      isAnchorPointNew ||
      !_.isEqual(areas, this.lastAreas) ||
      !_.isEqual(subBucketLocality, this.lastSubBucketLocality) ||
      (isArbitrary && !_.isEqual(this.lastZoomedMatrix, matrix)) ||
      viewMode !== this.lastViewMode ||
      sphericalCapRadius !== this.lastSphericalCapRadius ||
      isVisible !== this.lastIsVisible ||
      this.needsRefresh
    ) {
      this.lastSubBucketLocality = subBucketLocality;
      this.lastAreas = areas;
      this.lastZoomedMatrix = matrix;
      this.lastViewMode = viewMode;
      this.lastSphericalCapRadius = sphericalCapRadius;
      this.lastIsVisible = isVisible;
      this.needsRefresh = false;
      this.currentBucketPickerTick++;
      this.pullQueue.clear();

      let pickingPromise: Promise<ArrayBuffer> = Promise.resolve(dummyBuffer);

      if (isVisible) {
        const { initializedGpuFactor } = state.temporaryConfiguration.gpuSetup;
        pickingPromise = this.latestTaskExecutor.schedule(() =>
          asyncBucketPick(
            viewMode,
            resolutions,
            position,
            sphericalCapRadius,
            matrix,
            logZoomStep,
            datasetConfiguration.loadingStrategy,
            this.cachedAnchorPoint,
            areas,
            subBucketLocality,
            initializedGpuFactor,
          ),
        );
      }

      this.textureBucketManager.setAnchorPoint(this.cachedAnchorPoint);

      pickingPromise.then(
        buffer => {
          const bucketsWithPriorities = consumeBucketsFromArrayBuffer(
            buffer,
            this.cube,
            this.textureBucketManager.maximumCapacity,
          );

          const buckets = bucketsWithPriorities.map(({ bucket }) => bucket);
          this.cube.markBucketsAsUnneeded();
          // This tells the bucket collection, that the buckets are necessary for rendering
          buckets.forEach(b => b.markAsNeeded());

          this.textureBucketManager.setActiveBuckets(
            buckets,
            this.cachedAnchorPoint,
            isAnchorPointNew,
          );

          // In general, pull buckets which are not available but should be sent to the GPU
          const missingBuckets = bucketsWithPriorities
            .filter(({ bucket }) => !bucket.hasData())
            .filter(({ bucket }) => resolutionInfo.hasIndex(bucket.zoomedAddress[3]))
            .map(({ bucket, priority }) => ({ bucket: bucket.zoomedAddress, priority }));

          this.pullQueue.addAll(missingBuckets);
          this.pullQueue.pull();
        },
        reason => {
          if (reason.message !== SKIPPED_TASK_REASON) {
            throw reason;
          }
        },
      );
    }

    return this.cachedAnchorPoint;
  }

  maybeUpdateAnchorPoint(position: Vector3, logZoomStep: number): boolean {
    const state = Store.getState();
    const layer = getLayerByName(state.dataset, this.name);
    const resolutionInfo = getResolutionInfo(layer.resolutions);
    const datasetResolutionInfo = getDatasetResolutionInfo(state.dataset);

    const resolution = resolutionInfo.getResolutionByIndexWithFallback(
      logZoomStep,
      datasetResolutionInfo,
    );
    const addressSpaceDimensions = getAddressSpaceDimensions(
      state.temporaryConfiguration.gpuSetup.initializedGpuFactor,
    );

    const maximumRenderedBucketsHalfInVoxel = addressSpaceDimensions.map(
      bucketPerDim => getAnchorPositionToCenterDistance(bucketPerDim) * constants.BUCKET_WIDTH,
    );

    // Hit texture top-left coordinate
    const anchorPointInVoxel = [
      position[0] - maximumRenderedBucketsHalfInVoxel[0] * resolution[0],
      position[1] - maximumRenderedBucketsHalfInVoxel[1] * resolution[1],
      position[2] - maximumRenderedBucketsHalfInVoxel[2] * resolution[2],
    ];

    const anchorPoint = this.cube.positionToZoomedAddress(anchorPointInVoxel, logZoomStep);

    if (_.isEqual(anchorPoint, this.cachedAnchorPoint)) {
      return false;
    }
    this.cachedAnchorPoint = anchorPoint;
    return true;
  }
}
