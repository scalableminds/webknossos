/**
 * pullqueue.js
 * @flow
 */

import PriorityQueue from "js-priority-queue";
import _ from "lodash";

import { getResolutions, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import {
  getResolutionsFactors,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import { requestWithFallback } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import ConnectionInfo from "oxalis/model/data_connection_info";
import Constants, { type Vector3, type Vector4 } from "oxalis/constants";
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

const createPriorityQueue = () =>
  new PriorityQueue({
    // small priorities take precedence
    comparator: (b, a) => b.priority - a.priority,
  });

const BATCH_SIZE = 3;

class PullQueue {
  cube: DataCube;
  queue: Array<PullQueueItem>;
  priorityQueue: PriorityQueue;
  batchCount: number;
  layerName: string;
  whitenEmptyBuckets: boolean;
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
    this.priorityQueue = createPriorityQueue();
    this.batchCount = 0;

    // Debug option.
    // If true, buckets of all 0 will be transformed to have 255 bytes everywhere.
    this.whitenEmptyBuckets = false;
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
    const roundTripBeginTime = new Date();
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

      const resolutions = getResolutions(dataset);

      for (const [index, bucketAddress] of batch.entries()) {
        const bucketBuffer = bucketBuffers[index];
        const bucket = this.cube.getBucket(bucketAddress);
        if (bucket.type !== "data") {
          continue;
        }
        if (bucketBuffer == null && !renderMissingDataBlack) {
          bucket.pullFailed(true);
        } else {
          const bucketData = bucketBuffer || new Uint8Array(bucket.BUCKET_LENGTH);
          this.handleBucket(layerInfo, bucketAddress, bucketData, resolutions);
        }
      }
    } catch (error) {
      for (const bucketAddress of batch) {
        const bucket = this.cube.getBucket(bucketAddress);
        if (bucket.type === "data") {
          bucket.pullFailed(false);
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

  handleBucket(
    layerInfo: DataLayerType,
    bucketAddress: Vector4,
    bucketData: Uint8Array,
    resolutions: Array<Vector3>,
  ): void {
    const zoomStep = bucketAddress[3];
    const bucket = this.cube.getBucket(bucketAddress);
    this.maybeWhitenEmptyBucket(bucketData);
    if (bucket.type === "data") {
      bucket.receiveData(bucketData);
      bucket.setVisualizationColor(0x00ff00);
      if (
        zoomStep === this.cube.MAX_UNSAMPLED_ZOOM_STEP &&
        Constants.DOWNSAMPLED_ZOOM_STEP_COUNT === 1
      ) {
        const higherAddress = zoomedAddressToAnotherZoomStep(
          bucketAddress,
          resolutions,
          zoomStep + 1,
        );

        const resolutionsFactors = getResolutionsFactors(
          resolutions[zoomStep + 1],
          resolutions[zoomStep],
        );
        const higherBucket = this.cube.getOrCreateBucket(higherAddress);
        if (higherBucket.type === "data") {
          higherBucket.downsampleFromLowerBucket(
            bucket,
            resolutionsFactors,
            layerInfo.category === "segmentation",
          );
        }
      }
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

  maybeWhitenEmptyBucket(bucketData: Uint8Array) {
    if (!this.whitenEmptyBuckets) {
      return;
    }

    const allZero = _.reduce(bucketData, (res, e) => res && e === 0, true);

    if (allZero) {
      for (let i = 0; i < bucketData.length; i++) {
        bucketData[i] = 255;
      }
    }
  }
}

export default PullQueue;
