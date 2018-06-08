/**
 * bucket.js
 * @flow
 */

import _ from "lodash";
import BackboneEvents from "backbone-events-standalone";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import Utils from "libs/utils";
import window from "libs/window";
import Toast from "libs/toast";

export const BucketStateEnum = {
  UNREQUESTED: "UNREQUESTED",
  REQUESTED: "REQUESTED",
  LOADED: "LOADED",
};
export type BucketStateEnumType = $Keys<typeof BucketStateEnum>;

export const BUCKET_SIZE_P = 5;

const warnAboutDownsamplingRGB = _.once(() =>
  Toast.warning("Zooming out for RGB data is limited. Zoom further in if data is not shown."),
);

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
  once: Function;

  // For downsampled buckets, "dependentBucketListenerSet" stores the
  // buckets to which a listener is already attached
  dependentBucketListenerSet: WeakSet<Bucket> = new WeakSet();
  // We cannot use dependentBucketListenerSet.length for that, since WeakSets don't hold that information
  dependentCounter: number = 0;
  // For downsampled buckets, "isDirtyDueToDependent" stores the buckets
  // due to which the current bucket is dirty and need new downsampling
  isDirtyDueToDependent: WeakSet<Bucket> = new WeakSet();
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

    this.zoomedAddress = zoomedAddress;
    this.temporalBucketManager = temporalBucketManager;

    this.state = BucketStateEnum.UNREQUESTED;
    this.dirty = false;
    this.accessed = true;
    this.isPartlyOutsideBoundingBox = false;

    this.data = null;
  }

  shouldCollect(): boolean {
    if (this.dependentCounter > 0) {
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
    labelFunc(this.getOrCreateData());
    this.dirty = true;
    this.throttledTriggerLabeled();
  }

  throttledTriggerLabeled = _.throttle(() => this.trigger("bucketLabeled"), 10);

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

  downsampleFromLowerBucket(
    bucket: DataBucket,
    resolutionsFactors: Vector3,
    useMode: boolean,
  ): void {
    if (!this.dependentBucketListenerSet.has(bucket)) {
      const bucketLabeledHandler = () => {
        this.isDirtyDueToDependent.add(bucket);
        window.requestAnimationFrame(() => {
          if (this.isDirtyDueToDependent.has(bucket)) {
            this.downsampleFromLowerBucket(bucket, resolutionsFactors, useMode);
            this.isDirtyDueToDependent.delete(bucket);
          }
        });
      };
      bucket.on("bucketLabeled", bucketLabeledHandler);
      bucket.once("bucketCollected", () => {
        bucket.off("bucketLabeled", bucketLabeledHandler);
        this.dependentBucketListenerSet.delete(bucket);
        this.dependentCounter--;
      });
      this.dependentBucketListenerSet.add(bucket);
      this.dependentCounter++;
    }
    this.isDownSampled = true;

    const [xFactor, yFactor, zFactor] = resolutionsFactors;

    if (xFactor !== 2 || yFactor !== 2 || [1, 2].indexOf(zFactor) === -1) {
      // downsampling for anisotropic datasets is only supported when x and y change
      // isotropically and z stays the same or doubles its resolution
      throw new Error("Downsampling initiated for unsupported resolution change");
    }

    const octantExtents = [
      constants.BUCKET_WIDTH / xFactor,
      constants.BUCKET_WIDTH / yFactor,
      constants.BUCKET_WIDTH / zFactor,
    ];
    const xOffset = (bucket.zoomedAddress[0] % xFactor) * octantExtents[0];
    const yOffset = (bucket.zoomedAddress[1] % yFactor) * octantExtents[1];
    const zOffset = (bucket.zoomedAddress[2] % zFactor) * octantExtents[2];

    if (!this.data) {
      this.data = new Uint8Array(this.BUCKET_LENGTH);
    }

    const xyzToIdx = (x, y, z) => 32 * 32 * z + 32 * y + x;
    const byteOffset = this.BYTE_OFFSET;

    if (byteOffset === 3) {
      // Since JS doesn't offer Uint24Arrays, we don't downsample buckets
      // for 24 byte data. This should only affect RGB data, which is only rarely
      // used anyway.
      warnAboutDownsamplingRGB();
      return;
    }

    function reviewUint8Array(
      arr: Uint8Array,
      bytesPerEntry: number,
    ): Uint8Array | Uint16Array | Uint32Array {
      const UintArrayType = (() => {
        switch (bytesPerEntry) {
          case 1:
            return Uint8Array;
          case 2:
            return Uint16Array;
          case 4:
            return Uint32Array;
          default:
            throw new Error("Unhandled byte count");
        }
      })();

      return new UintArrayType(arr.buffer, arr.byteOffset, arr.byteLength / bytesPerEntry);
    }

    const thisDataView = reviewUint8Array(this.data, byteOffset);
    const bucketDataView = reviewUint8Array(bucket.getData(), byteOffset);

    const dataArray = [0, 0, 0, 0, 0, 0, 0, 0];

    const samplingFunction = useMode ? Utils.mode8 : Utils.median8;

    for (let z = 0; z < octantExtents[2]; z++) {
      for (let y = 0; y < octantExtents[1]; y++) {
        for (let x = 0; x < octantExtents[0]; x++) {
          const linearizedIndex = xyzToIdx(x + xOffset, y + yOffset, z + zOffset);
          const targetIdx = linearizedIndex;

          const xIdx = xFactor * x;
          const yIdx = yFactor * y;
          const zIdx = zFactor * z;

          dataArray[0] = bucketDataView[xyzToIdx(xIdx, yIdx, zIdx)];
          dataArray[1] = bucketDataView[xyzToIdx(xIdx + 1, yIdx, zIdx)];
          dataArray[2] = bucketDataView[xyzToIdx(xIdx, yIdx + 1, zIdx)];
          dataArray[3] = bucketDataView[xyzToIdx(xIdx + 1, yIdx + 1, zIdx)];

          dataArray[4] = bucketDataView[xyzToIdx(xIdx, yIdx, zIdx + 1)];
          dataArray[5] = bucketDataView[xyzToIdx(xIdx + 1, yIdx, zIdx + 1)];
          dataArray[6] = bucketDataView[xyzToIdx(xIdx, yIdx + 1, zIdx + 1)];
          dataArray[7] = bucketDataView[xyzToIdx(xIdx + 1, yIdx + 1, zIdx + 1)];

          Utils.sortArray8(dataArray);

          // $FlowFixMe Despite having ensured that this.data is initialized properly, flow is pessimistic.
          thisDataView[targetIdx] = samplingFunction(dataArray);
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
