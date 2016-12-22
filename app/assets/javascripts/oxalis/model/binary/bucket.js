import Backbone from "backbone";
import _ from "lodash";

let STATE_NAMES = undefined;
class Bucket {
  static initClass() {
  
  
    this.prototype.STATE_UNREQUESTED  = 0;
    this.prototype.STATE_REQUESTED  = 1;
    this.prototype.STATE_LOADED  = 2;
  
    STATE_NAMES = ["unrequested", "requested", "loaded"];
  
    this.prototype.BUCKET_SIZE_P  = 5;
  }


  constructor(BIT_DEPTH, zoomedAddress, temporalBucketManager) {

    this.BIT_DEPTH = BIT_DEPTH;
    this.zoomedAddress = zoomedAddress;
    this.temporalBucketManager = temporalBucketManager;
    _.extend(this, Backbone.Events);

    this.BUCKET_LENGTH = (1 << (this.BUCKET_SIZE_P * 3)) * (this.BIT_DEPTH >> 3);
    this.BYTE_OFFSET   = (this.BIT_DEPTH >> 3);

    this.state = this.STATE_UNREQUESTED;
    this.dirty = false;
    this.accessed = true;

    this.data = null;
  }


  shouldCollect() {

    const collect = !this.accessed && !this.dirty && this.state !== this.STATE_REQUESTED;
    this.accessed = false;
    return collect;
  }


  needsRequest() {

    return this.state === this.STATE_UNREQUESTED;
  }


  isLoaded() {

    return this.state === this.STATE_LOADED;
  }


  label(labelFunc) {

    labelFunc(this.getOrCreateData());
    return this.dirty = true;
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

    return this.state = (() => { switch (this.state) {
      case this.STATE_UNREQUESTED: return this.STATE_REQUESTED;
      default: return this.unexpectedState();
    } })();
  }


  pullFailed() {

    return this.state = (() => { switch (this.state) {
      case this.STATE_REQUESTED: return this.STATE_UNREQUESTED;
      default: return this.unexpectedState();
    } })();
  }


  receiveData(data) {

    return this.state = (() => { switch (this.state) {
      case this.STATE_REQUESTED:
        if (this.dirty) {
          this.merge(data);
        } else {
          this.data = data;
        }
        this.trigger("bucketLoaded");
        return this.STATE_LOADED;
      default:
        return this.unexpectedState();
    } })();
  }


  push() {

    switch (this.state) {
      case this.STATE_LOADED:
        return this.dirty = false;
      default:
        return this.unexpectedState();
    }
  }


  unexpectedState() {

    throw new Error(`Unexpected state: ${this.STATE_NAMES[this.state]}`);
  }


  merge(newData) {

    const voxelPerBucket = 1 << (this.BUCKET_SIZE_P * 3);
    return (() => {
      const result = [];
      for (let i of __range__(0, voxelPerBucket, false)) {

        let item;
        const oldVoxel = (__range__(0, this.BYTE_OFFSET, false).map((j) => this.data[(i * this.BYTE_OFFSET) + j]));
        const oldVoxelEmpty = _.reduce(oldVoxel, ((memo, v) => memo && v === 0), true);

        if (oldVoxelEmpty) {
          item = __range__(0, this.BYTE_OFFSET, false).map((j) =>
            this.data[(i * this.BYTE_OFFSET) + j] = newData[(i * this.BYTE_OFFSET) + j]);
        }
        result.push(item);
      }
      return result;
    })();
  }
}
Bucket.initClass();


class NullBucket {
  static initClass() {
  
    // A NullBucket represents a bucket that does not exist, e.g. because it's
    // outside the dataset's bounding box. It supports only a small subset of
    // Bucket's methods.
  
  
    this.prototype.TYPE_OUT_OF_BOUNDING_BOX  = 1;
    this.prototype.TYPE_OTHER  = 2;
  }


  constructor(type) {

    this.isNullBucket = true;
    this.isOutOfBoundingBox = type === this.TYPE_OUT_OF_BOUNDING_BOX;
  }


  hasData() { return false; }
  needsRequest() { return false; }
}
NullBucket.initClass();


export { Bucket, NullBucket };

function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}