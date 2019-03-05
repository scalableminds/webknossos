// @flow

import PriorityQueue from "js-priority-queue";
import * as THREE from "three";
import _ from "lodash";

import {
  type Area,
  getAreasFromState,
  getZoomedMatrix,
} from "oxalis/model/accessors/flycam_accessor";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { M4x4 } from "libs/mjs";
import { getResolutions, getByteCount } from "oxalis/model/accessors/dataset_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import Store from "oxalis/store";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import UpdatableTexture from "libs/UpdatableTexture";
import constants, {
  type ViewMode,
  type OrthoViewMap,
  type Vector3,
  type Vector4,
  addressSpaceDimensions,
} from "oxalis/constants";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForOrthogonal, {
  getAnchorPositionToCenterDistance,
} from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import shaderEditor from "oxalis/model/helpers/shader_editor";

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

  // $FlowFixMe
  return position.map((pos, idx) => roundToNearestBucketBoundary(position, idx));
}

function consumeBucketsFromPriorityQueue(
  queue: PriorityQueue<{ bucketAddress: Vector4, priority: number }>,
  cube: DataCube,
  capacity: number,
): Array<{ priority: number, bucket: DataBucket }> {
  const bucketsWithPriorities = [];
  // Consume priority queue until we maxed out the capacity
  while (bucketsWithPriorities.length < capacity) {
    if (queue.length === 0) {
      break;
    }
    const { bucketAddress, priority } = queue.dequeue();
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      bucketsWithPriorities.push({ bucket, priority });
    }
  }
  return bucketsWithPriorities;
}

export default class LayerRenderingManager {
  lastSphericalCapRadius: number;
  // Indicates whether the current position is closer to the previous or next bucket for each dimension
  // For example, if the current position is [31, 10, 25] the value would be [1, -1, 1]
  lastSubBucketLocality: Vector3 = [-1, -1, -1];
  lastAreas: OrthoViewMap<Area>;
  lastZoomedMatrix: M4x4;
  lastViewMode: ViewMode;
  lastIsInvisible: boolean;
  textureBucketManager: TextureBucketManager;
  textureWidth: number;
  cube: DataCube;
  pullQueue: PullQueue;
  dataTextureCount: number;
  cachedAnchorPoint: Vector4 = [0, 0, 0, 0];

  name: string;
  isSegmentation: boolean;
  needsRefresh: boolean = false;
  currentBucketPickerTick: number = 0;

  constructor(
    name: string,
    pullQueue: PullQueue,
    cube: DataCube,
    textureWidth: number,
    dataTextureCount: number,
    isSegmentation: boolean,
  ) {
    this.name = name;
    this.pullQueue = pullQueue;
    this.cube = cube;
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;
    this.isSegmentation = isSegmentation;
  }

  refresh() {
    this.needsRefresh = true;
  }

  setupDataTextures(): void {
    const { dataset } = Store.getState();
    const bytes = getByteCount(dataset, this.name);

    this.textureBucketManager = new TextureBucketManager(
      this.textureWidth,
      this.dataTextureCount,
      bytes,
    );
    this.textureBucketManager.setupDataTextures(bytes);

    shaderEditor.addBucketManagers(this.textureBucketManager);
  }

  getDataTextures(): Array<THREE.DataTexture | UpdatableTexture> {
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
    const fallbackZoomStep = logZoomStep + 1;
    const isFallbackAvailable = fallbackZoomStep <= this.cube.MAX_ZOOM_STEP;

    if (logZoomStep > this.cube.MAX_ZOOM_STEP) {
      // Don't render anything if the zoomStep is too high
      this.textureBucketManager.setActiveBuckets([], this.cachedAnchorPoint);
      return this.cachedAnchorPoint;
    }

    const subBucketLocality = getSubBucketLocality(position, getResolutions(dataset)[logZoomStep]);
    const areas = getAreasFromState(state);

    const matrix = getZoomedMatrix(state.flycam);

    const { viewMode } = state.temporaryConfiguration;
    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const { sphericalCapRadius } = state.userConfiguration;
    const isInvisible = this.isSegmentation && datasetConfiguration.segmentationOpacity === 0;
    if (
      isAnchorPointNew ||
      !_.isEqual(areas, this.lastAreas) ||
      !_.isEqual(subBucketLocality, this.lastSubBucketLocality) ||
      (isArbitrary && !_.isEqual(this.lastZoomedMatrix, matrix)) ||
      viewMode !== this.lastViewMode ||
      sphericalCapRadius !== this.lastSphericalCapRadius ||
      isInvisible !== this.lastIsInvisible ||
      this.needsRefresh
    ) {
      this.lastSubBucketLocality = subBucketLocality;
      this.lastAreas = areas;
      this.lastZoomedMatrix = matrix;
      this.lastViewMode = viewMode;
      this.lastSphericalCapRadius = sphericalCapRadius;
      this.lastIsInvisible = isInvisible;
      this.needsRefresh = false;
      this.currentBucketPickerTick++;
      this.pullQueue.clear();

      const bucketQueue = new PriorityQueue({
        // small priorities take precedence
        comparator: (b, a) => b.priority - a.priority,
      });
      const enqueueFunction = (bucketAddress, priority) => {
        bucketQueue.queue({ bucketAddress, priority });
      };

      if (!isInvisible) {
        const resolutions = getResolutions(dataset);
        if (viewMode === constants.MODE_ARBITRARY_PLANE) {
          determineBucketsForOblique(
            resolutions,
            position,
            enqueueFunction,
            matrix,
            logZoomStep,
            fallbackZoomStep,
            isFallbackAvailable,
          );
        } else if (viewMode === constants.MODE_ARBITRARY) {
          determineBucketsForFlight(
            resolutions,
            position,
            sphericalCapRadius,
            enqueueFunction,
            matrix,
            logZoomStep,
            fallbackZoomStep,
            isFallbackAvailable,
          );
        } else {
          determineBucketsForOrthogonal(
            resolutions,
            enqueueFunction,
            datasetConfiguration.loadingStrategy,
            logZoomStep,
            this.cachedAnchorPoint,
            areas,
            subBucketLocality,
          );
        }
      }

      const bucketsWithPriorities = consumeBucketsFromPriorityQueue(
        bucketQueue,
        this.cube,
        this.textureBucketManager.maximumCapacity,
      );

      const buckets = bucketsWithPriorities.map(({ bucket }) => bucket);
      this.cube.markBucketsAsUnneeded();
      // This tells the bucket collection, that the buckets are necessary for rendering
      buckets.forEach(b => b.markAsNeeded());

      this.textureBucketManager.setActiveBuckets(buckets, this.cachedAnchorPoint);

      // In general, pull buckets which are not available but should be sent to the GPU
      const missingBuckets = bucketsWithPriorities
        .filter(({ bucket }) => !bucket.hasData())
        .filter(({ bucket }) => bucket.zoomedAddress[3] <= this.cube.MAX_UNSAMPLED_ZOOM_STEP)
        .map(({ bucket, priority }) => ({ bucket: bucket.zoomedAddress, priority }));

      this.pullQueue.addAll(missingBuckets);
      this.pullQueue.pull();
    }

    return this.cachedAnchorPoint;
  }

  maybeUpdateAnchorPoint(position: Vector3, logZoomStep: number): boolean {
    const resolutions = getResolutions(Store.getState().dataset);
    const resolution = resolutions[logZoomStep];

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
