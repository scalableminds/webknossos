/**
 * data_layer.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import AsyncTaskQueue from "libs/async_task_queue";
import DataCube from "oxalis/model/bucket_data_handling/data_cube";
import PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";
import Mappings from "oxalis/model/bucket_data_handling/mappings";
import constants from "oxalis/constants";
import ConnectionInfo from "oxalis/model/data_connection_info";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import PriorityQueue from "js-priority-queue";
import { M4x4 } from "libs/mjs";
import determineBucketsForOrthogonal from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import { getBitDepth } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import { getAreas, getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import type { Vector3, Vector4, OrthoViewMapType, ModeType } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";
import type { AreaType } from "oxalis/model/accessors/flycam_accessor";
import {
  getResolutions,
  getLayerByName,
  getByteCount,
  getLayerBoundaries,
} from "oxalis/model/accessors/dataset_accessor.js";

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

function consumeBucketsFromPriorityQueue(queue, capacity) {
  const buckets = new Set();
  // Consume priority queue until we maxed out the capacity
  while (buckets.size < capacity) {
    if (queue.length === 0) {
      break;
    }
    const bucketWithPriority = queue.dequeue();
    buckets.add(bucketWithPriority.bucket);
  }
  return Array.from(buckets);
}

// TODO: Non-reactive
class DataLayer {
  cube: DataCube;
  layerInfo: DataLayerType;
  name: string;
  connectionInfo: ConnectionInfo;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  mappings: Mappings;
  activeMapping: ?string;
  lastSphericalCapRadius: number;
  // Indicates whether the current position is closer to the previous or next bucket for each dimension
  // For example, if the current position is [31, 10, 25] the value would be [1, -1, 1]
  lastSubBucketLocality: Vector3 = [-1, -1, -1];
  lastAreas: OrthoViewMapType<AreaType>;
  lastZoomedMatrix: M4x4;
  lastViewMode: ModeType;
  textureBucketManager: TextureBucketManager;
  textureWidth: number;
  dataTextureCount: number;

  anchorPointCache: {
    anchorPoint: Vector4,
    fallbackAnchorPoint: Vector4,
  } = {
    anchorPoint: [0, 0, 0, 0],
    fallbackAnchorPoint: [0, 0, 0, 0],
  };

  constructor(
    layerInfo: DataLayerType,
    connectionInfo: ConnectionInfo,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.layerInfo = layerInfo;
    this.connectionInfo = connectionInfo;

    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;

    this.name = layerInfo.name;

    const { dataset } = Store.getState();
    const bitDepth = getBitDepth(getLayerByName(dataset, this.name));

    this.cube = new DataCube(
      getLayerBoundaries(dataset, this.name).upperBoundary,
      layerInfo.resolutions.length,
      bitDepth,
      layerInfo.category === "segmentation",
    );

    const taskQueue = new AsyncTaskQueue(Infinity);

    const datastoreInfo = dataset.dataStore;
    this.pullQueue = new PullQueue(this.cube, layerInfo.name, this.connectionInfo, datastoreInfo);
    this.pushQueue = new PushQueue(this.cube, layerInfo, taskQueue);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    this.mappings = new Mappings(layerInfo.name);
    this.activeMapping = null;
  }

  isSegmentation() {
    return getLayerByName(Store.getState().dataset, this.name).category === "segmentation";
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
          this,
          bucketQueue,
          matrix,
          logZoomStep,
          fallbackZoomStep,
          isFallbackAvailable,
        );
      } else if (viewMode === constants.MODE_ARBITRARY) {
        determineBucketsForFlight(
          this,
          bucketQueue,
          matrix,
          logZoomStep,
          fallbackZoomStep,
          isFallbackAvailable,
        );
      } else {
        determineBucketsForOrthogonal(
          this,
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

      const buckets = consumeBucketsFromPriorityQueue(
        bucketQueue,
        this.textureBucketManager.maximumCapacity,
      );

      this.textureBucketManager.setActiveBuckets(
        buckets,
        this.anchorPointCache.anchorPoint,
        this.anchorPointCache.fallbackAnchorPoint,
      );

      // In general, pull buckets which are not available but should be sent to the GPU
      // Don't use -1 for ortho mode since this will make at the corner of the viewport more important than the ones in the middle
      const missingBucketPriority = constants.MODES_PLANE.includes(viewMode) ? 100 : -1;
      const missingBuckets = buckets
        .filter(bucket => !bucket.hasData())
        .filter(bucket => bucket.zoomedAddress[3] <= this.cube.MAX_UNSAMPLED_ZOOM_STEP)
        .map(bucket => ({ bucket: bucket.zoomedAddress, priority: missingBucketPriority }));
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

  setActiveMapping(mappingName: ?string): void {
    this.activeMapping = mappingName;
    this.mappings.activateMapping(mappingName);
  }
}

export default DataLayer;
