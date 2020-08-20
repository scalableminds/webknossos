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
import { type VoxelIterator, Dynamic2DVoxelIterator } from "oxalis/model/volumetracing/volumelayer";
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
import constants, { type Vector3, type Vector4 } from "oxalis/constants";
import { type ElementClass } from "admin/api_flow_types";

class CubeEntry {
  data: Map<number, Bucket>;
  boundary: Vector3;

  constructor(boundary: Vector3) {
    this.data = new Map();
    this.boundary = boundary;
  }
}

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

  // The cube stores the buckets in a seperate array for each zoomStep. For each
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
            this.labelVoxel([x, y, z], 5);
          }
        }
      }
    }

    this.trigger("volumeLabeled");
  }

  labelVoxels(iterator: VoxelIterator, label: number, activeCellId?: ?number = null): void {
    while (iterator.hasNext) {
      const voxel = iterator.getNext();
      this.labelVoxel(voxel, label, activeCellId);
    }

    this.pushQueue.push();
    this.trigger("volumeLabeled");
  }

  labelVoxel(voxel: Vector3, label: number, activeCellId: ?number): void {
    let voxelInCube = true;
    for (let i = 0; i <= 2; i++) {
      voxelInCube = voxelInCube && voxel[i] >= 0 && voxel[i] < this.upperBoundary[i];
    }
    if (voxelInCube) {
      const address = this.positionToBaseAddress(voxel);
      const bucket = this.getOrCreateBucket(address);
      if (bucket instanceof DataBucket) {
        const voxelIndex = this.getVoxelIndex(voxel);

        let shouldUpdateVoxel = true;
        if (activeCellId != null) {
          const voxelValue = this.getMappedDataValue(voxel);
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

  floodFill(
    initialVoxel: Vector3,
    cellId: number,
    get3DAddress: Vector2 => Vector3,
    get2DAddress: Vector3 => Vector2,
    zoomStep: number = 0,
  ) {
    // needed: click position + viewport
    // only above, bottom, left ,right
    const address = this.positionToBaseAddress(initialVoxel, zoomStep);
    const bucket = this.getOrCreateBucket(address);
    const initialVoxelIndex = this.getVoxelIndex(initialVoxel);
    const sourceCellId = bucket.getOrCreateData()[initialVoxelIndex];
    // TODO: The bucket should be able to appear multiple times in the map -> use a different key;
    // -> use an array as a stack
    // Mapping from bucketIndex to bucket and initial voxel for flood fill.
    const bucketsToFill: Array<[Bucket, Vector3]> = [];
    const bucketIndex = this.getBucketIndex(initialVoxel);
    if (bucketIndex == null) {
      return;
    }
    bucketsToFill.push([bucket, initialVoxelIndex]);
    const floodFillBucket = (currentBucket: Bucket, initialAddress: Vector3) => {
      const bucketData = currentBucket.getOrCreateData();
      const currentVoxel = this.getVoxelIndex(initialAddress);
      if (bucketData[currentVoxel] !== sourceCellId) {
        // Ignoring neighbour buckets whose cellId at the initial position do not match the source cell id.
        return;
      }
      const currentVoxelIterator = new Dynamic2DVoxelIterator(get2DAddress(initialAddress));
      while (currentVoxelIterator.notEmpty()) {
        const neighbours = currentVoxelIterator.getNeighbors();
        currentVoxelIterator.step();
        for (let i = 0; i < neighbours.length; ++i) {
          const neighbourVoxel = neighbours[i];
          const neighbourVoxel3D = get3DAddress(neighbourVoxel);
          // The zoomed address of the neighbour bucket if the neighbour is in another bucket.
          let neighbourBucketAddress: ?Vector3 = null;
          for (let dim = 0; dim < 2; ++dim) {
            if (neighbourBucketAddress[dim] < constants.BUCKET_WIDTH) {
              neighbourBucketAddress = [
                bucket.zoomedAddress[0],
                bucket.zoomedAddress[1],
                bucket.zoomedAddress[2],
              ];
              neighbourBucketAddress[dim] -= 1;
            } else if (neighbourBucketAddress[dim] > constants.BUCKET_WIDTH) {
              neighbourBucketAddress = [
                bucket.zoomedAddress[0],
                bucket.zoomedAddress[1],
                bucket.zoomedAddress[2],
              ];
              neighbourBucketAddress[dim] += 1;
            }
          }
          if (neighbourBucketAddress) {
            const neighbourBucket = this.getOrCreateBucket(neighbourBucketAddress);
            bucketsToFill.push([neighbourBucket, neighbourVoxel3D]);
          } else {
            const neighbourVoxelIndex = this.getVoxelIndex(neighbourVoxel3D);
            if (bucketData[neighbourVoxelIndex] === sourceCellId) {
              bucketData[neighbourVoxelIndex] = cellId;
              currentVoxelIterator.add(neighbourVoxel);
            }
          }
        }
      }
    };
    while (floodFillBucket.length > 0) {
      const [currentBucket, initialAddress] = floodFillBucket.pop();
      floodFillBucket(currentBucket, initialAddress);
    }
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

  getVoxelIndex(voxel: Vector3, zoomStep: number = 0): number {
    // No `map` for performance reasons
    const voxelOffset = [0, 0, 0];
    const resolution = getResolutions(Store.getState().dataset)[zoomStep];
    for (let i = 0; i < 3; i++) {
      voxelOffset[i] = Math.floor(voxel[i] / resolution[i]) % constants.BUCKET_WIDTH;
    }
    return this.getVoxelIndexByVoxelOffset(voxelOffset);
  }

  positionToZoomedAddress(position: Vector3, resolutionIndex: number = 0): Vector4 {
    // return the bucket a given voxel lies in
    return globalPositionToBucketPosition(
      position,
      getResolutions(Store.getState().dataset),
      resolutionIndex,
    );
  }

  positionToBaseAddress(position: Vector3): Vector4 {
    return this.positionToZoomedAddress(position, 0);
  }
}

export default DataCube;
