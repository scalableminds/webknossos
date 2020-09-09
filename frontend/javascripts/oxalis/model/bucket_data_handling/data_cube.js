/**
 * cube.js
 * @flow
 */

import BackboneEvents from "backbone-events-standalone";
import _ from "lodash";

import {
  type Bucket,
  DataBucket,
  NULL_BUCKET,
  NULL_BUCKET_OUT_OF_BB,
  NullBucket,
  type BucketDataArray,
} from "oxalis/model/bucket_data_handling/bucket";
import { type VoxelIterator, VoxelNeighborStack2D } from "oxalis/model/volumetracing/volumelayer";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import ArbitraryCubeAdapter from "oxalis/model/bucket_data_handling/arbitrary_cube_adapter";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";
import Store, { type Mapping } from "oxalis/store";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import type { DimensionMap } from "oxalis/model/dimensions";
import constants, {
  type Vector2,
  type Vector3,
  type Vector4,
  type BoundingBoxType,
} from "oxalis/constants";
import { type ElementClass } from "admin/api_flow_types";
import { areBoundingBoxesOverlappingOrTouching, map3, iterateThroughBounds } from "libs/utils";
class CubeEntry {
  data: Map<number, Bucket>;
  boundary: Vector3;

  constructor(boundary: Vector3) {
    this.data = new Map();
    this.boundary = boundary;
  }
}

export type LabeledVoxelsMap = Map<DataBucket, Uint8Array>;

