/**
 * binary.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import Store from "oxalis/store";
import type { CategoryType } from "oxalis/store";
import AsyncTaskQueue from "libs/async_task_queue";
import DataCube from "oxalis/model/binary/data_cube";
import PullQueue from "oxalis/model/binary/pullqueue";
import PushQueue from "oxalis/model/binary/pushqueue";
import {
  PingStrategy,
  SkeletonPingStrategy,
  VolumePingStrategy,
} from "oxalis/model/binary/ping_strategy";
import { PingStrategy3d, DslSlowPingStrategy3d } from "oxalis/model/binary/ping_strategy_3d";
import Mappings from "oxalis/model/binary/mappings";
import constants from "oxalis/constants";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import TextureBucketManager from "oxalis/model/binary/texture_bucket_manager";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import { getRenderer } from "oxalis/controller/renderer";
import UpdatableTexture from "libs/UpdatableTexture";
import {
  setMappingEnabledAction,
  setMappingSizeAction,
} from "oxalis/model/actions/settings_actions";
import PriorityQueue from "js-priority-queue";
import messages from "messages";
import { M4x4 } from "libs/mjs";
import determineBucketsForOrthogonal from "oxalis/model/binary/bucket_picker_strategies/orthogonal_bucket_picker";
import determineBucketsForOblique from "oxalis/model/binary/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForFlight from "oxalis/model/binary/bucket_picker_strategies/flight_bucket_picker";
import type { Vector3, Vector4, OrthoViewType, OrthoViewMapType, ModeType } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import type Layer from "oxalis/model/binary/layers/layer";
import type { AreaType } from "oxalis/model/accessors/flycam_accessor";
import { getAreas, getZoomedMatrix } from "./accessors/flycam_accessor";

const PING_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;
export const MAPPING_TEXTURE_WIDTH = 4096;

type PingOptions = {
  zoomStep: number,
  activePlane: OrthoViewType,
};

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
  lastSphericalCapRadius: number;
  // Indicates whether the current position is closer to the previous or next bucket for each dimension
  // For example, if the current position is [31, 10, 25] the value would be [1, -1, 1]
  lastSubBucketLocality: Vector3 = [-1, -1, -1];
  lastZoomStep: ?number;
  lastAreas: OrthoViewMapType<AreaType>;
  lastAreasPinged: OrthoViewMapType<AreaType>;
  lastZoomedMatrix: M4x4;
  lastViewMode: ModeType;
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

  constructor(
    layer: Layer,
    connectionInfo: ConnectionInfo,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.tracingType = Store.getState().tracing.type;
    this.layer = layer;
    this.connectionInfo = connectionInfo;

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

    this.cube = new DataCube(
      this.upperBoundary,
      layer.maxZoomStep + 1,
      this.layer.bitDepth,
      this.layer,
    );

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

    console.log("Create mapping texture");
    console.time("Time to create mapping texture");
    // $FlowFixMe Flow chooses the wrong library definition, because it doesn't seem to know that Object.keys always returns strings and throws an error
    const keys = Uint32Array.from(Object.keys(currentMapping), x => parseInt(x, 10));
    keys.sort();
    const values = Uint32Array.from(keys, key => currentMapping[key]);
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
    console.timeEnd("Time to create mapping texture");

    const mappingSize = keys.length;
    if (mappingSize > MAPPING_TEXTURE_WIDTH ** 2) {
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

  getByteCount(): number {
    return this.layer.bitDepth >> 3;
  }

  setupDataTextures(): void {
    const bytes = this.getByteCount();

    this.textureBucketManager = new TextureBucketManager(
      constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION,
      this.textureWidth,
      this.dataTextureCount,
      bytes,
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

    if (logZoomStep > this.cube.MAX_ZOOM_STEP) {
      // Don't render anything if the zoomStep is too high
      this.textureBucketManager.setActiveBuckets(
        [],
        this.anchorPointCache.anchorPoint,
        this.anchorPointCache.fallbackAnchorPoint,
      );
      return [this.anchorPointCache.anchorPoint, this.anchorPointCache.fallbackAnchorPoint];
    }

    const subBucketLocality = getSubBucketLocality(position, this.layer.resolutions[logZoomStep]);
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
      const missingBuckets = buckets
        .filter(bucket => !bucket.hasData())
        .map(bucket => ({ bucket: bucket.zoomedAddress, priority: -1 }));
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
        const buckets = strategy.ping(matrix, zoomStep);
        this.pullQueue.addAll(buckets);
        break;
      }
    }

    this.pullQueue.pull();
  }

  arbitraryPing = _.once(function(matrix: Matrix4x4, zoomStep: number) {
    this.arbitraryPing = _.throttle(this.arbitraryPingImpl, PING_THROTTLE_TIME);
    this.arbitraryPing(matrix, zoomStep);
  });
}

export default Binary;
