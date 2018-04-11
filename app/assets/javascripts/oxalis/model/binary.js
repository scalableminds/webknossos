/**
 * binary.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import BackboneEvents from "backbone-events-standalone";
import Store from "oxalis/store";
import type { CategoryType } from "oxalis/store";
import AsyncTaskQueue from "libs/async_task_queue";
import InterpolationCollector from "oxalis/model/binary/interpolation_collector";
import DataCube from "oxalis/model/binary/data_cube";
import PullQueue, { PullQueueConstants } from "oxalis/model/binary/pullqueue";
import PushQueue from "oxalis/model/binary/pushqueue";
import {
  PingStrategy,
  SkeletonPingStrategy,
  VolumePingStrategy,
} from "oxalis/model/binary/ping_strategy";
import { PingStrategy3d, DslSlowPingStrategy3d } from "oxalis/model/binary/ping_strategy_3d";
import Mappings from "oxalis/model/binary/mappings";
import constants, { OrthoViewValuesWithoutTDView } from "oxalis/constants";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import TextureBucketManager from "oxalis/model/binary/texture_bucket_manager";
import Dimensions from "oxalis/model/dimensions";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import { DataBucket } from "oxalis/model/binary/bucket";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import { getRenderer } from "oxalis/controller/renderer";
import UpdatableTexture from "libs/UpdatableTexture";
import {
  setMappingEnabledAction,
  setMappingSizeAction,
} from "oxalis/model/actions/settings_actions";
import { getAreas } from "oxalis/model/accessors/flycam_accessor";
import { zoomedAddressToAnotherZoomStep } from "oxalis/model/helpers/position_converter";
import PriorityQueue from "js-priority-queue";
import messages from "messages";

import type { Vector3, Vector4, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import type Layer from "oxalis/model/binary/layers/layer";
import type { AreaType } from "oxalis/model/accessors/flycam_accessor";

const PING_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;
const MAPPING_TEXTURE_WIDTH = 4096;

type PingOptions = {
  zoomStep: number,
  activePlane: OrthoViewType,
};

// TODO: Non-reactive
class Binary {
  cube: DataCube;
  tracingType: string;
  layer: Layer;
  category: CategoryType;
  name: string;
  targetBitDepth: number;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  connectionInfo: ConnectionInfo;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  mappings: Mappings;
  pingStrategies: Array<PingStrategy>;
  pingStrategies3d: Array<PingStrategy3d>;
  direction: Vector3;
  activeMapping: ?string;
  lastPosition: ?Vector3;
  lastZoomStep: ?number;
  lastAreas: OrthoViewMapType<AreaType>;
  lastAreasPinged: OrthoViewMapType<AreaType>;
  textureBucketManager: TextureBucketManager;
  textureWidth: number;
  dataTextureCount: number;
  mappingTexture: UpdatableTexture;
  mappingLookupTexture: UpdatableTexture;

  anchorPointCache: {
    anchorPoint: Vector4,
    fallbackAnchorPoint: Vector4,
  } = {
    anchorPoint: [0, 0, 0, 0],
    fallbackAnchorPoint: [0, 0, 0, 0],
  };

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(
    layer: Layer,
    maxZoomStep: number,
    connectionInfo: ConnectionInfo,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.tracingType = Store.getState().tracing.type;
    this.layer = layer;
    this.connectionInfo = connectionInfo;
    _.extend(this, BackboneEvents);

    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;

    this.category = this.layer.category;
    this.name = this.layer.name;

    this.targetBitDepth = this.category === "color" ? this.layer.bitDepth : 8;

    const { topLeft, width, height, depth } = this.layer.boundingBox;
    this.lowerBoundary = topLeft;
    this.layer.lowerBoundary = topLeft;
    this.upperBoundary = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth];
    this.layer.upperBoundary = this.upperBoundary;

    this.cube = new DataCube(this.upperBoundary, maxZoomStep + 1, this.layer.bitDepth, this.layer);

    const taskQueue = new AsyncTaskQueue(Infinity);

    const dataset = Store.getState().dataset;
    if (dataset == null) {
      throw new Error("Dataset needs to be available before constructing the Binary.");
    }
    const datastoreInfo = dataset.dataStore;
    this.pullQueue = new PullQueue(this.cube, this.layer, this.connectionInfo, datastoreInfo);
    this.pushQueue = new PushQueue(this.cube, this.layer, taskQueue);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    this.mappings = new Mappings(datastoreInfo, this.layer);
    this.activeMapping = null;
    this.direction = [0, 0, 0];

    this.pingStrategies = [new SkeletonPingStrategy(this.cube), new VolumePingStrategy(this.cube)];
    this.pingStrategies3d = [new DslSlowPingStrategy3d(this.cube)];

    if (this.layer.dataStoreInfo.typ === "webknossos-store") {
      listenToStoreProperty(
        state => state.datasetConfiguration.fourBit,
        fourBit => this.layer.setFourBit(fourBit),
        true,
      );
    }
  }

  setupMappingTextures() {
    this.mappingTexture = createUpdatableTexture(
      MAPPING_TEXTURE_WIDTH,
      4,
      THREE.UnsignedByteType,
      getRenderer(),
    );
    this.mappingLookupTexture = createUpdatableTexture(
      MAPPING_TEXTURE_WIDTH,
      4,
      THREE.UnsignedByteType,
      getRenderer(),
    );

    this.cube.on({
      newMapping: () => this.updateMappingTextures(),
    });
  }

  updateMappingTextures(): void {
    const { currentMapping } = this.cube;
    if (currentMapping == null) return;

    // TODO: Remove timing code
    console.time("Time to create mapping texture");
    console.time("Time to create keys array");
    // $FlowFixMe Flow chooses the wrong library definition, because it doesn't seem to know that Object.keys always returns strings and throws an error
    const keys = Uint32Array.from(Object.keys(currentMapping), x => parseInt(x, 10));
    console.timeEnd("Time to create keys array");
    console.time("Time to sort keys array");
    keys.sort();
    console.timeEnd("Time to sort keys array");
    console.time("Time to create values array");
    const values = Uint32Array.from(keys, key => currentMapping[key]);
    console.timeEnd("Time to create values array");
    console.time("Time to convert to Uint8Arrays");
    // Instantiate the Uint8Arrays with the array buffer from the Uint32Arrays, so that each 32-bit value is converted
    // to four 8-bit values correctly
    const uint8Keys = new Uint8Array(keys.buffer);
    const uint8Values = new Uint8Array(values.buffer);
    // The typed arrays need to be padded with 0s so that their length is a multiple of MAPPING_TEXTURE_WIDTH
    const paddedLength = keys.length + MAPPING_TEXTURE_WIDTH - keys.length % MAPPING_TEXTURE_WIDTH;
    // The length of typed arrays cannot be changed, so we need to create new ones with the correct length
    const uint8KeysPadded = new Uint8Array(paddedLength * 4);
    uint8KeysPadded.set(uint8Keys);
    const uint8ValuesPadded = new Uint8Array(paddedLength * 4);
    uint8ValuesPadded.set(uint8Values);
    console.timeEnd("Time to convert to Uint8Arrays");
    console.timeEnd("Time to create mapping texture");

    const mappingSize = keys.length;
    if (mappingSize > MAPPING_TEXTURE_WIDTH * MAPPING_TEXTURE_WIDTH) {
      throw new Error(messages["mapping.too_big"]);
    }

    this.mappingLookupTexture.update(
      uint8KeysPadded,
      0,
      0,
      MAPPING_TEXTURE_WIDTH,
      uint8KeysPadded.length / MAPPING_TEXTURE_WIDTH / 4,
    );
    this.mappingTexture.update(
      uint8ValuesPadded,
      0,
      0,
      MAPPING_TEXTURE_WIDTH,
      uint8ValuesPadded.length / MAPPING_TEXTURE_WIDTH / 4,
    );

    Store.dispatch(setMappingEnabledAction(true));
    Store.dispatch(setMappingSizeAction(mappingSize));
  }

  getMappingTextures() {
    if (this.mappingTexture == null) {
      this.setupMappingTextures();
    }
    return [this.mappingTexture, this.mappingLookupTexture];
  }

  setupDataTextures(): void {
    const bytes = this.layer.bitDepth >> 3;

    this.textureBucketManager = new TextureBucketManager(
      constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION,
      this.textureWidth,
      this.dataTextureCount,
    );
    this.textureBucketManager.setupDataTextures(bytes, this.category);

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

    const areas = getAreas(Store.getState());

    if (isAnchorPointNew || isFallbackAnchorPointNew || !_.isEqual(areas, this.lastAreas)) {
      this.lastAreas = areas;
      const buckets = this.calculateBucketsForTexturesForManager(
        logZoomStep,
        this.anchorPointCache.anchorPoint,
        false,
        areas,
      );

      const fallbackBuckets = isFallbackAvailable
        ? this.calculateBucketsForTexturesForManager(
            logZoomStep + 1,
            this.anchorPointCache.fallbackAnchorPoint,
            true,
            areas,
          )
        : [];

      this.textureBucketManager.setActiveBuckets(
        buckets.concat(fallbackBuckets),
        this.anchorPointCache.anchorPoint,
        this.anchorPointCache.fallbackAnchorPoint,
      );
    }

    return [
      isAnchorPointNew ? this.anchorPointCache.anchorPoint : null,
      isFallbackAnchorPointNew ? this.anchorPointCache.fallbackAnchorPoint : null,
    ];
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
    const resolution = this.layer.resolutions[logZoomStep];
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

  calculateBucketsForTexturesForManager(
    logZoomStep: number,
    zoomedAnchorPoint: Vector4,
    isFallback: boolean,
    areas: OrthoViewMapType<AreaType>,
  ): Array<DataBucket> {
    // find out which buckets we need for each plane
    const requiredBucketSet = new Set();
    const resolution = this.layer.resolutions[logZoomStep];

    let resolutionChangeRatio = [1, 1, 1];
    if (isFallback) {
      const previousResolution = this.layer.resolutions[logZoomStep - 1];
      resolutionChangeRatio = [
        resolution[0] / previousResolution[0],
        resolution[1] / previousResolution[1],
        resolution[2] / previousResolution[2],
      ];
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const [u, v, w] = Dimensions.getIndices(planeId);

      const topLeftVector = [0, 0, 0, 0];
      topLeftVector[v] = areas[planeId].top;
      topLeftVector[u] = areas[planeId].left;

      const bottomRightVector = [0, 0, 0, 0];
      bottomRightVector[v] = areas[planeId].bottom;
      bottomRightVector[u] = areas[planeId].right;

      const scaledTopLeftVector = zoomedAddressToAnotherZoomStep(
        topLeftVector,
        this.layer.resolutions,
        logZoomStep,
      );
      const scaledBottomRightVector = zoomedAddressToAnotherZoomStep(
        bottomRightVector,
        this.layer.resolutions,
        logZoomStep,
      );

      const renderedBucketsPerDimension = Math.ceil(
        constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION / resolutionChangeRatio[w],
      );
      const topLeftBucket = zoomedAnchorPoint.slice();
      topLeftBucket[w] += Math.floor((renderedBucketsPerDimension - 1) / 2);

      const centerBucketUV = [
        scaledTopLeftVector[u] + (scaledBottomRightVector[u] - scaledTopLeftVector[u]) / 2,
        scaledTopLeftVector[v] + (scaledBottomRightVector[v] - scaledTopLeftVector[v]) / 2,
      ];

      // By subtracting and adding 1 to the bounds of y and x, we move
      // one additional bucket on each edge of the viewport to the GPU. This decreases the
      // chance of showing gray data, when moving the viewport. However, it might happen that
      // we do not have enough capacity to move these additional buckets to the GPU.
      // That's why, we are using a priority queue which orders buckets by manhattan distance to
      // the center bucket. We only consume that many items from the PQ, which we can handle on the
      // GPU.

      const bucketPQForCurrentPlane = new PriorityQueue({
        // small priorities take precedence
        comparator: (b, a) => b.priority - a.priority,
      });

      // Build up priority queue
      for (let y = scaledTopLeftVector[v] - 1; y <= scaledBottomRightVector[v] + 1; y++) {
        for (let x = scaledTopLeftVector[u] - 1; x <= scaledBottomRightVector[u] + 1; x++) {
          const bucketAddress = ((topLeftBucket.slice(): any): Vector4);
          bucketAddress[u] = x;
          bucketAddress[v] = y;

          const bucket = this.cube.getOrCreateBucket(bucketAddress);

          if (bucket.type !== "null") {
            const priority = Math.abs(x - centerBucketUV[0]) + Math.abs(y - centerBucketUV[1]);
            bucketPQForCurrentPlane.queue({
              priority,
              bucket,
            });
          }
        }
      }

      // Consume priority queue until we maxed out the bucket capacity
      let addedBucketCount = 0;
      while (addedBucketCount < constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION ** 2) {
        if (bucketPQForCurrentPlane.length === 0) {
          break;
        }
        const bucketWithPriority = bucketPQForCurrentPlane.dequeue();
        requiredBucketSet.add(bucketWithPriority.bucket);
        addedBucketCount++;
      }
    }
    return Array.from(requiredBucketSet);
  }

  setActiveMapping(mappingName: string): void {
    this.activeMapping = mappingName;

    const setMapping = mapping => {
      this.cube.setMapping(mapping);
    };

    if (mappingName != null) {
      this.mappings.getMappingAsync(mappingName).then(setMapping);
    } else {
      setMapping({});
    }
  }

  pingStop(): void {
    this.pullQueue.clearNormalPriorities();
  }

  ping = _.throttle(this.pingImpl, PING_THROTTLE_TIME);

  pingImpl(position: Vector3, { zoomStep, activePlane }: PingOptions): void {
    if (this.lastPosition != null) {
      this.direction = [
        (1 - DIRECTION_VECTOR_SMOOTHER) * this.direction[0] +
          DIRECTION_VECTOR_SMOOTHER * (position[0] - this.lastPosition[0]),
        (1 - DIRECTION_VECTOR_SMOOTHER) * this.direction[1] +
          DIRECTION_VECTOR_SMOOTHER * (position[1] - this.lastPosition[1]),
        (1 - DIRECTION_VECTOR_SMOOTHER) * this.direction[2] +
          DIRECTION_VECTOR_SMOOTHER * (position[2] - this.lastPosition[2]),
      ];
    }

    const areas = getAreas(Store.getState());

    if (
      !_.isEqual(position, this.lastPosition) ||
      zoomStep !== this.lastZoomStep ||
      !_.isEqual(areas, this.lastAreasPinged)
    ) {
      this.lastPosition = _.clone(position);
      this.lastZoomStep = zoomStep;
      this.lastAreasPinged = areas;

      for (const strategy of this.pingStrategies) {
        if (
          strategy.forContentType(this.tracingType) &&
          strategy.inVelocityRange(this.connectionInfo.bandwidth) &&
          strategy.inRoundTripTimeRange(this.connectionInfo.roundTripTime)
        ) {
          if (zoomStep != null && activePlane != null) {
            this.pullQueue.clearNormalPriorities();
            this.pullQueue.addAll(
              strategy.ping(position, this.direction, zoomStep, activePlane, areas),
            );
          }
          break;
        }
      }

      this.pullQueue.pull();
    }
  }

  arbitraryPingImpl(matrix: Matrix4x4, zoomStep: number): void {
    for (const strategy of this.pingStrategies3d) {
      if (
        strategy.forContentType(this.tracingType) &&
        strategy.inVelocityRange(1) &&
        strategy.inRoundTripTimeRange(this.pullQueue.roundTripTime)
      ) {
        this.pullQueue.clearNormalPriorities();
        this.pullQueue.addAll(strategy.ping(matrix, zoomStep));
        break;
      }
    }

    this.pullQueue.pull();
  }

  arbitraryPing = _.once(function(matrix: Matrix4x4, zoomStep: number) {
    this.arbitraryPing = _.throttle(this.arbitraryPingImpl, PING_THROTTLE_TIME);
    this.arbitraryPing(matrix, zoomStep);
  });

  getByVerticesSync(vertices: Array<number>): Uint8Array {
    // A synchronized implementation of `get`. Cuz its faster.

    const { buffer, missingBuckets } = InterpolationCollector.bulkCollect(
      vertices,
      this.cube.getArbitraryCube(),
    );

    this.pullQueue.addAll(
      missingBuckets.map(bucket => ({
        bucket,
        priority: PullQueueConstants.PRIORITY_HIGHEST,
      })),
    );
    this.pullQueue.pull();

    return buffer;
  }
}

export default Binary;
