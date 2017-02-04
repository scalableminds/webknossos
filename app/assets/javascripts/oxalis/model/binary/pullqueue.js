/**
 * pullqueue.js
 * @flow weak
 */

import _ from "lodash";
import DataCube from "oxalis/model/binary/data_cube";
import BinaryDataConnectionInfo from "../binarydata_connection_info";
import { Bucket } from "./bucket";
import Layer from "./layers/layer";
import Utils from "../../../libs/utils";
import Request from "../../../libs/request";

type DatastoreInfoType = {
  url: string,
  typ: string,
};

type PullQueueItemType = {
  priority: number,
  bucket: Bucket,
};

export const PullQueueConstants = {
  // For buckets that should be loaded immediately and
  // should never be removed from the queue
  PRIORITY_HIGHEST: -1,
  BATCH_LIMIT: 6,
};

class PullQueue {

  BATCH_SIZE: number;
  cube: DataCube;
  queue: Array<PullQueueItemType>;
  batchCount: number;
  roundTripTime: number;
  layer: Layer;
  whitenEmptyBuckets: boolean;
  connectionInfo: BinaryDataConnectionInfo;
  datastoreInfo: DatastoreInfoType;

  static initClass() {
  }


  constructor(cube, layer, connectionInfo, datastoreInfo) {
    this.cube = cube;
    this.layer = layer;
    this.connectionInfo = connectionInfo;
    this.datastoreInfo = datastoreInfo;
    this.queue = [];
    this.BATCH_SIZE = this.isNDstore() ? 1 : 3;
    this.batchCount = 0;
    this.roundTripTime = 0;

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
    const promises = [];
    while (this.batchCount < PullQueueConstants.BATCH_LIMIT && this.queue.length) {
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
        promises.push(this.pullBatch(batch));
      }
    }
    return promises;
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
        for (const bucket of batch) {
          bucketData = responseBuffer.subarray(offset, offset += this.cube.BUCKET_LENGTH);
          this.cube.boundingBox.removeOutsideArea(bucket, bucketData);
          this.maybeWhitenEmptyBucket(bucketData);
          this.cube.getBucket(bucket).receiveData(bucketData);
        }
      },
      ).catch((error) => {
        for (const bucketAddress of batch) {
          const bucket = this.cube.getBucket(bucketAddress);
          bucket.pullFailed();
          if (bucket.dirty) {
            this.add({ bucket: bucketAddress, priority: PullQueueConstants.PRIORITY_HIGHEST });
          }
        }

        console.error(error);
      },
      ),
      () => {
        this.batchCount--;
        this.pull();
      },
    );
  }


  clearNormalPriorities() {
    this.queue = _.filter(this.queue, e => e.priority === PullQueueConstants.PRIORITY_HIGHEST);
  }


  add(item) {
    this.queue.push(item);
  }


  addAll(items) {
    this.queue = this.queue.concat(items);
  }


  isNDstore() {
    return this.datastoreInfo.typ === "ndstore";
  }


  maybeWhitenEmptyBucket(bucketData) {
    if (!this.whitenEmptyBuckets) { return; }

    const allZero = _.reduce(bucketData, ((res, e) => res && e === 0), true);

    if (allZero) {
      Utils.__range__(0, bucketData.length, false).forEach((i) => { bucketData[i] = 255; });
    }
  }
}
PullQueue.initClass();


export default PullQueue;