class DataCube {
  MAXIMUM_BUCKET_COUNT = 5000;
  ZOOM_STEP_COUNT: number;
  arbitraryCube: ArbitraryCubeAdapter;
  upperBoundary: Vector3;
  buckets: Array<DataBucket>;
  bucketIterator: number = 0;
  bucketCount: number = 0;
  MAX_ZOOM_STEP: number;
  cubes: Array<CubeEntry>;
  boundingBox: BoundingBox;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  temporalBucketManager: TemporalBucketManager;
  isSegmentation: boolean;
  elementClass: ElementClass;
  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  on: Function;
  off: Function;

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
    resolutionsLength: number,
    elementClass: ElementClass,
    isSegmentation: boolean,
  ) {
    this.upperBoundary = upperBoundary;
    this.elementClass = elementClass;
    this.isSegmentation = isSegmentation;

    this.ZOOM_STEP_COUNT = resolutionsLength;

    this.MAX_ZOOM_STEP = this.ZOOM_STEP_COUNT - 1;

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

    const resolutions = getResolutions(Store.getState().dataset);
    for (let i = 0; i < this.ZOOM_STEP_COUNT; i++) {
      const resolution = resolutions[i];
      const zoomedCubeBoundary = [
        Math.ceil(cubeBoundary[0] / resolution[0]) + 1,
        Math.ceil(cubeBoundary[1] / resolution[1]) + 1,
        Math.ceil(cubeBoundary[2] / resolution[2]) + 1,
      ];
      this.cubes[i] = new CubeEntry(zoomedCubeBoundary);
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
      this,
    );

    listenToStoreProperty(
      state => getSomeTracing(state.tracing).boundingBox,
      boundingBox => {
        if (shouldBeRestrictedByTracingBoundingBox()) {
          this.boundingBox = new BoundingBox(boundingBox, this);
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
    return this.isSegmentation
      ? Store.getState().temporaryConfiguration.activeMapping.isMappingEnabled
      : false;
  }

  getMapping(): ?Mapping {
    return this.isSegmentation
      ? Store.getState().temporaryConfiguration.activeMapping.mapping
      : null;
  }

  shouldHideUnmappedIds(): boolean {
    return this.isSegmentation
      ? Store.getState().temporaryConfiguration.activeMapping.hideUnmappedIds
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
    if (zoomStep >= this.ZOOM_STEP_COUNT) {
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

    let bucket = this.getBucket(address);
    if (bucket instanceof NullBucket) {
      bucket = this.createBucket(address);
    }

    return bucket;
  }

  // Returns the Bucket object if it exists, or NULL_BUCKET otherwise.
  getBucket(address: Vector4): Bucket {
    if (!this.isWithinBounds(address)) {
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
    bucket.on({
      bucketLoaded: () => this.trigger("bucketLoaded", address),
    });
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
      for (let i = 0; i < 2 * this.bucketCount; i++) {
        this.bucketIterator = ++this.bucketIterator % this.MAXIMUM_BUCKET_COUNT;
        if (this.buckets[this.bucketIterator].shouldCollect()) {
          break;
        }
      }

      if (!this.buckets[this.bucketIterator].shouldCollect()) {
        console.error(
          "A bucket was forcefully garbage-collected. This indicates that too many buckets are currently in RAM.",
        );
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
            this.labelVoxelInResolution([x, y, z], 5, 0);
          }
        }
      }
    }

    this.trigger("volumeLabeled");
  }

  labelVoxelsInAllResolutions(
    iterator: VoxelIterator,
    label: number,
    activeCellId?: ?number = null,
  ): void {
    const numberOfResolutions = getResolutions(Store.getState().dataset).length;
    for (let zoomStep = 0; zoomStep < numberOfResolutions; ++zoomStep) {
      while (iterator.hasNext) {
        const voxel = iterator.getNext();
        this.labelVoxelInResolution(voxel, label, zoomStep, activeCellId);
      }
      iterator.reset();
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
            if (address[3] === 1)
              console.log(
                `labeled in bucket ${bucket.zoomedAddress.toString()}, voxel ${voxel.toString()}, voxelIndex ${voxelIndex}, with modulo ${voxel.map(
                  a => Math.floor(a / 2) % 32,
                )}`,
              );
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

  floodFill(
    seedVoxel: Vector3,
    cellId: number,
    get3DAddress: (Vector2, Vector3) => Vector3,
    get2DAddress: Vector3 => Vector2,
    dimensionIndices: DimensionMap,
    viewportBoundings: BoundingBoxType,
    zoomStep: number = 0,
  ): ?LabeledVoxelsMap {
    // This flood-fill algorithm works in two nested levels and uses a list of buckets to flood fill.
    // On the inner level a bucket is flood-filled  and if the iteration of the buckets data
    // reaches an neighbour bucket, this bucket is added to this list of buckets to flood fill.
    // The outer level simply iterates over all  buckets in the list and triggers the bucket-wise flood fill.
    // Additionally a map is created that saves all labeled voxels for each bucket. This map is returned at the end.
    //
    // Note: It is possible that a bucket is multiple times added to the list of buckets. This is intended
    // because a border of the "neighbour volume shape" might leave the neighbour bucket and enter is somewhere else.
    // If it would not be possible to have the same neighbour bucket in the list multiple times,
    // not all of the target area in the neighbour bucket might be filled.
    const bucketsWithLabeledVoxelsMap: LabeledVoxelsMap = new Map();
    const seedBucketAddress = this.positionToZoomedAddress(seedVoxel, zoomStep);
    const seedBucket = this.getOrCreateBucket(seedBucketAddress);
    if (seedBucket.type === "null") {
      return null;
    }
    const seedVoxelIndex = this.getVoxelIndex(seedVoxel, zoomStep);
    const sourceCellId = seedBucket.getOrCreateData()[seedVoxelIndex];
    if (sourceCellId === cellId) {
      return null;
    }
    const bucketsToFill: Array<[DataBucket, Vector3]> = [
      [seedBucket, this.getVoxelOffset(seedVoxel, zoomStep)],
    ];
    // Iterate over all buckets within the area and flood fill each of them.
    while (bucketsToFill.length > 0) {
      const [currentBucket, initialVoxelInBucket] = bucketsToFill.pop();
      // Check if the bucket overlaps the active viewport bounds.
      if (
        !areBoundingBoxesOverlappingOrTouching(currentBucket.getBoundingBox(), viewportBoundings)
      ) {
        continue;
      }
      const bucketData = currentBucket.getOrCreateData();
      const initialVoxelIndex = this.getVoxelIndex(initialVoxelInBucket, zoomStep);
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
        bucketsWithLabeledVoxelsMap.get(currentBucket) ||
        new Uint8Array(constants.BUCKET_WIDTH ** 2).fill(0);
      const markVoxelOfSliceAsLabeled = ([firstCoord, secondCoord]) => {
        currentLabeledVoxelMap[firstCoord * constants.BUCKET_WIDTH + secondCoord] = 1;
      };

      // Use a VoxelNeighborStack2D to iterate over the bucket in 2d and using bucket-local addresses and not global addresses.
      const initialVoxelInSlice = get2DAddress(initialVoxelInBucket);
      markVoxelOfSliceAsLabeled(initialVoxelInSlice);
      const neighbourVoxelStack = new VoxelNeighborStack2D(initialVoxelInSlice);
      // Iterating over all neighbours from the initialAddress.
      while (!neighbourVoxelStack.isEmpty()) {
        const neighbours = neighbourVoxelStack.popVoxelAndGetNeighbors();
        for (let neighbourIndex = 0; neighbourIndex < neighbours.length; ++neighbourIndex) {
          const neighbourVoxel = neighbours[neighbourIndex];

          // If the current neighbour is not in the current bucket, calculate its
          // bucket's zoomed address and add the bucket to bucketsToFill.
          // adjustedNeighbourVoxel is a copy of neighbourVoxel whose value are robust
          // against the modulo operation used in getVoxelOffset.
          const {
            isVoxelOutside,
            neighbourBucketAddress,
            adjustedVoxel: adjustedNeighbourVoxel,
          } = currentBucket.is2DVoxelInsideBucket(neighbourVoxel, dimensionIndices, zoomStep);
          const neighbourVoxel3D = get3DAddress(adjustedNeighbourVoxel, seedVoxel);
          if (isVoxelOutside) {
            // Add the bucket to the list of buckets to flood fill.
            const neighbourBucket = this.getOrCreateBucket(neighbourBucketAddress);
            if (neighbourBucket.type !== "null") {
              bucketsToFill.push([
                neighbourBucket,
                this.getVoxelOffset(neighbourVoxel3D, zoomStep),
              ]);
            }
          } else {
            // Label the current neighbour and add it to the neighbourVoxelStack to iterate over its neighbours.
            const neighbourVoxelIndex = this.getVoxelIndex(neighbourVoxel3D, zoomStep);
            if (bucketData[neighbourVoxelIndex] === sourceCellId) {
              bucketData[neighbourVoxelIndex] = cellId;
              markVoxelOfSliceAsLabeled(neighbourVoxel);
              neighbourVoxelStack.pushVoxel(neighbourVoxel);
            }
          }
        }
      }
      bucketsWithLabeledVoxelsMap.set(currentBucket, currentLabeledVoxelMap);
    }
    for (const bucket of bucketsWithLabeledVoxelsMap.keys()) {
      this.pushQueue.insert(bucket);
      bucket.trigger("bucketLabeled");
    }
    return bucketsWithLabeledVoxelsMap;
  }

  applyLabeledVoxelMapToResolution(
    labeledVoxelMap: LabeledVoxelsMap,
    sourceResolution: Vector3,
    sourceZoomStep: number,
    goalResolution: Vector3,
    goalZoomStep: number,
    cellId: number,
    thirdDimension: number,
    get3DAddress: Vector2 => Vector3,
  ) {
    const labeledBuckets = new Set();
    const voxelsToLabelInEachDirection = map3(
      (sourceVal, index) => Math.ceil(sourceVal / goalResolution[index]),
      sourceResolution,
    );
    const voxelToGoalResolution = voxelInBucket =>
      map3(
        (value, index) => Math.floor(value * (sourceResolution[index] / goalResolution[index])),
        voxelInBucket,
      );
    for (const [labeledBucket, voxelMap] of labeledVoxelMap) {
      const bucketsOfGoalResolution = this.getBucketsContainingBucket(
        labeledBucket,
        sourceResolution,
        goalResolution,
        goalZoomStep,
      );
      if (!bucketsOfGoalResolution) {
        continue;
      }
      const labelVoxelInGoalResolution = (x, y, z) => {
        const xBucket = Math.floor(x / constants.BUCKET_WIDTH);
        const yBucket = Math.floor(y / constants.BUCKET_WIDTH);
        const zBucket = Math.floor(z / constants.BUCKET_WIDTH);
        x %= constants.BUCKET_WIDTH;
        y %= constants.BUCKET_WIDTH;
        z %= constants.BUCKET_WIDTH;
        const voxelIndex = this.getVoxelIndexByVoxelOffset([x, y, z]);
        const bucket = bucketsOfGoalResolution[xBucket][yBucket][zBucket];
        const bucketData = bucket.getOrCreateData();
        bucketData[voxelIndex] = cellId;
        labeledBuckets.add(bucket);
        console.log(
          `labeled in bucket ${bucket.zoomedAddress.toString()}, voxel ${[
            x,
            y,
            z,
          ].toString()}, voxelIndex ${voxelIndex}`,
        );
        bucket.markAndAddBucketForUndo();
      };
      for (let x = 0; x < constants.BUCKET_WIDTH; x++) {
        for (let y = 0; y < constants.BUCKET_WIDTH; y++) {
          if (voxelMap[x * constants.BUCKET_WIDTH + y] === 1) {
            // TODO: Label the other buckets
            const voxelInBucket = get3DAddress([x, y]);
            debugger;
            const voxelInGoalResolution = voxelToGoalResolution(voxelInBucket);
            // The value of the third dimension was already adjusted by the get3DAddress call. Thus we rewrite this value.
            voxelInGoalResolution[thirdDimension] = voxelInBucket[thirdDimension];
            const maxVoxelBoundingInGoalResolution = [
              voxelInGoalResolution[0] + voxelsToLabelInEachDirection[0],
              voxelInGoalResolution[1] + voxelsToLabelInEachDirection[1],
              voxelInGoalResolution[2] + voxelsToLabelInEachDirection[2],
            ];
            iterateThroughBounds(
              voxelInGoalResolution,
              maxVoxelBoundingInGoalResolution,
              labelVoxelInGoalResolution,
            );
          }
        }
      }
    }
    for (const bucket of labeledBuckets.keys()) {
      console.log(`labeled in bucket ${bucket.zoomedAddress.toString()}`);
      this.pushQueue.insert(bucket);
      bucket.trigger("bucketLabeled");
    }
  }

  getBucketsContainingBucket(
    bucket: DataBucket,
    bucketResolution: Vector3,
    goalResolution: Vector3,
    zoomStep: number,
  ): ?Array<Array<Array<DataBucket>>> {
    const mapToGoalResolution = (value, index) =>
      Math.floor(value * (bucketResolution[index] / goalResolution[index]));
    const bucketMin = [bucket.zoomedAddress[0], bucket.zoomedAddress[1], bucket.zoomedAddress[2]];
    const bucketMax = [bucketMin[0] + 1, bucketMin[1] + 1, bucketMin[2] + 1];
    // If the buckets zoomStep is smaller than the wanted zoom step,
    // then the bucket is completely contained by a bucket of the higher goalResolution.
    const bucketMinInOtherResolution = map3(mapToGoalResolution, bucketMin);
    const bucketMaxInOtherResolution = map3(mapToGoalResolution, bucketMax);
    const bucketsInGoalResolution = [];
    // Iteration over all three dimensions until all buckets of the goal resolution
    // that overlap with the given bucket are added to bucketsInGoalResolution.
    // Note: The bucketsInGoalResolution.length === 0 check ensures that the bucket containing the given bucket
    // will be added to the array when the goalResolution is lower than the buckets resolution.
    for (
      let x = bucketMinInOtherResolution[0];
      x < bucketMaxInOtherResolution[0] || bucketsInGoalResolution.length === 0;
      x++
    ) {
      const bucketsInYDirection = [];
      for (
        let y = bucketMinInOtherResolution[1];
        y < bucketMaxInOtherResolution[1] || bucketsInYDirection.length === 0;
        y++
      ) {
        const bucketsInZDirection = [];
        for (
          let z = bucketMinInOtherResolution[2];
          z < bucketMaxInOtherResolution[2] || bucketsInZDirection.length === 0;
          z++
        ) {
          const bucketsZoomedAddress = [x, y, z, zoomStep];
          const currentBucketInGoalResolution = this.getOrCreateBucket(bucketsZoomedAddress);
          if (currentBucketInGoalResolution.type === "null") {
            console.warn(
              `The bucket at ${bucket.zoomedAddress.toString()} has not matching bucket` +
                ` in resolution ${goalResolution.toString()}. The buckets address is ${bucketsZoomedAddress.toString()}`,
            );
            return null;
          }
          bucketsInZDirection.push(currentBucketInGoalResolution);
        }
        bucketsInYDirection.push(bucketsInZDirection);
      }
      bucketsInGoalResolution.push(bucketsInYDirection);
    }
    return bucketsInGoalResolution;
  }

  setBucketData(zoomedAddress: Vector4, data: Uint8Array) {
    const bucket = this.getOrCreateBucket(zoomedAddress);
    if (bucket.type === "null") {
      return;
    }
    bucket.setData(data);
    this.pushQueue.insert(bucket);
  }

  triggerPushQueue() {
    this.pushQueue.push();
    this.trigger("volumeLabeled");
  }

  hasDataAtPositionAndZoomStep(voxel: Vector3, zoomStep: number = 0) {
    return this.getBucket(this.positionToZoomedAddress(voxel, zoomStep)).hasData();
  }

  getDataValue(voxel: Vector3, mapping: ?Mapping, zoomStep: number = 0): number {
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

  getVoxelIndexByVoxelOffset([x, y, z]: Vector3): number {
    return x + y * constants.BUCKET_WIDTH + z * constants.BUCKET_WIDTH ** 2;
  }

  getVoxelOffset(voxel: Vector3, zoomStep: number = 0): Vector3 {
    // No `map` for performance reasons
    const voxelOffset = [0, 0, 0];
    const resolution = getResolutions(Store.getState().dataset)[zoomStep];
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
}

export default DataCube;
