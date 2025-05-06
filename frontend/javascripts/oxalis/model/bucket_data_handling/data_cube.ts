import ErrorHandling from "libs/error_handling";
import { V3 } from "libs/mjs";
import type { ProgressCallback } from "libs/progress_callback";
import Toast from "libs/toast";
import {
  areBoundingBoxesOverlappingOrTouching,
  castForArrayType,
  isNumberMap,
  mod,
  union,
} from "libs/utils";
import _ from "lodash";
import { type Emitter, createNanoEvents } from "nanoevents";
import type {
  BoundingBoxType,
  BucketAddress,
  LabelMasksByBucketAndW,
  Vector3,
} from "oxalis/constants";
import constants, { MappingStatusEnum } from "oxalis/constants";
import Constants from "oxalis/constants";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type { Bucket, Containment } from "oxalis/model/bucket_data_handling/bucket";
import { DataBucket, NULL_BUCKET, NullBucket } from "oxalis/model/bucket_data_handling/bucket";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import type PushQueue from "oxalis/model/bucket_data_handling/pushqueue";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import type { DimensionMap } from "oxalis/model/dimensions";
import Dimensions from "oxalis/model/dimensions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import { VoxelNeighborQueue2D, VoxelNeighborQueue3D } from "oxalis/model/volumetracing/volumelayer";
import type { Mapping } from "oxalis/store";
import Store from "oxalis/store";
import * as THREE from "three";
import type { AdditionalAxis, BucketDataArray, ElementClass } from "types/api_types";
import type { AdditionalCoordinate } from "types/api_types";
import type { MagInfo } from "../helpers/mag_info";

const warnAboutTooManyAllocations = _.once(() => {
  const msg =
    "WEBKNOSSOS needed to allocate an unusually large amount of image data. It is advised to save your work and reload the page.";
  ErrorHandling.notify(new Error(msg));
  Toast.warning(msg, {
    sticky: true,
  });
});

class CubeEntry {
  data: Map<number, DataBucket>;
  boundary: Vector3;

  constructor(boundary: Vector3) {
    this.data = new Map();
    this.boundary = boundary;
  }
}

// Instead of using blank, constant thresholds for the bounding box which
// limits a floodfill operation, the bounding box can also be increased dynamically
// so that long, thin processes get a larger bounding box limit.
// If USE_FLOODFILL_VOXEL_THRESHOLD is true, the amount of labeled voxels is taken into account
// to increase the bounding box. However, the corresponding code can still run into
// scenarios where the labeled voxel count is significantly larger than the specified threshold,
// since the labeled volume has to be a cuboid.
// Also see: https://github.com/scalableminds/webknossos/issues/5769

const FLOODFILL_VOXEL_THRESHOLD = 5 * 1000000;
const USE_FLOODFILL_VOXEL_THRESHOLD = false;

const NoContainment = { type: "no" } as const;
const FullContainment = { type: "full" } as const;

const zeroToBucketWidth = (el: number) => {
  return el !== 0 ? el : Constants.BUCKET_WIDTH;
};
const makeLocalMin = (min: Vector3, mag: Vector3): Vector3 => {
  return [
    mod(Math.floor(min[0] / mag[0]), Constants.BUCKET_WIDTH),
    mod(Math.floor(min[1] / mag[1]), Constants.BUCKET_WIDTH),
    mod(Math.floor(min[2] / mag[2]), Constants.BUCKET_WIDTH),
  ];
};
const makeLocalMax = (max: Vector3, mag: Vector3): Vector3 => {
  return [
    zeroToBucketWidth(mod(Math.floor(max[0] / mag[0]), Constants.BUCKET_WIDTH)),
    zeroToBucketWidth(mod(Math.floor(max[1] / mag[1]), Constants.BUCKET_WIDTH)),
    zeroToBucketWidth(mod(Math.floor(max[2] / mag[2]), Constants.BUCKET_WIDTH)),
  ];
};

class DataCube {
  BUCKET_COUNT_SOFT_LIMIT = constants.MAXIMUM_BUCKET_COUNT_PER_LAYER;
  buckets: Array<DataBucket>;
  bucketIterator: number = 0;
  private cubes: Record<string, CubeEntry>;
  boundingBox: BoundingBox;
  additionalAxes: Record<string, AdditionalAxis>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'pullQueue' has no initializer and is not... Remove this comment to see the full error message
  pullQueue: PullQueue;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'pushQueue' has no initializer and is not... Remove this comment to see the full error message
  pushQueue: PushQueue;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'temporalBucketManager' has no initialize... Remove this comment to see the full error message
  temporalBucketManager: TemporalBucketManager;
  isSegmentation: boolean;
  elementClass: ElementClass;
  magInfo: MagInfo;
  layerName: string;
  emitter: Emitter;
  lastRequestForValueSet: number | null = null;
  storePropertyUnsubscribers: Array<() => void> = [];

