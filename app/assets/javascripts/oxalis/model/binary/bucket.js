/**
 * bucket.js
 * @flow
 */

import _ from "lodash";
import BackboneEvents from "backbone-events-standalone";
import type { Vector4 } from "oxalis/constants";
import TemporalBucketManager from "oxalis/model/binary/temporal_bucket_manager";
import Utils from "libs/utils";
import window from "libs/window";

export const BucketStateEnum = {
  UNREQUESTED: "UNREQUESTED",
  REQUESTED: "REQUESTED",
  LOADED: "LOADED",
};
export type BucketStateEnumType = $Keys<typeof BucketStateEnum>;

export const BUCKET_SIZE_P = 5;

function median8(dataArray) {
  return Math.round((dataArray[3] + dataArray[4]) / 2);
}

function mode(arr) {
  let currentConsecCount = 0;
  let currentModeCount = 0;
  let currentMode = null;
  let lastEl = null;
  for (let i = 0; i < 8; i++) {
    const el = arr[i];
    if (lastEl === el) {
      currentConsecCount++;
      if (currentConsecCount > currentModeCount) {
        currentModeCount = currentConsecCount;
        currentMode = el;
      }
    } else {
      currentConsecCount = 1;
    }
    lastEl = el;
  }
  return currentMode;
}

let tmp;
function swap(arr, a, b) {
  if (arr[a] > arr[b]) {
    tmp = arr[b];
    arr[b] = arr[a];
    arr[a] = tmp;
  }
}

function sortArray8(arr) {
  // This function sorts an array of size 8.
  // Swap instructions were generated here:
  // http://jgamble.ripco.net/cgi-bin/nw.cgi?inputs=8&algorithm=best&output=macro
  swap(arr, 0, 1);
  swap(arr, 2, 3);
  swap(arr, 0, 2);
  swap(arr, 1, 3);
  swap(arr, 1, 2);
  swap(arr, 4, 5);
  swap(arr, 6, 7);
  swap(arr, 4, 6);
  swap(arr, 5, 7);
  swap(arr, 5, 6);
  swap(arr, 0, 4);
  swap(arr, 1, 5);
  swap(arr, 1, 4);
  swap(arr, 2, 6);
  swap(arr, 3, 7);
  swap(arr, 3, 6);
  swap(arr, 2, 4);
  swap(arr, 3, 5);
  swap(arr, 3, 4);
}

export class DataBucket {
  type: "data" = "data";
  BIT_DEPTH: number;
  BUCKET_LENGTH: number;
  BYTE_OFFSET: number;

  state: BucketStateEnumType;
  dirty: boolean;
  accessed: boolean;
  data: ?Uint8Array;
  temporalBucketManager: TemporalBucketManager;
  zoomedAddress: Vector4;
  isPartlyOutsideBoundingBox: boolean;
  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  on: Function;
  off: Function;

  // For downsampled buckets, "dependentBucketListenerSet" stores the
  // buckets to which a listener is already attached
  dependentBucketListenerSet: Set<Bucket>;
  // For downsampled buckets, "isDirtyDueToDependent" stores the buckets
  // due to which the current bucket is dirty and need new downsampling
  isDirtyDueToDependent: Set<Bucket>;
  isDownSampled: boolean;

  constructor(
    BIT_DEPTH: number,
    zoomedAddress: Vector4,
    temporalBucketManager: TemporalBucketManager,
  ) {
    _.extend(this, BackboneEvents);
    this.BIT_DEPTH = BIT_DEPTH;
    this.BUCKET_LENGTH = (1 << (BUCKET_SIZE_P * 3)) * (this.BIT_DEPTH >> 3);
    this.BYTE_OFFSET = this.BIT_DEPTH >> 3;
    // console.log("BIT_DEPTH", BIT_DEPTH);

    this.zoomedAddress = zoomedAddress;
    this.temporalBucketManager = temporalBucketManager;

    this.state = BucketStateEnum.UNREQUESTED;
    this.dirty = false;
    this.accessed = true;
    this.isPartlyOutsideBoundingBox = false;

    this.data = null;
    this.dependentBucketListenerSet = new Set();
    this.isDirtyDueToDependent = new Set();
  }

  shouldCollect(): boolean {
    if (this.isDownSampled) {
      return false;
    }
    const collect = !this.accessed && !this.dirty && this.state !== BucketStateEnum.REQUESTED;
    this.accessed = false;
    return collect;
  }

  needsRequest(): boolean {
    return this.state === BucketStateEnum.UNREQUESTED;
  }

  isRequested(): boolean {
    return this.state === BucketStateEnum.REQUESTED;
  }

  isLoaded(): boolean {
    return this.state === BucketStateEnum.LOADED;
  }

  label(labelFunc: Uint8Array => void) {
    window.requestAnimationFrame(() => {
      labelFunc(this.getOrCreateData());
      this.dirty = true;
      this.trigger("bucketLabeled");
    });
  }

  hasData(): boolean {
    return this.data != null;
  }

  getData(): Uint8Array {
    if (this.data == null) {
      throw new Error("Bucket.getData() called, but data does not exist.");
    }

    this.accessed = true;
    return this.data;
  }

  getOrCreateData(): Uint8Array {
    if (this.data == null) {
      this.data = new Uint8Array(this.BUCKET_LENGTH);
      this.temporalBucketManager.addBucket(this);
    }

    return this.getData();
  }

  pull(): void {
    switch (this.state) {
      case BucketStateEnum.UNREQUESTED:
        this.state = BucketStateEnum.REQUESTED;
        break;
      default:
        this.unexpectedState();
    }
  }

