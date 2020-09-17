/**
 * pullqueue.js
 * @flow
 */

import PriorityQueue from "js-priority-queue";
import _ from "lodash";

import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { requestWithFallback } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import ConnectionInfo from "oxalis/model/data_connection_info";
import { type Vector4 } from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Store, { type DataStoreInfo, type DataLayerType } from "oxalis/store";

export type PullQueueItem = {
  priority: number,
  bucket: Vector4,
};

export const PullQueueConstants = {
  // For buckets that should be loaded immediately and
  // should never be removed from the queue
  PRIORITY_HIGHEST: -1,
  BATCH_LIMIT: 6,
};

const BATCH_SIZE = 3;

class PullQueue {
  cube: DataCube;
  priorityQueue: PriorityQueue<PullQueueItem>;
  batchCount: number;
  layerName: string;
  connectionInfo: ConnectionInfo;
  datastoreInfo: DataStoreInfo;

  constructor(
    cube: DataCube,
    layerName: string,
    connectionInfo: ConnectionInfo,
    datastoreInfo: DataStoreInfo,
  ) {
    this.cube = cube;
    this.layerName = layerName;
    this.connectionInfo = connectionInfo;
    this.datastoreInfo = datastoreInfo;
    this.priorityQueue = new PriorityQueue({
      // small priorities take precedence
      comparator: (b, a) => b.priority - a.priority,
    });
    this.batchCount = 0;
  }

  pull(): Array<Promise<void>> {
    // Starting to download some buckets
    const promises = [];
    while (this.batchCount < PullQueueConstants.BATCH_LIMIT && this.priorityQueue.length > 0) {
      const batch = [];
      while (batch.length < BATCH_SIZE && this.priorityQueue.length > 0) {
        const address = this.priorityQueue.dequeue().bucket;
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
    const { dataset } = Store.getState();
    // Measuring the time until response arrives to select appropriate preloading strategy
    const roundTripBeginTime = new Date().getTime();
    const layerInfo = getLayerByName(dataset, this.layerName);

    const { renderMissingDataBlack } = Store.getState().datasetConfiguration;

    try {
      const bucketBuffers = await requestWithFallback(layerInfo, batch);
      this.connectionInfo.log(
        this.layerName,
        roundTripBeginTime,
        batch.length,
        _.sum(bucketBuffers.map(buffer => (buffer != null ? buffer.length : 0))),
      );

      for (const [index, bucketAddress] of batch.entries()) {
        const bucketBuffer = bucketBuffers[index];
        const bucket = this.cube.getBucket(bucketAddress);
        if (bucket.type !== "data") {
          continue;
        }
        if (bucketBuffer == null && !renderMissingDataBlack) {
          bucket.markAsFailed(true);
        } else {
          this.handleBucket(layerInfo, bucketAddress, bucketBuffer);
        }
      }
    } catch (error) {
      for (const bucketAddress of batch) {
        const bucket = this.cube.getBucket(bucketAddress);
        if (bucket.type === "data") {
          bucket.markAsFailed(false);
          if (bucket.dirty) {
            this.add({
              bucket: bucketAddress,
              priority: PullQueueConstants.PRIORITY_HIGHEST,
            });
          }
        }
      }
      console.error(error);
    } finally {
      this.batchCount--;
      this.pull();
    }
  }

  handleBucket(layerInfo: DataLayerType, bucketAddress: Vector4, bucketData: ?Uint8Array): void {
    const bucket = this.cube.getBucket(bucketAddress);
    if (bucket.type === "data") {
      bucket.receiveData(bucketData);
      bucket.setVisualizationColor(0x00ff00);
    }
  }

  add(item: PullQueueItem): void {
    this.priorityQueue.queue(item);
  }

  addAll(items: Array<PullQueueItem>): void {
    for (const item of items) {
      this.add(item);
    }
  }

  clear() {
    // Clear all but the highest priority
    const highestPriorityElements = [];
    while (
      this.priorityQueue.length > 0 &&
      this.priorityQueue.peek().priority === PullQueueConstants.PRIORITY_HIGHEST
    ) {
      highestPriorityElements.push(this.priorityQueue.dequeue());
    }
    this.priorityQueue.clear();
    for (const el of highestPriorityElements) {
      this.priorityQueue.queue(el);
    }
  }
}

export default PullQueue;
