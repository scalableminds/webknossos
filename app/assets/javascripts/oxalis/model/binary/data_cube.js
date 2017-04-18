/**
 * cube.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import type { Vector3, Vector4 } from "oxalis/constants";
import PullQueue from "oxalis/model/binary/pullqueue";
import PushQueue from "oxalis/model/binary/pushqueue";
import type { MappingArray } from "oxalis/model/binary/mappings";
import type { BoundingBoxType } from "oxalis/model";
import type { VoxelIterator } from "oxalis/model/volumetracing/volumelayer";
import { DataBucket, NullBucket, NULL_BUCKET, NULL_BUCKET_OUT_OF_BB, BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import type { Bucket } from "oxalis/model/binary/bucket";
import ArbitraryCubeAdapter from "oxalis/model/binary/arbitrary_cube_adapter";
import TemporalBucketManager from "oxalis/model/binary/temporal_bucket_manager";
import BoundingBox from "oxalis/model/binary/bounding_box";

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
  BUCKET_LENGTH: number;
  ZOOM_STEP_COUNT: number;
  LOOKUP_DEPTH_UP: number;
  LOOKUP_DEPTH_DOWN: number = 1;
  arbitraryCube: ArbitraryCubeAdapter;
  upperBoundary: Vector3;
  buckets: Array<DataBucket>;
  bucketIterator: number = 0;
  bucketCount: number = 0;
  BIT_DEPTH: number;
  MAX_ZOOM_STEP: number;
  BYTE_OFFSET: number;
  cubes: Array<?CubeEntry>;
  boundingBox: BoundingBox;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  temporalBucketManager: TemporalBucketManager;
  // If the mapping is enabled, this.currentMapping === this.mapping
  // Otherwise, it's null
  currentMapping: ?MappingArray;
  mapping: ?MappingArray;
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
  // When buckets have to be collected, an iterator will loop through the the buckets at the beginning of the queue will be removed
  // from the queue and the access-value will be decreased. If the access-value of a
  // bucket becomes 0, itsis no longer in the access-queue and is least resently used.
  // It is then removed from the cube.


  constructor(globalBoundingBox: BoundingBoxType, upperBoundary: Vector3, zoomStepCount: number, bitDepth: number) {
    this.upperBoundary = upperBoundary;
    this.ZOOM_STEP_COUNT = zoomStepCount;
    this.BIT_DEPTH = bitDepth;
    _.extend(this, Backbone.Events);

    this.LOOKUP_DEPTH_UP = this.ZOOM_STEP_COUNT - 1;
    this.MAX_ZOOM_STEP = this.ZOOM_STEP_COUNT - 1;
    this.BUCKET_LENGTH = (1 << (BUCKET_SIZE_P * 3)) * (this.BIT_DEPTH >> 3);
    this.BYTE_OFFSET = (this.BIT_DEPTH >> 3);

    this.cubes = [];
    this.buckets = new Array(this.MAXIMUM_BUCKET_COUNT);

    this.mapping = null;
    this.currentMapping = null;

    // Initializing the cube-arrays with boundaries
    let cubeBoundary = [
      Math.ceil(this.upperBoundary[0] / (1 << BUCKET_SIZE_P)),
      Math.ceil(this.upperBoundary[1] / (1 << BUCKET_SIZE_P)),
      Math.ceil(this.upperBoundary[2] / (1 << BUCKET_SIZE_P)),
    ];

    this.arbitraryCube = new ArbitraryCubeAdapter(this, _.clone(cubeBoundary));

    for (let i = 0; i < this.ZOOM_STEP_COUNT; i++) {
      this.cubes[i] = new CubeEntry(_.clone(cubeBoundary));

      cubeBoundary = [
        (cubeBoundary[0] + 1) >> 1,
        (cubeBoundary[1] + 1) >> 1,
        (cubeBoundary[2] + 1) >> 1,
      ];
    }

    this.boundingBox = new BoundingBox(globalBoundingBox, this);
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


  setMappingEnabled(isEnabled: boolean): void {
    this.currentMapping = isEnabled ? this.mapping : null;
    this.trigger("newMapping");
  }


  hasMapping(): boolean {
    return this.mapping != null;
  }


  setMapping(newMapping: MappingArray): void {
    // Generate fake mapping
    // if not newMapping.length
    //  newMapping = new newMapping.constructor(1 << @BIT_DEPTH)
    //  for i in [0...(1 << @BIT_DEPTH)]
    //    newMapping[i] = if i == 0 then 0 else i + 1

    if (this.currentMapping === this.mapping) {
      this.currentMapping = newMapping;
    }
    this.mapping = newMapping;

    this.trigger("newMapping");
  }


  mapId(idToMap: number): number {
    let mappedId = null;
    if (this.currentMapping != null) {
      mappedId = this.currentMapping[idToMap];
    }
    return mappedId != null ? mappedId : idToMap;
  }


  getArbitraryCube(): ArbitraryCubeAdapter {
    return this.arbitraryCube;
  }


  getVoxelIndexByVoxelOffset([x, y, z]: Vector3): number {
    return this.BYTE_OFFSET *
      (x + (y * (1 << BUCKET_SIZE_P)) + (z * (1 << (BUCKET_SIZE_P * 2))));
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
      return (x * boundary[2] * boundary[1]) + (y * boundary[2]) + z;
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
    const bucket = new DataBucket(this.BIT_DEPTH, address, this.temporalBucketManager);
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


  addBucketToGarbageCollection(bucket: DataBucket): void {
    if (this.bucketCount >= this.MAXIMUM_BUCKET_COUNT) {
      for (let i = 0; i < 2 * this.bucketCount; i++) {
        this.bucketIterator = ++this.bucketIterator % this.MAXIMUM_BUCKET_COUNT;
        if (this.buckets[this.bucketIterator].shouldCollect()) { break; }
      }

      if (!this.buckets[this.bucketIterator].shouldCollect()) {
        throw new Error("All buckets have shouldCollect == false permanently");
      }

      this.collectBucket(this.buckets[this.bucketIterator]);
      this.bucketCount--;
    }

    this.bucketCount++;
    this.buckets[this.bucketIterator] = bucket;
    this.bucketIterator = ++this.bucketIterator % this.MAXIMUM_BUCKET_COUNT;
  }


  collectBucket(bucket: DataBucket): void {
    const address = bucket.zoomedAddress;
    const bucketIndex = this.getBucketIndex(address);
    const cube = this.cubes[address[3]];
    if (bucketIndex != null && cube != null) {
      cube.data.delete(bucketIndex);
    }
  }


  labelTestShape(): void {
    // draw a sqhere, centered at (100, 100, 100) with radius 50

    for (let x = 80; x <= 120; x++) {
      for (let y = 80; y <= 120; y++) {
        for (let z = 80; z <= 120; z++) {
          if (Math.sqrt(((x - 100) * (x - 100)) + ((y - 100) * (y - 100)) + ((z - 100) * (z - 100))) <= 20) {
            this.labelVoxel([x, y, z], 5);
          }
        }
      }
    }

    this.trigger("volumeLabeled");
  }


  labelVoxels(iterator: VoxelIterator, label: number): void {
    while (iterator.hasNext) {
      const voxel = iterator.getNext();
      this.labelVoxel(voxel, label);
    }

    this.pushQueue.push();
    this.trigger("volumeLabeled");
  }


  labelVoxel(voxel: Vector3, label: number): void {
    let voxelInCube = true;
    for (let i = 0; i <= 2; i++) {
      voxelInCube = voxelInCube && voxel[i] >= 0 && voxel[i] < this.upperBoundary[i];
    }
    if (voxelInCube) {
      const address = this.positionToZoomedAddress(voxel);
      const bucket = this.getOrCreateBucket(address);
      if (bucket instanceof DataBucket) {
        const voxelIndex = this.getVoxelIndex(voxel);

        const labelFunc = (data: Uint8Array): void => {
          // Write label in little endian order
          for (let i = 0; i < this.BYTE_OFFSET; i++) {
            data[voxelIndex + i] = (label >> (i * 8)) & 0xff;
          }
        };
        bucket.label(labelFunc);

        // Push bucket if it's loaded, otherwise, TemporalBucketManager will push
        // it once it is.
        if (bucket.isLoaded()) {
          this.pushQueue.insert(address);
        }
      }
    }
  }


  getDataValue(voxel: Vector3, mapping: ?MappingArray): number {
    const bucket = this.getBucket(this.positionToZoomedAddress(voxel));
    const voxelIndex = this.getVoxelIndex(voxel);

    if (bucket.hasData()) {
      const data = bucket.getData();
      let result = 0;
      // Assuming little endian byte order
      for (let i = 0; i < this.BYTE_OFFSET; i++) {
        result += (1 << (8 * i)) * data[voxelIndex + i];
      }

      if (mapping) {
        const mappedValue = mapping[result];
        if (mappedValue != null) {
          return mappedValue;
        }
      }

      return result;
    }

    return 0;
  }


  getMappedDataValue(voxel: Vector3): number {
    return this.getDataValue(voxel, this.currentMapping);
  }


  getVoxelIndex(voxel: Vector3): number {
    // No `map` for performance reasons
    const voxelOffset = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      voxelOffset[i] = voxel[i] & 0b11111;
    }
    return this.getVoxelIndexByVoxelOffset(voxelOffset);
  }


  positionToZoomedAddress([x, y, z]: Vector3, zoomStep: number = 0): Vector4 {
    // return the bucket a given voxel lies in
    return [
      x >> (BUCKET_SIZE_P + zoomStep),
      y >> (BUCKET_SIZE_P + zoomStep),
      z >> (BUCKET_SIZE_P + zoomStep),
      zoomStep,
    ];
  }
}

export default DataCube;