  pullFailed(): void {
    switch (this.state) {
      case BucketStateEnum.REQUESTED:
        this.state = BucketStateEnum.UNREQUESTED;
        break;
      default:
        this.unexpectedState();
    }
  }

  receiveData(data: Uint8Array): void {
    switch (this.state) {
      case BucketStateEnum.REQUESTED:
        if (this.dirty) {
          this.merge(data);
        } else {
          this.data = data;
        }
        this.trigger("bucketLoaded");
        this.state = BucketStateEnum.LOADED;
        break;
      default:
        this.unexpectedState();
    }
  }

  push(): void {
    switch (this.state) {
      case BucketStateEnum.LOADED:
        this.dirty = false;
        break;
      default:
        this.unexpectedState();
    }
  }

  unexpectedState(): void {
    throw new Error(`Unexpected state: ${this.state}`);
  }

  downsampleFromLowerBucket(bucket: DataBucket, useMode: boolean): void {
    if (!this.dependentBucketListenerSet.has(bucket)) {
      bucket.on("bucketLabeled", () => {
        this.isDirtyDueToDependent.add(bucket);
        window.requestAnimationFrame(() => {
          if (this.isDirtyDueToDependent.has(bucket)) {
            this.downsampleFromLowerBucket(bucket, useMode);
            this.isDirtyDueToDependent.delete(bucket);
          }
        });
      });
      this.dependentBucketListenerSet.add(bucket);
    }
    this.isDownSampled = true;

    const xOffset = (bucket.zoomedAddress[0] % 2) * 16;
    const yOffset = (bucket.zoomedAddress[1] % 2) * 16;
    const zOffset = (bucket.zoomedAddress[2] % 2) * 16;

    if (!this.data) {
      this.data = new Uint8Array(this.BUCKET_LENGTH);
    }

    const xyzToIdx = (x, y, z) => 32 * 32 * z + 32 * y + x;

    const dataArray = [0, 0, 0, 0, 0, 0, 0, 0];
    const byteOffset = this.BYTE_OFFSET;

    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const linearizedIndex = xyzToIdx(x + xOffset, y + yOffset, z + zOffset);
          for (let currentByteOffset = 0; currentByteOffset < byteOffset; currentByteOffset++) {
            const targetIdx = linearizedIndex * byteOffset + currentByteOffset;
            const bucketData = bucket.getData();

            dataArray[0] =
              bucketData[xyzToIdx(2 * x, 2 * y, 2 * z) * byteOffset + currentByteOffset];
            dataArray[1] =
              bucketData[xyzToIdx(2 * x + 1, 2 * y, 2 * z) * byteOffset + currentByteOffset];
            dataArray[2] =
              bucketData[xyzToIdx(2 * x, 2 * y + 1, 2 * z) * byteOffset + currentByteOffset];
            dataArray[3] =
              bucketData[xyzToIdx(2 * x + 1, 2 * y + 1, 2 * z) * byteOffset + currentByteOffset];
            dataArray[4] =
              bucketData[xyzToIdx(2 * x, 2 * y, 2 * z + 1) * byteOffset + currentByteOffset];
            dataArray[5] =
              bucketData[xyzToIdx(2 * x + 1, 2 * y, 2 * z + 1) * byteOffset + currentByteOffset];
            dataArray[6] =
              bucketData[xyzToIdx(2 * x, 2 * y + 1, 2 * z + 1) * byteOffset + currentByteOffset];
            dataArray[7] =
              bucketData[
                xyzToIdx(2 * x + 1, 2 * y + 1, 2 * z + 1) * byteOffset + currentByteOffset
              ];

            sortArray8(dataArray);

            if (useMode) {
              // $FlowFixMe Despite having ensured that this.data is initialized properly, flow is pessimistic.
              this.data[targetIdx] = mode(dataArray);
            } else {
              // $FlowFixMe Despite having ensured that this.data is initialized properly, flow is pessimistic.
              this.data[targetIdx] = median8(dataArray);
            }
          }
        }
      }
    }
    this.trigger("bucketLoaded");
  }

  merge(newData: Uint8Array): void {
    if (this.data == null) {
      throw new Error("Bucket.merge() called, but data does not exist.");
    }
    const data = this.data;

    const voxelPerBucket = 1 << (BUCKET_SIZE_P * 3);
    for (let i = 0; i < voxelPerBucket; i++) {
      const oldVoxel = Utils.__range__(0, this.BYTE_OFFSET, false).map(
        j => data[i * this.BYTE_OFFSET + j],
      );
      const oldVoxelEmpty = _.reduce(oldVoxel, (memo, v) => memo && v === 0, true);

      if (oldVoxelEmpty) {
        for (let j = 0; j < this.BYTE_OFFSET; j++) {
          data[i * this.BYTE_OFFSET + j] = newData[i * this.BYTE_OFFSET + j];
        }
      }
    }
  }
}

export class NullBucket {
  type: "null" = "null";
  isOutOfBoundingBox: boolean;

  constructor(isOutOfBoundingBox: boolean) {
    this.isOutOfBoundingBox = isOutOfBoundingBox;
  }

  hasData(): boolean {
    return false;
  }
  needsRequest(): boolean {
    return false;
  }
  getData(): Uint8Array {
    throw new Error("NullBucket has no data.");
  }
}

export const NULL_BUCKET = new NullBucket(false);
export const NULL_BUCKET_OUT_OF_BB = new NullBucket(true);

export type Bucket = DataBucket | NullBucket;
