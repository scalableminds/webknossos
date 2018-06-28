/**
 * pullqueue.js
 * @flow
 */

import _ from "lodash";
import ConnectionInfo from "oxalis/model/data_connection_info";
import { requestFromStore } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type { Vector4 } from "oxalis/constants";
import type { DataStoreInfoType } from "oxalis/store";
import PriorityQueue from "js-priority-queue";
import {
  getResolutionsFactors,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import { getResolutions, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import Store from "oxalis/store";

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

const createPriorityQueue = () =>
  new PriorityQueue({
    // small priorities take precedence
    comparator: (b, a) => b.priority - a.priority,
  });

const BATCH_SIZE = 3;

class PullQueue {
  cube: DataCube;
  queue: Array<PullQueueItemType>;
  priorityQueue: PriorityQueue;
  batchCount: number;
  layerName: string;
  whitenEmptyBuckets: boolean;
  connectionInfo: ConnectionInfo;
  datastoreInfo: DataStoreInfoType;

  constructor(
    cube: DataCube,
    layerName: string,
    connectionInfo: ConnectionInfo,
    datastoreInfo: DataStoreInfoType,
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
    try {
      const responseBuffer = await requestFromStore(layerInfo, batch);
      let bucketData;
      this.connectionInfo.log(
        this.layerName,
        roundTripBeginTime,
        batch.length,
        responseBuffer.length,
      );

      let offset = 0;
      const resolutions = getResolutions(dataset);
      for (const bucketAddress of batch) {
        const zoomStep = bucketAddress[3];
        if (zoomStep > this.cube.MAX_UNSAMPLED_ZOOM_STEP) {
          continue;
        }
        bucketData = responseBuffer.subarray(offset, (offset += this.cube.BUCKET_LENGTH));
        const bucket = this.cube.getBucket(bucketAddress);
        this.cube.boundingBox.removeOutsideArea(bucket, bucketAddress, bucketData);
        this.maybeWhitenEmptyBucket(bucketData);
        if (bucket.type === "data") {
          bucket.receiveData(bucketData);
          if (zoomStep === this.cube.MAX_UNSAMPLED_ZOOM_STEP) {
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
    // The following code removes all items from the priorityQueue which are not PRIORITY_HIGHEST

    const newQueue = createPriorityQueue();
    while (this.priorityQueue.length > 0) {
      const item = this.priorityQueue.dequeue();
      if (item.priority === PullQueueConstants.PRIORITY_HIGHEST) {
        newQueue.queue(item);
      } else if (item.priority > PullQueueConstants.PRIORITY_HIGHEST) {
        // Since dequeuing is ordered, we will only receive priorities which are
        // not PRIORITY_HIGHEST
        break;
      }
    }
    this.priorityQueue = newQueue;
  }

  add(item: PullQueueItemType): void {
    this.priorityQueue.queue(item);
  }

  addAll(items: Array<PullQueueItemType>): void {
    for (const item of items) {
      this.priorityQueue.queue(item);
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