  // The cube stores the buckets in a separate array for each zoomStep. For each
  // zoomStep the cube-array contains the boundaries and an array holding the buckets.
  // The bucket array is initialized as an empty array and grows dynamically. If the
  // length exceeds BUCKET_COUNT_SOFT_LIMIT, it is tried to garbage-collect an older
  // bucket when placing a new one. If this does not succeed (happens if all buckets
  // in a volume annotation layer are dirty), the array grows further.
  // If the array grows beyond 2 * BUCKET_COUNT_SOFT_LIMIT, the user is warned about
  // this.
  //
  // Each bucket consists of an access-value, the zoomStep and the actual data.
  // The access-values are used for garbage collection. When a bucket is accessed, its
  // access-flag is set to true.
  // When buckets have to be collected, an iterator will loop through the queue and the buckets at
  // the beginning of the queue will be removed from the queue and the access-value will
  // be decreased. If the access-value of a bucket becomes 0, it is no longer in the
  // access-queue and is least recently used. It is then removed from the cube.
  constructor(
    layerBBox: BoundingBox,
    additionalAxes: AdditionalAxis[],
    magInfo: MagInfo,
    elementClass: ElementClass,
    isSegmentation: boolean,
    layerName: string,
  ) {
    this.elementClass = elementClass;
    this.isSegmentation = isSegmentation;
    this.magInfo = magInfo;
    this.layerName = layerName;
    this.additionalAxes = _.keyBy(additionalAxes, "name");
    this.emitter = createNanoEvents();

    this.cubes = {};
    this.buckets = [];

    const shouldBeRestrictedByTracingBoundingBox = () => {
      const { task } = Store.getState();
      const isVolumeTask = task != null && task.type.tracingType === "volume";
      return !isVolumeTask;
    };

    // Satisfy TS. The actual initialization is done by listenToStoreProperty
    // (the second parameter ensures that the callback is called immediately).
    this.boundingBox = new BoundingBox(null);

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => getSomeTracing(state.annotation).boundingBox,
        (boundingBox) => {
          this.boundingBox = new BoundingBox(
            shouldBeRestrictedByTracingBoundingBox() ? boundingBox : null,
          ).intersectedWith(layerBBox);
        },
        true,
      ),
    );
  }

  initializeWithQueues(pullQueue: PullQueue, pushQueue: PushQueue): void {
    // Due to cyclic references, this method has to be called before the cube is
    // used with the instantiated queues
    this.pullQueue = pullQueue;
    this.pushQueue = pushQueue;
    this.temporalBucketManager = new TemporalBucketManager(this.pullQueue, this.pushQueue);
  }

  getNullBucket(): Bucket {
    return NULL_BUCKET;
  }

  isMappingEnabled(): boolean {
    const activeMapping = getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      this.layerName,
    );
    return this.isSegmentation ? activeMapping.mappingStatus === MappingStatusEnum.ENABLED : false;
  }

  getMapping(): Mapping | null | undefined {
    const activeMapping = getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      this.layerName,
    );
    return this.isSegmentation ? activeMapping.mapping : null;
  }

  shouldHideUnmappedIds(): boolean {
    const activeMapping = getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      this.layerName,
    );
    return this.isSegmentation && activeMapping.mappingStatus === MappingStatusEnum.ENABLED
      ? activeMapping.hideUnmappedIds
      : false;
  }

  mapId(unmappedId: number): number {
    // Note that the return value can be an unmapped id even when
    // a mapping is active, if it is a HDF5 mapping that is partially loaded
    // and no entry exists yet for the input id.
    let mappedId: number | null | undefined = null;
    const mapping = this.getMapping();

    if (mapping != null && this.isMappingEnabled()) {
      mappedId = isNumberMap(mapping)
        ? mapping.get(Number(unmappedId))
        : // TODO: Proper 64 bit support (#6921)
          Number(mapping.get(BigInt(unmappedId)));
    }
    if (mappedId == null || isNaN(mappedId)) {
      // The id couldn't be mapped.
      return this.shouldHideUnmappedIds() ? 0 : unmappedId;
    }

    return mappedId;
  }

  private getCubeKey(zoomStep: number, allCoords: AdditionalCoordinate[] | undefined | null) {
    if (allCoords == null) {
      // Instead of defaulting from null to [] for allCoords, we early-out with this simple
      // return value for performance reasons.
      return `${zoomStep}`;
    }
    const relevantCoords = allCoords.filter((coord) => this.additionalAxes[coord.name] != null);
    return [zoomStep, ...relevantCoords.map((el) => el.value)].join("-");
  }

  private checkContainment([x, y, z, zoomStep, coords]: BucketAddress): Containment {
    const cube = this.getOrCreateCubeEntry(zoomStep, coords);
    if (cube == null) {
      return NoContainment;
    }

    const mag = this.magInfo.getMagByIndex(zoomStep);
    if (mag == null) {
      return NoContainment;
    }

    const bucketBBox = BoundingBox.fromBucketAddressFast([x, y, z, zoomStep], mag);
    if (bucketBBox == null) {
      return NoContainment;
    }

    const intersectionBBox = this.boundingBox.intersectedWithFast(bucketBBox);

    if (
      intersectionBBox.min[0] === intersectionBBox.max[0] ||
      intersectionBBox.min[1] === intersectionBBox.max[1] ||
      intersectionBBox.min[2] === intersectionBBox.max[2]
    ) {
      return NoContainment;
    }
    if (
      V3.equals(intersectionBBox.min, bucketBBox.min) &&
      V3.equals(intersectionBBox.max, bucketBBox.max)
    ) {
      return FullContainment;
    }

    const { min, max } = intersectionBBox;

    return {
      type: "partial",
      min: makeLocalMin(min, mag),
      max: makeLocalMax(max, mag),
    };
  }

  getBucketIndexAndCube([x, y, z, zoomStep, coords]: BucketAddress): [
    number | null | undefined,
    CubeEntry | null,
  ] {
    const cube = this.getOrCreateCubeEntry(zoomStep, coords);

    if (cube != null) {
      const { boundary } = cube;
      const index = x * boundary[2] * boundary[1] + y * boundary[2] + z;
      return [index, cube];
    }

    return [null, null];
  }

  getOrCreateCubeEntry(
    zoomStep: number,
    coords: AdditionalCoordinate[] | null | undefined,
  ): CubeEntry | null {
    const cubeKey = this.getCubeKey(zoomStep, coords);
    if (this.cubes[cubeKey] == null) {
      const mag = this.magInfo.getMagByIndex(zoomStep);
      if (mag == null) {
        return null;
      }

      for (const coord of coords || []) {
        if (coord.name in this.additionalAxes) {
          const { bounds } = this.additionalAxes[coord.name];
          if (coord.value < bounds[0] || coord.value >= bounds[1]) {
            return null;
          }
        }
      }

      const zoomedCubeBoundary: Vector3 = [
        Math.ceil(this.boundingBox.max[0] / (constants.BUCKET_WIDTH * mag[0])) + 1,
        Math.ceil(this.boundingBox.max[1] / (constants.BUCKET_WIDTH * mag[1])) + 1,
        Math.ceil(this.boundingBox.max[2] / (constants.BUCKET_WIDTH * mag[2])) + 1,
      ];
      this.cubes[cubeKey] = new CubeEntry(zoomedCubeBoundary);
    }
    return this.cubes[cubeKey];
  }

  // Either returns the existing bucket or creates a new one. Only returns
  // NULL_BUCKET if the bucket cannot possibly exist, e.g. because it is
  // outside the dataset's bounding box.
  getOrCreateBucket(address: BucketAddress): Bucket {
    let bucket = this.getBucket(address);

    if (bucket instanceof NullBucket) {
      const containment = this.checkContainment(address);
      if (containment.type === "no") {
        return this.getNullBucket();
      }
      bucket = this.createBucket(address, containment);
    }

    return bucket;
  }

  // Returns the Bucket object if it exists, or NULL_BUCKET otherwise.
  getBucket(address: BucketAddress): Bucket {
    const [bucketIndex, cube] = this.getBucketIndexAndCube(address);

    if (bucketIndex != null && cube != null) {
      const bucket = cube.data.get(bucketIndex);

      // We double-check that the address of the bucket matches the requested
      // address. If the address is outside of the layer's bbox, the linearization
      // of the address into one index might collide with another bucket (that is
      // within the bbox) which is why the check is necessary.
      // We use slice to ignore the additional coordinates (this is mostly done
      // to ignore annoying cases like null vs [] which have identical semantics).
      if (bucket != null && _.isEqual(address.slice(0, 4), bucket.zoomedAddress.slice(0, 4))) {
        return bucket;
      }
    }

    return this.getNullBucket();
  }

  createBucket(address: BucketAddress, containment: Containment): Bucket {
    const bucket = new DataBucket(
      this.elementClass,
      address,
      this.temporalBucketManager,
      containment,
      this,
    );
    this.addBucketToGarbageCollection(bucket);
    const [bucketIndex, cube] = this.getBucketIndexAndCube(address);

    if (bucketIndex != null && cube != null) {
      cube.data.set(bucketIndex, bucket);
    }

    return bucket;
  }

  markBucketsAsUnneeded(): void {
    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i].markAsUnneeded();
    }
  }

  addBucketToGarbageCollection(bucket: DataBucket): void {
    if (this.buckets.length >= this.BUCKET_COUNT_SOFT_LIMIT) {
      let foundCollectibleBucket = false;

      for (let i = 0; i < this.buckets.length; i++) {
        this.bucketIterator = (this.bucketIterator + 1) % this.buckets.length;

        if (
          this.buckets[this.bucketIterator].mayBeGarbageCollected(
            // respectAccessedFlag=true because we don't want to GC buckets
            // that were used for rendering.
            true,
          )
        ) {
          foundCollectibleBucket = true;
          break;
        }
      }

      if (foundCollectibleBucket) {
        this.collectBucket(this.buckets[this.bucketIterator]);
      } else {
        const warnMessage = `More than ${this.buckets.length} buckets needed to be allocated.`;

        if (this.buckets.length % 100 === 0) {
          console.warn(warnMessage);
          ErrorHandling.notify(
            new Error(warnMessage),
            {
              elementClass: this.elementClass,
              isSegmentation: this.isSegmentation,
              magInfo: this.magInfo,
            },
            "warning",
          );
        }

        if (this.buckets.length > 2 * this.BUCKET_COUNT_SOFT_LIMIT) {
          warnAboutTooManyAllocations();
        }

        // Effectively, push to `this.buckets` by setting the iterator to
        // a new index.
        this.bucketIterator = this.buckets.length;
      }
    }

    this.buckets[this.bucketIterator] = bucket;
    // Note that bucketIterator is allowed to point to the next free
    // slot (i.e., bucketIterator == this.buckets.length).
    this.bucketIterator = (this.bucketIterator + 1) % (this.buckets.length + 1);
  }

  collectAllBuckets(): void {
    this.collectBucketsIf(() => true);
  }

  collectBucketsIf(predicateFn: (bucket: DataBucket) => boolean): void {
    // This method is always called in the context of reloading data.
    // All callers should ensure a saved state. This is encapsulated in the
    // api's reloadBuckets function that is used for most refresh-related
    // features (e.g., user-initiated reload, mapping saga).
    // Other than that, the function is only needed by the version restore view
    // for previewing data. In that context, a saved state is given, too.

    // We don't need to clear the pullQueue, because the bucket addresses in it weren't
    // even requested from the backend yet. The version look up for the actual request
    // happens *after* dequeuing. Also, clear() does not remove high-pri buckets anyway,
    // so we cannot rely on that.
    // However, we abort ongoing requests in the pullQueue as they might yield outdated
    // results. The buckets for which request(s) got aborted, will be marked as failed.
    // Typically, they will be refetched as soon as they are needed again.
    this.pullQueue.abortRequests();

    const notCollectedBuckets = [];
    for (const bucket of this.buckets) {
      if (
        // In addition to the given predicate...
        predicateFn(bucket) &&
        // ...we also call mayBeGarbageCollected() to find out whether we can GC the bucket.
        // The bucket should never be in the requested state, since we aborted the requests above
        // which will mark the bucket as failed. Using mayBeGarbageCollected guards us against
        // collecting unsaved buckets (that should never occur, though, because of the saved state
        // as explained above).
        bucket.mayBeGarbageCollected(
          // respectAccessedFlag=false because we don't care whether the bucket
          // was just used for rendering, as we reload data anyway.
          false,
        )
      ) {
        this.collectBucket(bucket);
      } else {
        notCollectedBuckets.push(bucket);
      }
    }

    this.buckets = notCollectedBuckets;
    this.bucketIterator = notCollectedBuckets.length;
  }

  triggerBucketDataChanged(): void {
    this.emitter.emit("bucketDataChanged");
  }

  shouldEagerlyMaintainUsedValueSet() {
    // The value set for all buckets in this cube should be maintained eagerly
    // if the valueSet was used within the last 2 minutes.
    return Date.now() - (this.lastRequestForValueSet || 0) < 2 * 60 * 1000;
  }

  getValueSetForAllBuckets(): Set<number> | Set<bigint> {
    this.lastRequestForValueSet = Date.now();

    // Theoretically, we could ignore coarser buckets for which we know that
    // finer buckets are already loaded. However, the current performance
    // is acceptable which is why this optimization isn't implemented.
    const valueSets = this.buckets
      .filter((bucket) => bucket.state === "LOADED")
      .map((bucket) => bucket.getValueSet());
    // @ts-ignore The buckets of a single layer all have the same element class, so they are all number or all bigint
    const valueSet = union(valueSets);
    return valueSet;
  }

  collectBucket(bucket: DataBucket): void {
    const address = bucket.zoomedAddress;
    const [bucketIndex, cube] = this.getBucketIndexAndCube(address);

    if (bucketIndex != null && cube != null) {
      bucket.destroy();
      cube.data.delete(bucketIndex);
    }
  }

  async _labelVoxelInResolution_DEPRECATED(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    label: number,
    zoomStep: number,
    activeSegmentId: number | null | undefined,
  ): Promise<void> {
    // This function is only provided for testing purposes and should not be used internally,
    // since it only operates on one voxel and therefore is not performance-optimized. It should
    // be refactored away.
    // Please make use of a LabeledVoxelsMap instead.
    const voxelInCube = this.boundingBox.containsPoint(voxel);

    if (voxelInCube) {
      const address = this.positionToZoomedAddress(voxel, additionalCoordinates, zoomStep);
      const bucket = this.getOrCreateBucket(address);

      if (bucket instanceof DataBucket) {
        const voxelIndex = this.getVoxelIndex(voxel, zoomStep);
        let shouldUpdateVoxel = true;

        if (activeSegmentId != null) {
          const voxelValue = this.getMappedDataValue(voxel, additionalCoordinates, zoomStep);
          shouldUpdateVoxel = activeSegmentId === voxelValue;
        }

        if (shouldUpdateVoxel) {
          const labelFunc = (data: BucketDataArray): void => {
            data[voxelIndex] = label;
          };

          await bucket.label_DEPRECATED(labelFunc);
        }
      }
    }
  }

  async floodFill(
    globalSeedVoxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    segmentIdNumber: number,
    dimensionIndices: DimensionMap,
    _floodfillBoundingBox: BoundingBoxType,
    zoomStep: number,
    progressCallback: ProgressCallback,
    use3D: boolean,
    splitBoundaryMesh: THREE.Mesh | null,
  ): Promise<{
    bucketsWithLabeledVoxelsMap: LabelMasksByBucketAndW;
    wasBoundingBoxExceeded: boolean;
    coveredBoundingBox: BoundingBoxType;
  }> {
    // This flood-fill algorithm works in two nested levels and uses a list of buckets to flood fill.
    // On the inner level a bucket is flood-filled  and if the iteration of the buckets data
    // reaches a neighbour bucket, this bucket is added to this list of buckets to flood fill.
    // The outer level simply iterates over all  buckets in the list and triggers the bucket-wise flood fill.
    // Additionally a map is created that saves all labeled voxels for each bucket. This map is returned at the end.
    //
    // Note: It is possible that a bucket is added multiple times to the list of buckets. This is intended
    // because a border of the "neighbour volume shape" might leave the neighbour bucket and enter it somewhere else.
    // If it would not be possible to have the same neighbour bucket in the list multiple times,
    // not all of the target area in the neighbour bucket might be filled.

    const floodfillBoundingBox = new BoundingBox(_floodfillBoundingBox);

    // Helper function to convert between xyz and uvw (both directions)
    const transpose = (voxel: Vector3): Vector3 =>
      Dimensions.transDimWithIndices(voxel, dimensionIndices);

    const bucketsWithLabeledVoxelsMap: LabelMasksByBucketAndW = new Map();
    const seedBucketAddress = this.positionToZoomedAddress(
      globalSeedVoxel,
      additionalCoordinates,
      zoomStep,
    );
    const seedBucket = this.getOrCreateBucket(seedBucketAddress);
    const coveredBBoxMin: Vector3 = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const coveredBBoxMax: Vector3 = [0, 0, 0];

    if (seedBucket.type === "null") {
      return {
        bucketsWithLabeledVoxelsMap,
        wasBoundingBoxExceeded: false,
        coveredBoundingBox: {
          min: coveredBBoxMin,
          max: coveredBBoxMax,
        },
      };
    }

    if (!this.magInfo.hasIndex(zoomStep)) {
      throw new Error(
        `DataCube.floodFill was called with a zoomStep of ${zoomStep} which does not exist for the current magnification.`,
      );
    }

    const seedVoxelIndex = this.getVoxelIndex(globalSeedVoxel, zoomStep);
    const seedBucketData = seedBucket.getOrCreateData();
    const sourceSegmentId = seedBucketData[seedVoxelIndex];

    const segmentId = castForArrayType(segmentIdNumber, seedBucketData);

    if (sourceSegmentId === segmentId) {
      return {
        bucketsWithLabeledVoxelsMap,
        wasBoundingBoxExceeded: false,
        coveredBoundingBox: {
          min: coveredBBoxMin,
          max: coveredBBoxMax,
        },
      };
    }

    const bucketsWithXyzSeedsToFill: Array<[DataBucket, Vector3]> = [
      [seedBucket, this.getVoxelOffset(globalSeedVoxel, zoomStep)],
    ];
    let labeledVoxelCount = 0;
    let wasBoundingBoxExceeded = false;

    // Iterate over all buckets within the area and flood fill each of them.
    while (bucketsWithXyzSeedsToFill.length > 0) {
      const poppedElement = bucketsWithXyzSeedsToFill.pop();
      if (poppedElement == null) {
        // Satisfy Typescript
        throw new Error("Queue is empty.");
      }
      const [currentBucket, initialXyzVoxelInBucket] = poppedElement;
      const currentBucketBoundingBox = currentBucket.getBoundingBox();
      const currentGlobalBucketPosition = currentBucket.getGlobalPosition();
      // Check if the bucket overlaps the active viewport bounds.
      let shouldIgnoreBucket = false;

      while (
        !areBoundingBoxesOverlappingOrTouching(currentBucketBoundingBox, floodfillBoundingBox)
      ) {
        if (!USE_FLOODFILL_VOXEL_THRESHOLD || labeledVoxelCount > FLOODFILL_VOXEL_THRESHOLD) {
          wasBoundingBoxExceeded = true;
          shouldIgnoreBucket = true;
          break;
        } else {
          // Increase the size of the bounding box by moving the bbox surface
          // which is closest to the seed.
          const seedToMinDiff = V3.sub(globalSeedVoxel, floodfillBoundingBox.min);
          const seedToMaxDiff = V3.sub(floodfillBoundingBox.max, globalSeedVoxel);
          const smallestDiffToMin = Math.min(...seedToMinDiff);
          const smallestDiffToMax = Math.min(...seedToMaxDiff);

          if (smallestDiffToMin < smallestDiffToMax) {
            // Decrease min
            floodfillBoundingBox.min[Array.from(seedToMinDiff).indexOf(smallestDiffToMin)] -=
              constants.BUCKET_WIDTH;
          } else {
            // Increase max
            floodfillBoundingBox.max[Array.from(seedToMaxDiff).indexOf(smallestDiffToMax)] +=
              constants.BUCKET_WIDTH;
          }
        }
      }

      if (shouldIgnoreBucket) {
        continue;
      }

      // Since the floodfill operation needs to read the existing bucket data, we need to
      // load (await) the data first. This means that we don't have to define LabeledVoxelMaps
      // for the current magnification. This simplifies the algorithm, too, since the floodfill also
      // uses the bucket's data array to mark visited voxels (which would not be possible with
      // LabeledVoxelMaps).

      const bucketData = await currentBucket.getDataForMutation();
      const initialVoxelIndex = this.getVoxelIndexByVoxelOffset(initialXyzVoxelInBucket);

      if (bucketData[initialVoxelIndex] !== sourceSegmentId) {
        // Ignoring neighbour buckets whose segmentId at the initial voxel does not match the source cell id.
        continue;
      }

      // Add the bucket to the current volume undo batch, if it isn't already part of it.
      currentBucket.startDataMutation();
      // Mark the initial voxel.
      bucketData[initialVoxelIndex] = segmentId;
      // Create an array saving the labeled voxel of the current slice for the current bucket, if there isn't already one.
      const currentLabeledVoxelMap =
        bucketsWithLabeledVoxelsMap.get(currentBucket.zoomedAddress) || new Map();

      const currentMag = this.magInfo.getMagByIndexOrThrow(currentBucket.zoomedAddress[3]);

      const markUvwInSliceAsLabeled = ([firstCoord, secondCoord, thirdCoord]: Vector3) => {
        // Convert bucket local W coordinate to global W (both mag-dependent)
        const w = dimensionIndices[2];
        thirdCoord += currentBucket.getTopLeftInMag()[w];
        // Convert mag-dependent W to mag-independent W
        thirdCoord *= currentMag[w];

        if (!currentLabeledVoxelMap.has(thirdCoord)) {
          currentLabeledVoxelMap.set(
            thirdCoord,
            new Uint8Array(constants.BUCKET_WIDTH ** 2).fill(0),
          );
        }

        const dataArray = currentLabeledVoxelMap.get(thirdCoord);

        if (!dataArray) {
          // Satisfy typescript
          throw new Error("Map entry does not exist, even though it was just set.");
        }

        dataArray[firstCoord * constants.BUCKET_WIDTH + secondCoord] = 1;
      };

      // Use a VoxelNeighborQueue2D/3D to iterate over the bucket and using bucket-local addresses and not global addresses.
      const initialVoxelInSliceUvw = transpose(initialXyzVoxelInBucket);
      markUvwInSliceAsLabeled(initialVoxelInSliceUvw);
      const VoxelNeighborQueueClass = use3D ? VoxelNeighborQueue3D : VoxelNeighborQueue2D;
      const neighbourVoxelStackUvw = new VoxelNeighborQueueClass(initialVoxelInSliceUvw);

      // Iterating over all neighbours from the initialAddress.
      while (!neighbourVoxelStackUvw.isEmpty()) {
        const { origin, neighbors: neighbours } = neighbourVoxelStackUvw.getVoxelAndGetNeighbors();

        const originGlobalPosition = V3.add(
          currentGlobalBucketPosition,
          V3.scale3(origin, currentMag),
        );

        for (let neighbourIndex = 0; neighbourIndex < neighbours.length; ++neighbourIndex) {
          const neighbourVoxelUvw = neighbours[neighbourIndex];
          const neighbourVoxelXyz = transpose(neighbourVoxelUvw);
          // If the current neighbour is not in the current bucket, calculate its
          // bucket's zoomed address and add the bucket to bucketsWithXyzSeedsToFill.
          // adjustedNeighbourVoxelUvw is a copy of neighbourVoxelUvw whose value are robust
          // against the modulo operation used in getVoxelOffset.
          const {
            isVoxelOutside,
            neighbourBucketAddress,
            adjustedVoxel: adjustedNeighbourVoxelXyz,
          } = currentBucket.is3DVoxelInsideBucket(neighbourVoxelXyz, zoomStep);

          if (isVoxelOutside) {
            // Add the bucket to the list of buckets to flood fill.
            const neighbourBucket = this.getOrCreateBucket(neighbourBucketAddress);

            let shouldSkip = false;
            if (splitBoundaryMesh) {
              const currentGlobalPosition = V3.add(
                currentGlobalBucketPosition,
                V3.scale3(neighbourVoxelXyz, currentMag),
              );
              const intersects = checkLineIntersection(
                splitBoundaryMesh,
                originGlobalPosition,
                currentGlobalPosition,
              );

              shouldSkip = intersects;
            }

            if (!shouldSkip && neighbourBucket.type !== "null") {
              bucketsWithXyzSeedsToFill.push([neighbourBucket, adjustedNeighbourVoxelXyz]);
            }
          } else {
            // Label the current neighbour and add it to the neighbourVoxelStackUvw to iterate over its neighbours.
            const neighbourVoxelIndex = this.getVoxelIndexByVoxelOffset(neighbourVoxelXyz);
            const currentGlobalPosition = V3.add(
              currentGlobalBucketPosition,
              V3.scale3(adjustedNeighbourVoxelXyz, currentMag),
            );
            // When flood filling in a coarser mag, a voxel in the coarse mag is more than one voxel in mag 1
            const voxelBoundingBoxInMag1 = new BoundingBox({
              min: currentGlobalPosition,
              max: V3.add(currentGlobalPosition, currentMag),
            });

            let shouldSkip = false;
            if (splitBoundaryMesh) {
              const intersects = checkLineIntersection(
                splitBoundaryMesh,
                originGlobalPosition,
                currentGlobalPosition,
              );

              shouldSkip = intersects;
            }

            if (!shouldSkip && bucketData[neighbourVoxelIndex] === sourceSegmentId) {
              if (floodfillBoundingBox.intersectedWith(voxelBoundingBoxInMag1).getVolume() > 0) {
                bucketData[neighbourVoxelIndex] = segmentId;
                markUvwInSliceAsLabeled(neighbourVoxelUvw);
                neighbourVoxelStackUvw.pushVoxel(neighbourVoxelUvw);
                labeledVoxelCount++;

                coveredBBoxMin[0] = Math.min(coveredBBoxMin[0], voxelBoundingBoxInMag1.min[0]);
                coveredBBoxMin[1] = Math.min(coveredBBoxMin[1], voxelBoundingBoxInMag1.min[1]);
                coveredBBoxMin[2] = Math.min(coveredBBoxMin[2], voxelBoundingBoxInMag1.min[2]);

                // The maximum is exclusive which is why we add 1 to the position
                coveredBBoxMax[0] = Math.max(coveredBBoxMax[0], voxelBoundingBoxInMag1.max[0] + 1);
                coveredBBoxMax[1] = Math.max(coveredBBoxMax[1], voxelBoundingBoxInMag1.max[1] + 1);
                coveredBBoxMax[2] = Math.max(coveredBBoxMax[2], voxelBoundingBoxInMag1.max[2] + 1);

                if (labeledVoxelCount % 1000000 === 0) {
                  console.log(`Labeled ${labeledVoxelCount} Vx. Continuing...`);

                  await progressCallback(
                    false,
                    `Labeled ${labeledVoxelCount / 1000000} MVx. Continuing...`,
                  );
                }
              } else {
                wasBoundingBoxExceeded = true;
              }
            }
          }
        }
      }

      bucketsWithLabeledVoxelsMap.set(currentBucket.zoomedAddress, currentLabeledVoxelMap);
    }

    for (const bucketZoomedAddress of bucketsWithLabeledVoxelsMap.keys()) {
      const bucket = this.getBucket(bucketZoomedAddress);

      if (bucket.type === "null") {
        continue;
      }

      bucket.endDataMutation();
    }

    return {
      bucketsWithLabeledVoxelsMap,
      wasBoundingBoxExceeded,
      coveredBoundingBox: {
        min: coveredBBoxMin,
        max: coveredBBoxMax,
      },
    };
  }

  triggerPushQueue() {
    this.pushQueue.push();
  }

  async isZoomStepUltimatelyRenderableForVoxel(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    zoomStep: number = 0,
  ): Promise<boolean> {
    // Make sure the respective bucket is loaded before checking whether the zoomStep
    // is currently renderable for this voxel.
    await this.getLoadedBucket(
      this.positionToZoomedAddress(voxel, additionalCoordinates, zoomStep),
    );
    return this.isZoomStepCurrentlyRenderableForVoxel(voxel, additionalCoordinates, zoomStep);
  }

  isZoomStepCurrentlyRenderableForVoxel(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    zoomStep: number = 0,
  ): boolean {
    // When this method returns false, this means that the next mag (if it exists)
    // needs to be examined for rendering.
    const bucket = this.getBucket(
      this.positionToZoomedAddress(voxel, additionalCoordinates, zoomStep),
    );
    const { renderMissingDataBlack } = Store.getState().datasetConfiguration;

    if (!(bucket instanceof DataBucket)) {
      // This is a NullBucket (e.g., because it's out of the bounding box or there exists no data for this zoomstep).
      // If renderMissingDataBlack is turned on, this zoomstep is as good as all the other zoomsteps (as these will only
      // hold null buckets, too). If this option is turned off, buckets of higher mags could be used for rendering,
      // thus return false in this case.
      return renderMissingDataBlack;
    }

    if (bucket.hasData() || bucket.isLoaded()) {
      // The data exists or the bucket was loaded at least (the latter case
      // occurs when renderMissingDataBlack is *enabled* but the bucket is missing.
      // Then, the bucket has the "isLoaded" state and should be used for rendering).
      return true;
    }

    if (bucket.isMissing()) {
      // renderMissingDataBlack is false (--> fallback rendering will happen) and the bucket doesn't exist.
      // Look at next zoom step.
      return false;
    }

    // The bucket wasn't loaded (or requested) yet. In that case, fallback rendering
    // is always active (regardless of the renderMissingDataBlack setting).
    return false;
  }

  getNextCurrentlyUsableZoomStepForPosition(
    position: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    zoomStep: number,
  ): number {
    const mags = this.magInfo.getDenseMags();
    let usableZoomStep = zoomStep;

    while (
      position &&
      usableZoomStep < mags.length - 1 &&
      !this.isZoomStepCurrentlyRenderableForVoxel(position, additionalCoordinates, usableZoomStep)
    ) {
      usableZoomStep++;
    }

    return usableZoomStep;
  }

  async getNextUltimatelyUsableZoomStepForPosition(
    position: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    zoomStep: number,
  ): Promise<number> {
    const mags = this.magInfo.getDenseMags();
    let usableZoomStep = zoomStep;

    while (
      position &&
      usableZoomStep < mags.length - 1 &&
      !(await this.isZoomStepUltimatelyRenderableForVoxel(
        position,
        additionalCoordinates,
        usableZoomStep,
      ))
    ) {
      usableZoomStep++;
    }

    return usableZoomStep;
  }

  getDataValue(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    mapping: Mapping | null | undefined,
    zoomStep: number = 0,
  ): number {
    if (!this.magInfo.hasIndex(zoomStep)) {
      return 0;
    }

    const bucket = this.getBucket(
      this.positionToZoomedAddress(voxel, additionalCoordinates, zoomStep),
    );
    const voxelIndex = this.getVoxelIndex(voxel, zoomStep);

    if (bucket.hasData()) {
      const data = bucket.getData();
      const dataValue = data[voxelIndex];

      if (mapping) {
        const mappedValue = isNumberMap(mapping)
          ? mapping.get(Number(dataValue))
          : mapping.get(BigInt(dataValue));

        if (mappedValue != null) {
          // TODO: Proper 64 bit support (#6921)
          return Number(mappedValue);
        }
      }

      // TODO: Proper 64 bit support (#6921)
      return Number(dataValue);
    }

    return 0;
  }

  getMappedDataValue(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    zoomStep: number = 0,
  ): number {
    return this.getDataValue(
      voxel,
      additionalCoordinates,
      this.isMappingEnabled() ? this.getMapping() : null,
      zoomStep,
    );
  }

  getVoxelIndexByVoxelOffset([x, y, z]: Vector3 | Float32Array): number {
    return x + y * constants.BUCKET_WIDTH + z * constants.BUCKET_WIDTH ** 2;
  }

  /*
    Given a global coordinate `voxel`, this method returns the coordinate
    within the bucket to which `voxel` belongs.
    So, the returned value for x, y and z will be between 0 and 32.
   */
  getVoxelOffset(voxel: Vector3, zoomStep: number = 0): Vector3 {
    // No `map` for performance reasons
    const voxelOffset: Vector3 = [0, 0, 0];
    const mag = this.magInfo.getMagByIndexOrThrow(zoomStep);

    for (let i = 0; i < 3; i++) {
      voxelOffset[i] = Math.floor(voxel[i] / mag[i]) % constants.BUCKET_WIDTH;
    }

    return voxelOffset;
  }

  getVoxelIndex(voxel: Vector3, zoomStep: number = 0): number {
    const voxelOffset = this.getVoxelOffset(voxel, zoomStep);
    return this.getVoxelIndexByVoxelOffset(voxelOffset);
  }

  positionToZoomedAddress(
    position: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    zoomStep: number = 0,
  ): BucketAddress {
    // return the bucket a given voxel lies in
    return globalPositionToBucketPosition(
      position,
      this.magInfo.getDenseMags(),
      zoomStep,
      additionalCoordinates,
    );
  }

  async getLoadedBucket(bucketAddress: BucketAddress) {
    const bucket = this.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      await bucket.ensureLoaded();
    }

    return bucket;
  }

  destroy() {
    this.cubes = {};
    this.buckets = [];
    this.storePropertyUnsubscribers.forEach((fn) => fn());
    this.storePropertyUnsubscribers = [];
  }
}

export default DataCube;

function checkLineIntersection(bentMesh: THREE.Mesh, pointAVec3: Vector3, pointBVec3: Vector3) {
  /* Returns true if an intersection is found */

  const geometry = bentMesh.geometry;

  // Create BVH from geometry if not already built
  if (!geometry.boundsTree) {
    geometry.computeBoundsTree();
  }
  const scale = Store.getState().dataset.dataSource.scale.factor;
  const pointA = new THREE.Vector3(...V3.scale3(pointAVec3, scale));
  const pointB = new THREE.Vector3(...V3.scale3(pointBVec3, scale));

  // Create a ray from A to B
  const ray = new THREE.Ray();
  ray.origin.copy(pointA);
  ray.direction.subVectors(pointB, pointA).normalize();

  // Perform raycast
  const raycaster = new THREE.Raycaster();
  raycaster.ray = ray;
  raycaster.far = pointA.distanceTo(pointB);
  raycaster.firstHitOnly = true;

  const intersects = raycaster.intersectObject(bentMesh, true);
  return intersects.length > 0;
}
