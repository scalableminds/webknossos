import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { Area } from "oxalis/model/accessors/flycam_accessor";
import { getAreasFromState, getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { Matrix4x4 } from "libs/mjs";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { getAddressSpaceDimensions } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getAnchorPositionToCenterDistance } from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import { map3 } from "libs/utils";
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
import Store, { SegmentMap } from "oxalis/store";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import UpdatableTexture from "libs/UpdatableTexture";
import type { ViewMode, OrthoViewMap, Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import window from "libs/window";
import DiffableMap from "libs/diffable_map";
import { CuckooTable } from "./cuckoo_table";
import { listenToStoreProperty } from "../helpers/listener_helpers";
import { diffSegmentLists } from "../sagas/volumetracing_saga";
import { getSegmentsForLayer } from "../accessors/volumetracing_accessor";

const CUSTOM_COLORS_TEXTURE_WIDTH = 512;

const asyncBucketPickRaw = createWorker(AsyncBucketPickerWorker);
const asyncBucketPick: typeof asyncBucketPickRaw = memoizeOne(
  asyncBucketPickRaw,
  (oldArgs, newArgs) => _.isEqual(oldArgs, newArgs),
);
const dummyBuffer = new ArrayBuffer(0);
export type EnqueueFunction = (arg0: Vector4, arg1: number) => void;

// each index of the returned Vector3 is either -1 or +1.
function getSubBucketLocality(position: Vector3, resolution: Vector3): Vector3 {
  // E.g., modAndDivide(63, 32) === 31 / 32 === ~0.97
  const modAndDivide = (a: number, b: number) => (a % b) / b;

  const roundToNearestBucketBoundary = (pos: Vector3, dimension: 0 | 1 | 2) => {
    const bucketExtentInVoxel = constants.BUCKET_WIDTH * resolution[dimension];
    // Math.round returns 0 or 1 which will be mapped to -1 or 1
    return Math.round(modAndDivide(pos[dimension], bucketExtentInVoxel)) * 2 - 1;
  };

  return map3((_pos, idx) => roundToNearestBucketBoundary(position, idx), position);
}

function consumeBucketsFromArrayBuffer(
  buffer: ArrayBuffer,
  cube: DataCube,
  capacity: number,
): Array<{
  priority: number;
  bucket: DataBucket;
}> {
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      // This tells the bucket collection, that the buckets are necessary for rendering
      bucket.markAsNeeded();
      bucketsWithPriorities.push({
        bucket,
        priority,
      });
    }

    currentElementIndex++;
  }

  return bucketsWithPriorities;
}

export default class LayerRenderingManager {
  lastSphericalCapRadius: number | undefined;
  // Indicates whether the current position is closer to the previous or next bucket for each dimension
  // For example, if the current position is [31, 10, 25] the value would be [1, -1, 1]
  lastSubBucketLocality: Vector3 = [-1, -1, -1];
  lastAreas: OrthoViewMap<Area> | undefined;
  lastZoomedMatrix: Matrix4x4 | undefined;
  lastViewMode: ViewMode | undefined;
  lastIsVisible: boolean | undefined;
  textureBucketManager!: TextureBucketManager;
  textureWidth: number;
  cube: DataCube;
  pullQueue: PullQueue;
  dataTextureCount: number;
  cachedAnchorPoint: Vector4 = [0, 0, 0, 0];
  name: string;
  needsRefresh: boolean = false;
  currentBucketPickerTick: number = 0;
  latestTaskExecutor: LatestTaskExecutor<ArrayBuffer> = new LatestTaskExecutor();

  cuckooTable: CuckooTable | undefined;
  storePropertyUnsubscribers: Array<() => void> = [];

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
    // @ts-ignore
    window.needsRerender = true;
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

    if (this.cube.isSegmentation) {
      this.listenToCustomSegmentColors();
    }
  }

  getDataTextures(): Array<THREE.DataTexture | UpdatableTexture> {
    if (!this.textureBucketManager) {
      // Initialize lazily since SceneController.renderer is not available earlier
      this.setupDataTextures();
    }

    return this.textureBucketManager.getTextures();
  }

  // Returns the new anchorPoints if they are new
  updateDataTextures(position: Vector3, logZoomStep: number): Vector4 | null | undefined {
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
        (buffer) => {
          this.cube.markBucketsAsUnneeded();
          const bucketsWithPriorities = consumeBucketsFromArrayBuffer(
            buffer,
            this.cube,
            this.textureBucketManager.maximumCapacity,
          );
          const buckets = bucketsWithPriorities.map(({ bucket }) => bucket);
          this.textureBucketManager.setActiveBuckets(
            buckets,
            this.cachedAnchorPoint,
            isAnchorPointNew,
          );
          // In general, pull buckets which are not available but should be sent to the GPU
          const missingBuckets = bucketsWithPriorities
            .filter(({ bucket }) => !bucket.hasData())
            .filter(({ bucket }) => resolutionInfo.hasIndex(bucket.zoomedAddress[3]))
            .map(({ bucket, priority }) => ({
              bucket: bucket.zoomedAddress,
              priority,
            }));
          this.pullQueue.addAll(missingBuckets);
          this.pullQueue.pull();
        },
        (reason) => {
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
      (bucketPerDim) => getAnchorPositionToCenterDistance(bucketPerDim) * constants.BUCKET_WIDTH,
    );
    // Hit texture top-left coordinate
    const anchorPointInVoxel = [
      position[0] - maximumRenderedBucketsHalfInVoxel[0] * resolution[0],
      position[1] - maximumRenderedBucketsHalfInVoxel[1] * resolution[1],
      position[2] - maximumRenderedBucketsHalfInVoxel[2] * resolution[2],
    ];
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
    const anchorPoint = this.cube.positionToZoomedAddress(anchorPointInVoxel, logZoomStep);

    if (_.isEqual(anchorPoint, this.cachedAnchorPoint)) {
      return false;
    }

    this.cachedAnchorPoint = anchorPoint;
    return true;
  }

  destroy() {
    this.storePropertyUnsubscribers.forEach((fn) => fn());
  }

  /* Methods related to custom segment colors: */

  getCustomColorCuckooTable() {
    if (this.cuckooTable != null) {
      return this.cuckooTable;
    }
    if (!this.cube.isSegmentation) {
      throw new Error(
        "getCustomColorCuckooTable should not be called for non-segmentation layers.",
      );
    }
    this.cuckooTable = new CuckooTable(CUSTOM_COLORS_TEXTURE_WIDTH);
    return this.cuckooTable;
  }

  listenToCustomSegmentColors() {
    let prevSegments: SegmentMap = new DiffableMap();
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getSegmentsForLayer(storeState, this.name),
        (newSegments) => {
          console.log("segments changed");
          const cuckoo = this.getCustomColorCuckooTable();
          for (const updateAction of diffSegmentLists(prevSegments, newSegments)) {
            if (
              updateAction.name === "updateSegment" ||
              updateAction.name === "createSegment" ||
              updateAction.name === "deleteSegment"
            ) {
              const { id } = updateAction.value;
              const color = "color" in updateAction.value ? updateAction.value.color : null;
              console.log(`${updateAction.name} for ${id}. color=${color || "null"}`);
              if (color != null) {
                cuckoo.set(
                  id,
                  map3((el) => el * 255, color),
                );
              } else {
                cuckoo.unset(id);
              }
            }
          }

          prevSegments = newSegments;
        },
      ),
    );
  }
}
