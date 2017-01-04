import _ from "lodash";
import Cube from "./cube";
import Request from "../../../libs/request";

class PullQueue {
  static initClass() {
    // Constants
    this.prototype.BATCH_LIMIT = 6;

    // For buckets that should be loaded immediately and
    // should never be removed from the queue
    this.prototype.PRIORITY_HIGHEST = -1;

    this.prototype.cube = null;
    this.prototype.queue = null;

    this.prototype.batchCount = 0;
    this.prototype.roundTripTime = 0;
  }


  constructor(cube, layer, connectionInfo, datastoreInfo) {
    this.cube = cube;
    this.layer = layer;
    this.connectionInfo = connectionInfo;
    this.datastoreInfo = datastoreInfo;
    this.queue = [];
    this.BATCH_SIZE = this.isNDstore() ? 1 : 3;

    // Debug option.
    // If true, buckets of all 0 will be transformed to have 255 bytes everywhere.
    this.whitenEmptyBuckets = false;
  }


  pull() {
    // Filter and sort queue, using negative priorities for sorting so .pop() can be used to get next bucket
    this.queue = _.filter(this.queue, item => this.cube.getOrCreateBucket(item.bucket).needsRequest(),
    );
    this.queue = _.sortBy(this.queue, item => item.priority);

    // Starting to download some buckets
    return (() => {
      const result = [];
      while (this.batchCount < this.BATCH_LIMIT && this.queue.length) {
        let item;
        const batch = [];
        while (batch.length < this.BATCH_SIZE && this.queue.length) {
          const address = this.queue.shift().bucket;
          const bucket = this.cube.getOrCreateBucket(address);

          // Buckets might be in the Queue multiple times
          if (!bucket.needsRequest()) { continue; }

          batch.push(address);
          bucket.pull();
        }

        if (batch.length > 0) {
          item = this.pullBatch(batch);
        }
        result.push(item);
      }
      return result;
    })();
  }


  pullBatch(batch) {
    // Loading a bunch of buckets
    this.batchCount++;

    // Measuring the time until response arrives to select appropriate preloading strategy
    const roundTripBeginTime = new Date();

    return Request.always(
      this.layer.requestFromStore(batch).then((responseBuffer) => {
        let bucketData;
        this.connectionInfo.log(this.layer.name, roundTripBeginTime, batch.length, responseBuffer.length);

        let offset = 0;
        return batch.map(bucket =>
          (bucketData = responseBuffer.subarray(offset, offset += this.cube.BUCKET_LENGTH),
          this.cube.boundingBox.removeOutsideArea(bucket, bucketData),
          this.maybeWhitenEmptyBucket(bucketData),
          this.cube.getBucket(bucket).receiveData(bucketData)));
      },
      ).catch((error) => {
        for (const bucketAddress of batch) {
          const bucket = this.cube.getBucket(bucketAddress);
          bucket.pullFailed();
          if (bucket.dirty) {
            this.add({ bucket: bucketAddress, priority: this.PRIORITY_HIGHEST });
          }
        }

        return console.error(error);
      },
      ),
      () => {
        this.batchCount--;
        return this.pull();
      },
    );
  }


  clearNormalPriorities() {
    return this.queue = _.filter(this.queue, e => e.priority === this.PRIORITY_HIGHEST);
  }


  add(item) {
    return this.queue.push(item);
  }


  addAll(items) {
    return this.queue = this.queue.concat(items);
  }


  isNDstore() {
    return this.datastoreInfo.typ === "ndstore";
  }


  maybeWhitenEmptyBucket(bucketData) {
    if (!this.whitenEmptyBuckets) { return; }

    const allZero = _.reduce(bucketData, ((res, e) => res && e === 0), true);

    if (allZero) {
      return __range__(0, bucketData.length, false).map(i =>
        bucketData[i] = 255);
    }
  }
}
PullQueue.initClass();


export default PullQueue;

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
