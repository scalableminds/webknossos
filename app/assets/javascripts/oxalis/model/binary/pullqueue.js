/**
 * pullqueue.js
 * @flow
 */

import _ from "lodash";
import DataCube from "oxalis/model/binary/data_cube";
import BinaryDataConnectionInfo from "oxalis/model/binarydata_connection_info";
import Layer from "oxalis/model/binary/layers/layer";
import type { Vector4 } from "oxalis/constants";

type DatastoreInfoType = {
  url: string,
  typ: string,
};

export type PullQueueItemType = {
  priority: number,
  bucket: Vector4,
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


  constructor(cube: DataCube, layer: Layer, connectionInfo: BinaryDataConnectionInfo, datastoreInfo: DatastoreInfoType) {
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


  pull(): Array<Promise<void>> {
    // Filter and sort queue, using negative priorities for sorting so .pop() can be used to get next bucket
    this.queue = _.filter(this.queue, item => this.cube.getOrCreateBucket(item.bucket).needsRequest());
    this.queue = _.sortBy(this.queue, item => item.priority);

    // Starting to download some buckets
    const promises = [];
    while (this.batchCount < PullQueueConstants.BATCH_LIMIT && this.queue.length) {
      const batch = [];
      while (batch.length < this.BATCH_SIZE && this.queue.length) {
        const address = this.queue.shift().bucket;
        const bucket = this.cube.getOrCreateBucket(address);
        if (bucket.type === "data" && bucket.needsRequest()) {
          batch.push(address);
          bucket.pull();
        }
      }

      if (batch.length > 0) {
        promises.push(this.pullBatch(batch));
      }
    }
    return promises;
  }


  async pullBatch(batch: Array<Vector4>): Promise<void> {
    // Loading a bunch of buckets
    this.batchCount++;

    // Measuring the time until response arrives to select appropriate preloading strategy
    const roundTripBeginTime = new Date();

    try {
      const responseBuffer = await this.layer.requestFromStore(batch);
      let bucketData;
      this.connectionInfo.log(this.layer.name, roundTripBeginTime, batch.length, responseBuffer.length);

      let offset = 0;
      for (const bucketAddress of batch) {
        bucketData = responseBuffer.subarray(offset, offset += this.cube.BUCKET_LENGTH);
        this.cube.boundingBox.removeOutsideArea(bucketAddress, bucketData);
        this.maybeWhitenEmptyBucket(bucketData);
        const bucket = this.cube.getBucket(bucketAddress);
        if (bucket.type === "data") {
          bucket.receiveData(bucketData);
        }
      }
    } catch (error) {
      for (const bucketAddress of batch) {
        const bucket = this.cube.getBucket(bucketAddress);
        if (bucket.type === "data") {
          bucket.pullFailed();
          if (bucket.dirty) {
            this.add({ bucket: bucketAddress, priority: PullQueueConstants.PRIORITY_HIGHEST });
          }
        }
      }
      console.error(error);
    } finally {
      this.batchCount--;
      this.pull();
    }
  }


  clearNormalPriorities(): void {
    this.queue = _.filter(this.queue, e => e.priority === PullQueueConstants.PRIORITY_HIGHEST);
  }


  add(item: PullQueueItemType): void {
    this.queue.push(item);
  }


  addAll(items: Array<PullQueueItemType>): void {
    this.queue = this.queue.concat(items);
  }


  isNDstore(): boolean {
    return this.datastoreInfo.typ === "ndstore";
  }


  maybeWhitenEmptyBucket(bucketData: Uint8Array) {
    if (!this.whitenEmptyBuckets) { return; }

    const allZero = _.reduce(bucketData, ((res, e) => res && e === 0), true);

    if (allZero) {
      for (let i = 0; i < bucketData.length; i++) {
        bucketData[i] = 255;
      }
    }
  }
}


export default PullQueue;
