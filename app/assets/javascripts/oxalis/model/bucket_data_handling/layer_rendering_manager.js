// @flow

import _ from "lodash";
import Store from "oxalis/store";
import constants from "oxalis/constants";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import PriorityQueue from "js-priority-queue";
import { M4x4 } from "libs/mjs";
import determineBucketsForOrthogonal from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import { getAreas, getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import type { Vector3, Vector4, OrthoViewMapType, ModeType } from "oxalis/constants";
import type { AreaType } from "oxalis/model/accessors/flycam_accessor";
import { getResolutions, getByteCount } from "oxalis/model/accessors/dataset_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";

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
  lastAreas: OrthoViewMapType<AreaType>;
  lastZoomedMatrix: M4x4;
  lastViewMode: ModeType;
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

  setupDataTextures(): void {
    const bytes = getByteCount(Store.getState().dataset, this.name);

    this.textureBucketManager = new TextureBucketManager(
      constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION,
      this.textureWidth,
      this.dataTextureCount,
      bytes,
    );
    this.textureBucketManager.setupDataTextures(bytes);

    shaderEditor.addBucketManagers(this.textureBucketManager);
  }

  getDataTextures(): Array<*> {
    if (!this.textureBucketManager) {
      // Initialize lazily since SceneController.renderer is not available earlier
      this.setupDataTextures();
    }
    return this.textureBucketManager.getTextures();
  }

  // Returns the new anchorPoints if they are new
  updateDataTextures(position: Vector3, logZoomStep: number): [?Vector4, ?Vector4] {
    const unzoomedAnchorPoint = this.calculateUnzoomedAnchorPoint(position, logZoomStep);

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

    const subBucketLocality = getSubBucketLocality(
      position,
      getResolutions(Store.getState().dataset)[logZoomStep],
    );
    const areas = getAreas(Store.getState());

    const matrix = getZoomedMatrix(Store.getState().flycam);

    const { viewMode } = Store.getState().temporaryConfiguration;
    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const { sphericalCapRadius } = Store.getState().userConfiguration;
    if (
      isAnchorPointNew ||
      isFallbackAnchorPointNew ||
      !_.isEqual(areas, this.lastAreas) ||
      !_.isEqual(subBucketLocality, this.lastSubBucketLocality) ||
      (isArbitrary && !_.isEqual(this.lastZoomedMatrix, matrix)) ||
      viewMode !== this.lastViewMode ||
      sphericalCapRadius !== this.lastSphericalCapRadius
    ) {
      this.lastSubBucketLocality = subBucketLocality;
      this.lastAreas = areas;
      this.lastZoomedMatrix = matrix;
      this.lastViewMode = viewMode;
      this.lastSphericalCapRadius = sphericalCapRadius;

      const bucketQueue = new PriorityQueue({
        // small priorities take precedence
        comparator: (b, a) => b.priority - a.priority,
      });

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

      const bucketsWithPriorities = consumeBucketsFromPriorityQueue(
        bucketQueue,
        this.textureBucketManager.maximumCapacity,
      );

      this.textureBucketManager.setActiveBuckets(
        bucketsWithPriorities.map(({ bucket }) => bucket),
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

  calculateUnzoomedAnchorPoint(position: Vector3, logZoomStep: number): Vector3 {
    const resolution = getResolutions(Store.getState().dataset)[logZoomStep];
    const maximumRenderedBucketsHalf =
      (constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION - 1) * constants.BUCKET_WIDTH / 2;

    // Hit texture top-left coordinate
    const anchorPoint = [
      Math.floor(position[0] - maximumRenderedBucketsHalf * resolution[0]),
      Math.floor(position[1] - maximumRenderedBucketsHalf * resolution[1]),
      Math.floor(position[2] - maximumRenderedBucketsHalf * resolution[2]),
    ];
    return anchorPoint;
  }
}
