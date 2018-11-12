// @flow

import PriorityQueue from "js-priority-queue";
import * as THREE from "three";
import _ from "lodash";

import {
  type Area,
  getAreas,
  getMaxBucketCountPerDim,
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
  type Mode,
  type OrthoViewMap,
  type Vector3,
  type Vector4,
} from "oxalis/constants";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForOrthogonal, {
  getAnchorPositionToCenterDistance,
} from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import shaderEditor from "oxalis/model/helpers/shader_editor";

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
  queue: PriorityQueue,
  capacity: number,
): Array<{ priority: number, bucket: DataBucket }> {
  // Use bucketSet to only get unique buckets from the priority queue.
  // Don't use {bucket, priority} as set elements, as the instances will always be unique
  const bucketSet = new Set();
  const bucketsWithPriorities = [];
  // Consume priority queue until we maxed out the capacity
  while (bucketsWithPriorities.length < capacity) {
    if (queue.length === 0) {
      break;
    }
    const bucketWithPriority = queue.dequeue();
    if (!bucketSet.has(bucketWithPriority.bucket)) {
      bucketSet.add(bucketWithPriority.bucket);
      bucketsWithPriorities.push(bucketWithPriority);
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
  lastViewMode: Mode;
  lastIsInvisible: boolean;
  textureBucketManager: TextureBucketManager;
  textureWidth: number;
  cube: DataCube;
  pullQueue: PullQueue;
  dataTextureCount: number;
  anchorPointCache: {
    anchorPoint: Vector4,
    fallbackAnchorPoint: Vector4,
  } = {
    anchorPoint: [0, 0, 0, 0],
    fallbackAnchorPoint: [0, 0, 0, 0],
  };
  name: string;
  isSegmentation: boolean;
  needsRefresh: boolean = false;

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
    const bytes = getByteCount(Store.getState().dataset, this.name);
    const bucketsPerDim = getMaxBucketCountPerDim(Store.getState().dataset.dataSource.scale);

    this.textureBucketManager = new TextureBucketManager(
      bucketsPerDim,
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
  updateDataTextures(position: Vector3, logZoomStep: number): [?Vector4, ?Vector4] {
    const { dataset } = Store.getState();
    const unzoomedAnchorPoint = this.calculateUnzoomedAnchorPoint(
      position,
      logZoomStep,
      dataset.dataSource.scale,
    );

    const isAnchorPointNew = this.yieldsNewZoomedAnchorPoint(
      unzoomedAnchorPoint,
      logZoomStep,
      "anchorPoint",
    );
    const fallbackZoomStep = logZoomStep + 1;
    const isFallbackAvailable = fallbackZoomStep <= this.cube.MAX_ZOOM_STEP;
    const isFallbackAnchorPointNew =
      isFallbackAvailable &&
      this.yieldsNewZoomedAnchorPoint(unzoomedAnchorPoint, fallbackZoomStep, "fallbackAnchorPoint");

    if (logZoomStep > this.cube.MAX_ZOOM_STEP) {
      // Don't render anything if the zoomStep is too high
      this.textureBucketManager.setActiveBuckets(
        [],
        this.anchorPointCache.anchorPoint,
        this.anchorPointCache.fallbackAnchorPoint,
      );
      return [this.anchorPointCache.anchorPoint, this.anchorPointCache.fallbackAnchorPoint];
    }

    const subBucketLocality = getSubBucketLocality(position, getResolutions(dataset)[logZoomStep]);
    const areas = getAreas(Store.getState());

    const matrix = getZoomedMatrix(Store.getState().flycam);

    const { viewMode } = Store.getState().temporaryConfiguration;
    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const { sphericalCapRadius } = Store.getState().userConfiguration;
    const isInvisible =
      this.isSegmentation && Store.getState().datasetConfiguration.segmentationOpacity === 0;
    if (
      isAnchorPointNew ||
      isFallbackAnchorPointNew ||
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

      const bucketQueue = new PriorityQueue({
        // small priorities take precedence
        comparator: (b, a) => b.priority - a.priority,
      });

      if (!isInvisible) {
        if (viewMode === constants.MODE_ARBITRARY_PLANE) {
          determineBucketsForOblique(
            this.cube,
            bucketQueue,
            matrix,
            logZoomStep,
            fallbackZoomStep,
            isFallbackAvailable,
          );
        } else if (viewMode === constants.MODE_ARBITRARY) {
          determineBucketsForFlight(
            this.cube,
            bucketQueue,
            matrix,
            logZoomStep,
            fallbackZoomStep,
            isFallbackAvailable,
          );
        } else {
          determineBucketsForOrthogonal(
            Store.getState().dataset,
            this.cube,
            bucketQueue,
            logZoomStep,
            fallbackZoomStep,
            isFallbackAvailable,
            this.anchorPointCache.anchorPoint,
            this.anchorPointCache.fallbackAnchorPoint,
            areas,
            subBucketLocality,
          );
        }
      }

      const bucketsWithPriorities = consumeBucketsFromPriorityQueue(
        bucketQueue,
        this.textureBucketManager.maximumCapacity,
      );

      const buckets = bucketsWithPriorities.map(({ bucket }) => bucket);
      // This tells the bucket collection, that the buckets are necessary for rendering
      buckets.forEach(b => b.markAsNeeded());

      this.textureBucketManager.setActiveBuckets(
        buckets,
        this.anchorPointCache.anchorPoint,
        this.anchorPointCache.fallbackAnchorPoint,
      );

      // In general, pull buckets which are not available but should be sent to the GPU
      const missingBuckets = bucketsWithPriorities
        .filter(({ bucket }) => !bucket.hasData())
        .filter(({ bucket }) => bucket.zoomedAddress[3] <= this.cube.MAX_UNSAMPLED_ZOOM_STEP)
        .map(({ bucket, priority }) => ({ bucket: bucket.zoomedAddress, priority }));

      this.pullQueue.addAll(missingBuckets);
      this.pullQueue.pull();
    }

    return [this.anchorPointCache.anchorPoint, this.anchorPointCache.fallbackAnchorPoint];
  }

  yieldsNewZoomedAnchorPoint(
    unzoomedAnchorPoint: Vector3,
    logZoomStep: number,
    key: "fallbackAnchorPoint" | "anchorPoint",
  ): boolean {
    const zoomedAnchorPoint = this.cube.positionToZoomedAddress(unzoomedAnchorPoint, logZoomStep);
    if (_.isEqual(zoomedAnchorPoint, this.anchorPointCache[key])) {
      return false;
    }
    this.anchorPointCache[key] = zoomedAnchorPoint;
    return true;
  }

  calculateUnzoomedAnchorPoint(
    position: Vector3,
    logZoomStep: number,
    datasetScale: Vector3,
  ): Vector3 {
    const resolution = getResolutions(Store.getState().dataset)[logZoomStep];
    const bucketsPerDim = getMaxBucketCountPerDim(datasetScale);
    const maximumRenderedBucketsHalf = bucketsPerDim.map(
      bucketPerDim => getAnchorPositionToCenterDistance(bucketPerDim) * constants.BUCKET_WIDTH,
    );

    // Hit texture top-left coordinate
    const anchorPoint = [
      Math.floor(position[0] - maximumRenderedBucketsHalf[0] * resolution[0]),
      Math.floor(position[1] - maximumRenderedBucketsHalf[1] * resolution[1]),
      Math.floor(position[2] - maximumRenderedBucketsHalf[2] * resolution[2]),
    ];
    return anchorPoint;
  }
}
