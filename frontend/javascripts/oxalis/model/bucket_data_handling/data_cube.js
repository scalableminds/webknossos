/**
 * cube.js
 * @flow
 */

import BackboneEvents from "backbone-events-standalone";
import _ from "lodash";

import ErrorHandling from "libs/error_handling";
import {
  type Bucket,
  DataBucket,
  NULL_BUCKET,
  NULL_BUCKET_OUT_OF_BB,
  NullBucket,
  type BucketDataArray,
} from "oxalis/model/bucket_data_handling/bucket";
import { VoxelNeighborQueue2D, VoxelNeighborQueue3D } from "oxalis/model/volumetracing/volumelayer";
import {
  getResolutions,
  ResolutionInfo,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { V3 } from "libs/mjs";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import ArbitraryCubeAdapter from "oxalis/model/bucket_data_handling/arbitrary_cube_adapter";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import PullQueue, { PullQueueConstants } from "oxalis/model/bucket_data_handling/pullqueue";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";
import Store, { type Mapping } from "oxalis/store";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import Dimensions, { type DimensionMap } from "oxalis/model/dimensions";
import constants, {
  type Vector3,
  type Vector4,
  type BoundingBoxType,
  type LabelMasksByBucketAndW,
  MappingStatusEnum,
} from "oxalis/constants";
import { type ElementClass } from "types/api_flow_types";
import { areBoundingBoxesOverlappingOrTouching } from "libs/utils";
import { type ProgressCallback } from "libs/progress_callback";

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
  MAXIMUM_BUCKET_COUNT = constants.MAXIMUM_BUCKET_COUNT_PER_LAYER;
  arbitraryCube: ArbitraryCubeAdapter;
  upperBoundary: Vector3;
  buckets: Array<DataBucket>;
  bucketIterator: number = 0;
  bucketCount: number = 0;
  cubes: Array<CubeEntry>;
  boundingBox: BoundingBox;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  temporalBucketManager: TemporalBucketManager;
  isSegmentation: boolean;
  elementClass: ElementClass;
  resolutionInfo: ResolutionInfo;
  layerName: string;

  // The cube stores the buckets in a separate array for each zoomStep. For each
  // zoomStep the cube-array contains the boundaries and an array holding the buckets.
  // The bucket-arrays are initialized large enough to hold the whole cube. Thus no
  // expanding is necessary. bucketCount keeps track of how many buckets are currently
  // in the cube.
  //
  // Each bucket consists of an access-value, the zoomStep and the actual data.
  // The access-values are used for garbage collection. When a bucket is accessed, its
  // access-flag is set to true.
  // When buckets have to be collected, an iterator will loop through the queue and the buckets at
  // the beginning of the queue will be removed from the queue and the access-value will
  // be decreased. If the access-value of a bucket becomes 0, it is no longer in the
  // access-queue and is least recently used. It is then removed from the cube.

  constructor(
    upperBoundary: Vector3,
    resolutionInfo: ResolutionInfo,
    elementClass: ElementClass,
    isSegmentation: boolean,
    layerName: string,
  ) {
    this.upperBoundary = upperBoundary;
    this.elementClass = elementClass;
    this.isSegmentation = isSegmentation;
    this.resolutionInfo = resolutionInfo;
    this.layerName = layerName;

    _.extend(this, BackboneEvents);

    this.cubes = [];
    this.buckets = new Array(this.MAXIMUM_BUCKET_COUNT);

    // Initializing the cube-arrays with boundaries
    const cubeBoundary = [
      Math.ceil(this.upperBoundary[0] / constants.BUCKET_WIDTH),
      Math.ceil(this.upperBoundary[1] / constants.BUCKET_WIDTH),
      Math.ceil(this.upperBoundary[2] / constants.BUCKET_WIDTH),
    ];

    this.arbitraryCube = new ArbitraryCubeAdapter(this, _.clone(cubeBoundary));

    for (const [resolutionIndex, resolution] of resolutionInfo.getResolutionsWithIndices()) {
      const zoomedCubeBoundary = [
        Math.ceil(cubeBoundary[0] / resolution[0]) + 1,
        Math.ceil(cubeBoundary[1] / resolution[1]) + 1,
        Math.ceil(cubeBoundary[2] / resolution[2]) + 1,
      ];
      this.cubes[resolutionIndex] = new CubeEntry(zoomedCubeBoundary);
    }

    const shouldBeRestrictedByTracingBoundingBox = () => {
      const { task } = Store.getState();
      const isVolumeTask = task != null && task.type.tracingType === "volume";
      return !isVolumeTask;
    };
    this.boundingBox = new BoundingBox(
      shouldBeRestrictedByTracingBoundingBox()
        ? getSomeTracing(Store.getState().tracing).boundingBox
        : null,
      this.upperBoundary,
    );

    listenToStoreProperty(
      state => getSomeTracing(state.tracing).boundingBox,
      boundingBox => {
        if (shouldBeRestrictedByTracingBoundingBox()) {
          this.boundingBox = new BoundingBox(boundingBox, this.upperBoundary);
        }
      },
    );
  }

  initializeWithQueues(pullQueue: PullQueue, pushQueue: PushQueue): void {
    // Due to cyclic references, this method has to be called before the cube is
    // used with the instantiated queues

    this.pullQueue = pullQueue;
    this.pushQueue = pushQueue;
    this.temporalBucketManager = new TemporalBucketManager(this.pullQueue, this.pushQueue);
  }

  getNullBucket(address: Vector4): Bucket {
    if (this.boundingBox.containsBucket(address)) {
      return NULL_BUCKET;
    } else {
      return NULL_BUCKET_OUT_OF_BB;
    }
  }

  isMappingEnabled(): boolean {
    const activeMapping = getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      this.layerName,
    );
    return this.isSegmentation ? activeMapping.mappingStatus === MappingStatusEnum.ENABLED : false;
  }

  getMapping(): ?Mapping {
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

  getArbitraryCube(): ArbitraryCubeAdapter {
    return this.arbitraryCube;
  }

  isWithinBounds([x, y, z, zoomStep]: Vector4): boolean {
    if (this.cubes[zoomStep] == null) {
      return false;
    }

    return this.boundingBox.containsBucket([x, y, z, zoomStep]);
  }

  getBucketIndex([x, y, z, zoomStep]: Vector4): ?number {
    // Removed for performance reasons
    // ErrorHandling.assert(this.isWithinBounds([x, y, z, zoomStep]));
    const cube = this.cubes[zoomStep];
    if (cube != null) {
      const { boundary } = cube;
      return x * boundary[2] * boundary[1] + y * boundary[2] + z;
    }
    return null;
  }

  // Either returns the existing bucket or creates a new one. Only returns
  // NULL_BUCKET if the bucket cannot possibly exist, e.g. because it is
  // outside the dataset's bounding box.
  getOrCreateBucket(address: Vector4): Bucket {
    if (!this.isWithinBounds(address)) {
      return this.getNullBucket(address);
    }

    let bucket = this.getBucket(address, true);
    if (bucket instanceof NullBucket) {
      bucket = this.createBucket(address);
    }

    return bucket;
  }

  // Returns the Bucket object if it exists, or NULL_BUCKET otherwise.
  getBucket(address: Vector4, skipBoundsCheck: boolean = false): Bucket {
    if (!skipBoundsCheck && !this.isWithinBounds(address)) {
      return this.getNullBucket(address);
    }

    const bucketIndex = this.getBucketIndex(address);
    const cube = this.cubes[address[3]];
    if (bucketIndex != null && cube != null) {
      const bucket = cube.data.get(bucketIndex);
      if (bucket != null) {
        return bucket;
      }
    }
    return this.getNullBucket(address);
  }

  createBucket(address: Vector4): Bucket {
    const bucket = new DataBucket(this.elementClass, address, this.temporalBucketManager, this);
    this.addBucketToGarbageCollection(bucket);

    const bucketIndex = this.getBucketIndex(address);
    const cube = this.cubes[address[3]];
    if (bucketIndex != null && cube != null) {
      cube.data.set(bucketIndex, bucket);
    }
    return bucket;
  }

  markBucketsAsUnneeded(): void {
    for (let i = 0; i < this.bucketCount; i++) {
      this.buckets[i].markAsUnneeded();
    }
  }

  addBucketToGarbageCollection(bucket: DataBucket): void {
    if (this.bucketCount >= this.MAXIMUM_BUCKET_COUNT) {
      for (let i = 0; i < this.bucketCount; i++) {
        this.bucketIterator = ++this.bucketIterator % this.MAXIMUM_BUCKET_COUNT;
        if (this.buckets[this.bucketIterator].shouldCollect()) {
          break;
        }
      }

      if (!this.buckets[this.bucketIterator].shouldCollect()) {
        if (process.env.BABEL_ENV === "test") {
          throw new Error("Bucket was forcefully evicted/garbage-collected.");
        }
        const errorMessage =
          "A bucket was forcefully garbage-collected. This indicates that too many buckets are currently in RAM.";
        console.error(errorMessage);
        ErrorHandling.notify(new Error(errorMessage), {
          elementClass: this.elementClass,
          isSegmentation: this.isSegmentation,
          resolutionInfo: this.resolutionInfo,
        });
      }

      this.collectBucket(this.buckets[this.bucketIterator]);
      this.bucketCount--;
    }

    this.bucketCount++;
    if (this.buckets[this.bucketIterator]) {
      this.buckets[this.bucketIterator].trigger("bucketCollected");
    }
    this.buckets[this.bucketIterator] = bucket;
    this.bucketIterator = ++this.bucketIterator % this.MAXIMUM_BUCKET_COUNT;
  }

  collectAllBuckets(): void {
    this.pullQueue.clear();
    this.pullQueue.abortRequests();
    for (const bucket of this.buckets) {
      if (bucket != null) {
        this.collectBucket(bucket);
        bucket.trigger("bucketCollected");
      }
    }
    this.buckets = [];
    this.bucketCount = 0;
    this.bucketIterator = 0;
  }

  collectBucket(bucket: DataBucket): void {
    const address = bucket.zoomedAddress;
    const bucketIndex = this.getBucketIndex(address);
    const cube = this.cubes[address[3]];
    if (bucketIndex != null && cube != null) {
      bucket.destroy();
      cube.data.delete(bucketIndex);
    }
  }

  labelTestShape(): void {
    // draw a sphere, centered at (100, 100, 100) with radius 50

    for (let x = 80; x <= 120; x++) {
      for (let y = 80; y <= 120; y++) {
        for (let z = 80; z <= 120; z++) {
          if (
            Math.sqrt((x - 100) * (x - 100) + (y - 100) * (y - 100) + (z - 100) * (z - 100)) <= 20
          ) {
            this.labelVoxelInResolution([x, y, z], 0, 5);
          }
        }
      }
    }
  }

  labelVoxelInAllResolutions(voxel: Vector3, label: number, activeCellId: ?number) {
    // This function is only provided for the wK front-end api and should not be used internally,
    // since it only operates on one voxel and therefore is not performance-optimized.
    // Please make use of a LabeledVoxelsMap instead.
    for (const [resolutionIndex] of this.resolutionInfo.getResolutionsWithIndices()) {
      this.labelVoxelInResolution(voxel, label, resolutionIndex, activeCellId);
    }

    this.triggerPushQueue();
  }

  labelVoxelInResolution(
    voxel: Vector3,
    label: number,
    zoomStep: number,
    activeCellId: ?number,
  ): void {
    let voxelInCube = true;
    for (let i = 0; i <= 2; i++) {
      voxelInCube = voxelInCube && voxel[i] >= 0 && voxel[i] < this.upperBoundary[i];
    }
    if (voxelInCube) {
      const address = this.positionToZoomedAddress(voxel, zoomStep);
      const bucket = this.getOrCreateBucket(address);
      if (bucket instanceof DataBucket) {
        const voxelIndex = this.getVoxelIndex(voxel, zoomStep);

        let shouldUpdateVoxel = true;
        if (activeCellId != null) {
          const voxelValue = this.getMappedDataValue(voxel, zoomStep);
          shouldUpdateVoxel = activeCellId === voxelValue;
        }

        if (shouldUpdateVoxel) {
          const labelFunc = (data: BucketDataArray): void => {
            data[voxelIndex] = label;
          };
          bucket.label(labelFunc);

          // Push bucket if it's loaded or missing (i.e., not existent on the server),
          // otherwise, TemporalBucketManager will push it once it is available.
          if (bucket.isLoaded() || bucket.isMissing()) {
            this.pushQueue.insert(bucket);
          }
        }
      }
    }
  }

  async floodFill(
    globalSeedVoxel: Vector3,
    cellId: number,
    dimensionIndices: DimensionMap,
    floodfillBoundingBox: BoundingBoxType,
    zoomStep: number,
    progressCallback: ProgressCallback,
    use3D: boolean,
  ): Promise<{
    bucketsWithLabeledVoxelsMap: LabelMasksByBucketAndW,
    wasBoundingBoxExceeded: boolean,
    coveredBoundingBox: BoundingBoxType,
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
    const seedBucketAddress = this.positionToZoomedAddress(globalSeedVoxel, zoomStep);
    const seedBucket = this.getOrCreateBucket(seedBucketAddress);
    let coveredBBoxMin = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    let coveredBBoxMax = [0, 0, 0];
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
    const sourceCellId = seedBucket.getOrCreateData().data[seedVoxelIndex];
    if (sourceCellId === cellId) {
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
      const [currentBucket, initialXyzVoxelInBucket] = bucketsWithXyzSeedsToFill.pop();

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
            // $FlowIgnore[invalid-tuple-index]
            floodfillBoundingBox.min[Array.from(seedToMinDiff).indexOf(smallestDiffToMin)] -=
              constants.BUCKET_WIDTH;
          } else {
            // Increase max
            // $FlowIgnore[invalid-tuple-index]
            floodfillBoundingBox.max[Array.from(seedToMaxDiff).indexOf(smallestDiffToMax)] +=
              constants.BUCKET_WIDTH;
          }
        }
      }
      if (shouldIgnoreBucket) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await currentBucket.ensureLoaded();
      const { data: bucketData } = currentBucket.getOrCreateData();
      const initialVoxelIndex = this.getVoxelIndexByVoxelOffset(initialXyzVoxelInBucket);
      if (bucketData[initialVoxelIndex] !== sourceCellId) {
        // Ignoring neighbour buckets whose cellId at the initial voxel does not match the source cell id.
        continue;
      }
      // Add the bucket to the current volume undo batch, if it isn't already part of it.
      currentBucket.markAndAddBucketForUndo();
      // Mark the initial voxel.
      bucketData[initialVoxelIndex] = cellId;
      // Create an array saving the labeled voxel of the current slice for the current bucket, if there isn't already one.
      const currentLabeledVoxelMap =
        bucketsWithLabeledVoxelsMap.get(currentBucket.zoomedAddress) || new Map();
      const resolutions = getResolutions(Store.getState().dataset);
      const currentResolution = resolutions[currentBucket.zoomedAddress[3]];

      const markUvwInSliceAsLabeled = ([firstCoord, secondCoord, thirdCoord]) => {
        // Convert bucket local W coordinate to global W (both mag-dependent)
        const w = dimensionIndices[2];
        thirdCoord += currentBucket.getTopLeftInMag()[w];
        // Convert mag-dependent W to mag-independent W
        thirdCoord = thirdCoord * currentResolution[w];

        if (!currentLabeledVoxelMap.has(thirdCoord)) {
          currentLabeledVoxelMap.set(
            thirdCoord,
            new Uint8Array(constants.BUCKET_WIDTH ** 2).fill(0),
          );
        }
        const dataArray = currentLabeledVoxelMap.get(thirdCoord);
        if (!dataArray) {
          // Satisfy flow
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
            if (bucketData[neighbourVoxelIndex] === sourceCellId) {
              bucketData[neighbourVoxelIndex] = cellId;
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
      this.pushQueue.insert(bucket);
      bucket.trigger("bucketLabeled");
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

  setBucketData(zoomedAddress: Vector4, data: BucketDataArray) {
    const bucket = this.getOrCreateBucket(zoomedAddress);
    if (bucket.type === "null") {
      return;
    }
    bucket.setData(data);
    this.pushQueue.insert(bucket);
  }

  triggerPushQueue() {
    this.pushQueue.push();
  }

  isZoomStepRenderableForVoxel(voxel: Vector3, zoomStep: number = 0): boolean {
    // When this method returns false, this means that the next resolution (if it exists)
    // needs to be examined for rendering.

    const bucket = this.getBucket(this.positionToZoomedAddress(voxel, zoomStep));
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

  getNextUsableZoomStepForPosition(position: Vector3, zoomStep: number): number {
    const resolutions = getResolutions(Store.getState().dataset);
    let usableZoomStep = zoomStep;
    while (
      position &&
      usableZoomStep < resolutions.length - 1 &&
      !this.isZoomStepRenderableForVoxel(position, usableZoomStep)
    ) {
      usableZoomStep++;
    }
    return usableZoomStep;
  }

  getDataValue(voxel: Vector3, mapping: ?Mapping, zoomStep: number = 0): number {
    if (!this.resolutionInfo.hasIndex(zoomStep)) {
      return 0;
    }
    const bucket = this.getBucket(this.positionToZoomedAddress(voxel, zoomStep));
    const voxelIndex = this.getVoxelIndex(voxel, zoomStep);

    if (bucket.hasData()) {
      const data = bucket.getData();
      const dataValue = data[voxelIndex];

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

  getMappedDataValue(voxel: Vector3, zoomStep: number = 0): number {
    return this.getDataValue(voxel, this.isMappingEnabled() ? this.getMapping() : null, zoomStep);
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
    const voxelOffset = [0, 0, 0];
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

  positionToZoomedAddress(position: Vector3, zoomStep: number = 0): Vector4 {
    // return the bucket a given voxel lies in
    return globalPositionToBucketPosition(
      position,
      getResolutions(Store.getState().dataset),
      zoomStep,
    );
  }

  positionToBaseAddress(position: Vector3): Vector4 {
    return this.positionToZoomedAddress(position, 0);
  }

  async getLoadedBucket(bucketAddress: Vector4) {
    const bucket = this.getOrCreateBucket(bucketAddress);

    if (bucket.type === "null") {
      return bucket;
    }

    let needsToAwaitBucket = false;
    if (bucket.isRequested()) {
      needsToAwaitBucket = true;
    } else if (bucket.needsRequest()) {
      this.pullQueue.add({
        bucket: bucketAddress,
        priority: PullQueueConstants.PRIORITY_HIGHEST,
      });
      this.pullQueue.pull();
      needsToAwaitBucket = true;
    }
    if (needsToAwaitBucket) {
      await new Promise(resolve => {
        bucket.on("bucketLoaded", resolve);
      });
    }
    // Bucket has been loaded by now or was loaded already
    return bucket;
  }
}

export default DataCube;
