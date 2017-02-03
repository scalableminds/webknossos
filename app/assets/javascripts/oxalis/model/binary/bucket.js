/**
 * bucket.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
import type { Vector4 } from "oxalis/constants";
import TemporalBucketManager from "oxalis/model/binary/temporal_bucket_manager";
import Utils from "../../../libs/utils";

export const BucketStateEnum = {
  UNREQUESTED: 0,
  REQUESTED: 1,
  LOADED: 2,
};
const BucketStateNames = ["unrequested", "requested", "loaded"];

export const BUCKET_SIZE_P = 5;

export class Bucket {
  BIT_DEPTH: number;
  BUCKET_LENGTH: number;
  BYTE_OFFSET: number;

  state: 0 | 1 | 2;
  dirty: boolean;
  accessed: boolean;
  data: ?Uint8Array;
  temporalBucketManager: TemporalBucketManager;
  zoomedAddress: Vector4;
  // Copied from backbone events (TODO: handle this better)
  trigger: Function;


  constructor(BIT_DEPTH: number, zoomedAddress: Vector4, temporalBucketManager: TemporalBucketManager) {
    this.BIT_DEPTH = BIT_DEPTH;
    this.zoomedAddress = zoomedAddress;
    this.temporalBucketManager = temporalBucketManager;
    _.extend(this, Backbone.Events);

    this.BUCKET_LENGTH = (1 << (BUCKET_SIZE_P * 3)) * (this.BIT_DEPTH >> 3);
    this.BYTE_OFFSET = (this.BIT_DEPTH >> 3);

    this.state = BucketStateEnum.UNREQUESTED;
    this.dirty = false;
    this.accessed = true;

    this.data = null;
  }


  shouldCollect() {
    const collect = !this.accessed && !this.dirty && this.state !== BucketStateEnum.REQUESTED;
    this.accessed = false;
    return collect;
  }


  needsRequest() {
    return this.state === BucketStateEnum.UNREQUESTED;
  }


  isLoaded() {
    return this.state === BucketStateEnum.LOADED;
  }


  label(labelFunc) {
    labelFunc(this.getOrCreateData());
    this.dirty = true;
  }


  hasData() {
    return (this.data != null);
  }


  getData() {
    if (this.data == null) {
      throw new Error("Bucket.getData() called, but data does not exist.");
    }

    this.accessed = true;
    return this.data;
  }


  getOrCreateData() {
    if (this.data == null) {
      this.data = new Uint8Array(this.BUCKET_LENGTH);
      this.temporalBucketManager.addBucket(this);
    }

    return this.getData();
  }


  pull() {
    this.state = (() => {
      switch (this.state) {
        case BucketStateEnum.UNREQUESTED: return BucketStateEnum.REQUESTED;
        default: return this.unexpectedState();
      }
    })();
  }


  pullFailed() {
    this.state = (() => {
      switch (this.state) {
        case BucketStateEnum.REQUESTED: return BucketStateEnum.UNREQUESTED;
        default: return this.unexpectedState();
      }
    })();
  }


  receiveData(data) {
    this.state = (() => {
      switch (this.state) {
        case BucketStateEnum.REQUESTED:
          if (this.dirty) {
            this.merge(data);
          } else {
            this.data = data;
          }
          this.trigger("bucketLoaded");
          return BucketStateEnum.LOADED;
        default:
          return this.unexpectedState();
      }
    })();
  }


  push() {
    switch (this.state) {
      case BucketStateEnum.LOADED:
        this.dirty = false;
        break;
      default:
        this.unexpectedState();
    }
  }


  unexpectedState() {
    throw new Error(`Unexpected state: ${BucketStateNames[this.state]}`);
  }


  merge(newData) {
    if (this.data == null) {
      throw new Error("Bucket.merge() called, but data does not exist.");
    }
    const data = this.data;

    const voxelPerBucket = 1 << (BUCKET_SIZE_P * 3);
    for (let i = 0; i < voxelPerBucket; i++) {
      const oldVoxel = (Utils.__range__(0, this.BYTE_OFFSET, false).map(j => data[(i * this.BYTE_OFFSET) + j]));
      const oldVoxelEmpty = _.reduce(oldVoxel, ((memo, v) => memo && v === 0), true);

      if (oldVoxelEmpty) {
        for (let j = 0; j < this.BYTE_OFFSET; j++) {
          data[(i * this.BYTE_OFFSET) + j] = newData[(i * this.BYTE_OFFSET) + j];
        }
      }
    }
  }
}


export class NullBucket {
  static TYPE_OUT_OF_BOUNDING_BOX = 1;
  static TYPE_OTHER = 2;

  isNullBucket: boolean;
  isOutOfBoundingBox: boolean;

  constructor(type) {
    this.isNullBucket = true;
    this.isOutOfBoundingBox = type === NullBucket.TYPE_OUT_OF_BOUNDING_BOX;
  }

  hasData() { return false; }
  needsRequest() { return false; }
}
export const NULL_BUCKET_OUT_OF_BB = new NullBucket(NullBucket.TYPE_OUT_OF_BOUNDING_BOX);
export const NULL_BUCKET = new NullBucket(NullBucket.TYPE_OTHER);

