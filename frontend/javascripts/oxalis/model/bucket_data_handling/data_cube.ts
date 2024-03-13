import _ from "lodash";
import type { Bucket, BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import { DataBucket, NULL_BUCKET, NullBucket } from "oxalis/model/bucket_data_handling/bucket";
import type { AdditionalAxis, ElementClass } from "types/api_flow_types";
import type { ProgressCallback } from "libs/progress_callback";
import { V3 } from "libs/mjs";
import { VoxelNeighborQueue2D, VoxelNeighborQueue3D } from "oxalis/model/volumetracing/volumelayer";
import { areBoundingBoxesOverlappingOrTouching, castForArrayType } from "libs/utils";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type { DimensionMap } from "oxalis/model/dimensions";
import Dimensions from "oxalis/model/dimensions";
import ErrorHandling from "libs/error_handling";
import PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";
import type { Mapping } from "oxalis/store";
import Store from "oxalis/store";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import Toast from "libs/toast";
import type {
  Vector3,
  BoundingBoxType,
  LabelMasksByBucketAndW,
  BucketAddress,
} from "oxalis/constants";
import constants, { MappingStatusEnum } from "oxalis/constants";
import { ResolutionInfo } from "../helpers/resolution_info";
import { type AdditionalCoordinate } from "types/api_flow_types";

const warnAboutTooManyAllocations = _.once(() => {
  const msg =
    "WEBKNOSSOS needed to allocate an unusually large amount of image data. It is advised to save your work and reload the page.";
  ErrorHandling.notify(new Error(msg));
  Toast.warning(msg, {
    sticky: true,
  });
});

class CubeEntry {
  data: Map<number, Bucket>;
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
  resolutionInfo: ResolutionInfo;
  layerName: string;

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
    resolutionInfo: ResolutionInfo,
    elementClass: ElementClass,
    isSegmentation: boolean,
    layerName: string,
  ) {
    this.elementClass = elementClass;
    this.isSegmentation = isSegmentation;
    this.resolutionInfo = resolutionInfo;
    this.layerName = layerName;
    this.additionalAxes = _.keyBy(additionalAxes, "name");

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
    listenToStoreProperty(
      (state) => getSomeTracing(state.tracing).boundingBox,
      (boundingBox) => {
        this.boundingBox = new BoundingBox(
          shouldBeRestrictedByTracingBoundingBox() ? boundingBox : null,
        ).intersectedWith(layerBBox);
      },
      true,
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

  mapId(idToMap: number): number {
    let mappedId = null;
    const mapping = this.getMapping();

    if (mapping != null && this.isMappingEnabled()) {
      mappedId = mapping[idToMap];
    }

    if (this.shouldHideUnmappedIds() && mappedId == null) {
      mappedId = 0;
    }

    return mappedId != null ? mappedId : idToMap;
  }

  private getCubeKey(zoomStep: number, allCoords: AdditionalCoordinate[] | undefined | null) {
    const relevantCoords = (allCoords ?? []).filter(
      (coord) => this.additionalAxes[coord.name] != null,
    );
    return [zoomStep, ...relevantCoords.map((el) => el.value)].join("-");
  }

  isWithinBounds([x, y, z, zoomStep, coords]: BucketAddress): boolean {
    const cube = this.getOrCreateCubeEntry(zoomStep, coords);
    if (cube == null) {
      return false;
    }

    return this.boundingBox.containsBucket([x, y, z, zoomStep], this.resolutionInfo);
  }

  getBucketIndexAndCube([x, y, z, zoomStep, coords]: BucketAddress): [
    number | null | undefined,
    CubeEntry | null,
  ] {
    // Removed for performance reasons
    // ErrorHandling.assert(this.isWithinBounds([x, y, z, zoomStep]));
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
      const resolution = this.resolutionInfo.getResolutionByIndex(zoomStep);
      if (resolution == null) {
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
        Math.ceil(this.boundingBox.max[0] / (constants.BUCKET_WIDTH * resolution[0])) + 1,
        Math.ceil(this.boundingBox.max[1] / (constants.BUCKET_WIDTH * resolution[1])) + 1,
        Math.ceil(this.boundingBox.max[2] / (constants.BUCKET_WIDTH * resolution[2])) + 1,
      ];
      this.cubes[cubeKey] = new CubeEntry(zoomedCubeBoundary);
    }
    return this.cubes[cubeKey];
  }

  // Either returns the existing bucket or creates a new one. Only returns
  // NULL_BUCKET if the bucket cannot possibly exist, e.g. because it is
  // outside the dataset's bounding box.
  getOrCreateBucket(address: BucketAddress): Bucket {
    if (!this.isWithinBounds(address)) {
      return this.getNullBucket();
    }

    let bucket = this.getBucket(address, true);

    if (bucket instanceof NullBucket) {
      bucket = this.createBucket(address);
    }

    return bucket;
  }

  // Returns the Bucket object if it exists, or NULL_BUCKET otherwise.
  getBucket(address: BucketAddress, skipBoundsCheck: boolean = false): Bucket {
    if (!skipBoundsCheck && !this.isWithinBounds(address)) {
      return this.getNullBucket();
    }

    const [bucketIndex, cube] = this.getBucketIndexAndCube(address);

    if (bucketIndex != null && cube != null) {
      const bucket = cube.data.get(bucketIndex);

      if (bucket != null) {
        return bucket;
      }
    }

    return this.getNullBucket();
  }

  createBucket(address: BucketAddress): Bucket {
    const bucket = new DataBucket(this.elementClass, address, this.temporalBucketManager, this);
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

        if (this.buckets[this.bucketIterator].shouldCollect()) {
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
              resolutionInfo: this.resolutionInfo,
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
    this.pullQueue.clear();
    this.pullQueue.abortRequests();

    const notCollectedBuckets = [];
    for (const bucket of this.buckets) {
      // If a bucket is requested, collect it independently of the predicateFn,
      // because the pullQueue was already cleared (meaning the bucket is in a
      // requested state, but will never be filled with data).
      if (bucket.state === "REQUESTED" || predicateFn(bucket)) {
        this.collectBucket(bucket);
      } else {
        notCollectedBuckets.push(bucket);
      }
    }

    this.buckets = notCollectedBuckets;
    this.bucketIterator = notCollectedBuckets.length;
  }

  collectBucket(bucket: DataBucket): void {
    const address = bucket.zoomedAddress;
    const [bucketIndex, cube] = this.getBucketIndexAndCube(address);

    if (bucketIndex != null && cube != null) {
      bucket.destroy();
      cube.data.delete(bucketIndex);
    }
  }

  async _labelVoxelInAllResolutions_DEPRECATED(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    label: number,
    activeSegmentId?: number | null | undefined,
  ): Promise<void> {
    // This function is only provided for the wK front-end api and should not be used internally,
    // since it only operates on one voxel and therefore is not performance-optimized.
    // Please make use of a LabeledVoxelsMap instead.
    const promises = [];

    for (const [resolutionIndex] of this.resolutionInfo.getResolutionsWithIndices()) {
      promises.push(
        this._labelVoxelInResolution_DEPRECATED(
          voxel,
          additionalCoordinates,
          label,
          resolutionIndex,
          activeSegmentId,
        ),
      );
    }

    await Promise.all(promises);
    this.triggerPushQueue();
  }

  async _labelVoxelInResolution_DEPRECATED(
    voxel: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null,
    label: number,
    zoomStep: number,
    activeSegmentId: number | null | undefined,
  ): Promise<void> {
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
    floodfillBoundingBox: BoundingBoxType,
    zoomStep: number,
    progressCallback: ProgressCallback,
    use3D: boolean,
  ): Promise<{
    bucketsWithLabeledVoxelsMap: LabelMasksByBucketAndW;
    wasBoundingBoxExceeded: boolean;
    coveredBoundingBox: BoundingBoxType;
  }> {
    // This flood-fill algorithm works in two nested levels and uses a list of buckets to flood fill.
    // On the inner level a bucket is flood-filled  and if the iteration of the buckets data
    // reaches an neighbour bucket, this bucket is added to this list of buckets to flood fill.
    // The outer level simply iterates over all  buckets in the list and triggers the bucket-wise flood fill.
    // Additionally a map is created that saves all labeled voxels for each bucket. This map is returned at the end.
    //
    // Note: It is possible that a bucket is multiple times added to the list of buckets. This is intended
    // because a border of the "neighbour volume shape" might leave the neighbour bucket and enter it somewhere else.
    // If it would not be possible to have the same neighbour bucket in the list multiple times,
    // not all of the target area in the neighbour bucket might be filled.
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
    let coveredBBoxMin: Vector3 = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    let coveredBBoxMax: Vector3 = [0, 0, 0];

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

    if (!this.resolutionInfo.hasIndex(zoomStep)) {
      throw new Error(
        `DataCube.floodFill was called with a zoomStep of ${zoomStep} which does not exist for the current resolution.`,
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
      // eslint-disable-next-line no-await-in-loop
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

      const currentResolution = this.resolutionInfo.getResolutionByIndexOrThrow(
        currentBucket.zoomedAddress[3],
      );

      const markUvwInSliceAsLabeled = ([firstCoord, secondCoord, thirdCoord]: Vector3) => {
        // Convert bucket local W coordinate to global W (both mag-dependent)
        const w = dimensionIndices[2];
        thirdCoord += currentBucket.getTopLeftInMag()[w];
        // Convert mag-dependent W to mag-independent W
        thirdCoord *= currentResolution[w];

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
        const neighbours = neighbourVoxelStackUvw.getVoxelAndGetNeighbors();

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

            if (neighbourBucket.type !== "null") {
              bucketsWithXyzSeedsToFill.push([neighbourBucket, adjustedNeighbourVoxelXyz]);
            }
          } else {
            // Label the current neighbour and add it to the neighbourVoxelStackUvw to iterate over its neighbours.
            const neighbourVoxelIndex = this.getVoxelIndexByVoxelOffset(neighbourVoxelXyz);

            if (bucketData[neighbourVoxelIndex] === sourceSegmentId) {
              bucketData[neighbourVoxelIndex] = segmentId;
              markUvwInSliceAsLabeled(neighbourVoxelUvw);
              neighbourVoxelStackUvw.pushVoxel(neighbourVoxelUvw);
              labeledVoxelCount++;
              const currentGlobalPosition = V3.add(
                currentGlobalBucketPosition,
                V3.scale3(adjustedNeighbourVoxelXyz, currentResolution),
              );
              coveredBBoxMin = [
                Math.min(coveredBBoxMin[0], currentGlobalPosition[0]),
                Math.min(coveredBBoxMin[1], currentGlobalPosition[1]),
                Math.min(coveredBBoxMin[2], currentGlobalPosition[2]),
              ];
              // The maximum is exclusive which is why we add 1 to the position
              coveredBBoxMax = [
                Math.max(coveredBBoxMax[0], currentGlobalPosition[0] + 1),
                Math.max(coveredBBoxMax[1], currentGlobalPosition[1] + 1),
                Math.max(coveredBBoxMax[2], currentGlobalPosition[2] + 1),
              ];

              if (labeledVoxelCount % 1000000 === 0) {
                console.log(`Labeled ${labeledVoxelCount} Vx. Continuing...`);
                // eslint-disable-next-line no-await-in-loop
                await progressCallback(
                  false,
                  `Labeled ${labeledVoxelCount / 1000000} MVx. Continuing...`,
                );
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

  setBucketData(
    zoomedAddress: BucketAddress,
    data: BucketDataArray,
    newPendingOperations: Array<(arg0: BucketDataArray) => void>,
  ) {
    const bucket = this.getOrCreateBucket(zoomedAddress);

    if (bucket.type === "null") {
      return;
    }

    bucket.setData(data, newPendingOperations);
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
    // When this method returns false, this means that the next resolution (if it exists)
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
    const resolutions = this.resolutionInfo.getDenseResolutions();
    let usableZoomStep = zoomStep;

    while (
      position &&
      usableZoomStep < resolutions.length - 1 &&
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
    const resolutions = this.resolutionInfo.getDenseResolutions();
    let usableZoomStep = zoomStep;

    while (
      position &&
      usableZoomStep < resolutions.length - 1 && // eslint-disable-next-line no-await-in-loop
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
    if (!this.resolutionInfo.hasIndex(zoomStep)) {
      return 0;
    }

    const bucket = this.getBucket(
      this.positionToZoomedAddress(voxel, additionalCoordinates, zoomStep),
    );
    const voxelIndex = this.getVoxelIndex(voxel, zoomStep);

    if (bucket.hasData()) {
      const data = bucket.getData();
      const dataValue = Number(data[voxelIndex]);

      if (mapping) {
        const mappedValue = mapping[dataValue];

        if (mappedValue != null) {
          return mappedValue;
        }
      }

      return dataValue;
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
    const resolution = this.resolutionInfo.getResolutionByIndexOrThrow(zoomStep);

    for (let i = 0; i < 3; i++) {
      voxelOffset[i] = Math.floor(voxel[i] / resolution[i]) % constants.BUCKET_WIDTH;
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
      this.resolutionInfo.getDenseResolutions(),
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
}

export default DataCube;
