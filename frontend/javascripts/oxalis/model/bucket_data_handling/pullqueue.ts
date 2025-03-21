import PriorityQueue from "js-priority-queue";
import { asAbortable, sleep } from "libs/utils";
import type { BucketAddress } from "oxalis/constants";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import { requestWithFallback } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import type { DataStoreInfo } from "oxalis/store";
import Store from "oxalis/store";

export type PullQueueItem = {
  priority: number;
  bucket: BucketAddress;
};
export const PullQueueConstants = {
  // For buckets that should be loaded immediately and
  // should never be removed from the queue
  PRIORITY_HIGHEST: -1,
  BATCH_LIMIT: 6,
} as const;
const BATCH_SIZE = 6;
const PULL_ABORTION_ERROR = new DOMException("Pull aborted.", "AbortError");
const MAX_RETRY_DELAY = 5000;

class PullQueue {
  cube: DataCube;
  layerName: string;
  datastoreInfo: DataStoreInfo;
  private priorityQueue: PriorityQueue<PullQueueItem>;
  private fetchingBatchCount: number;
  private abortController: AbortController;
  private consecutiveErrorCount: number;
  private isRetryScheduled: boolean;

  constructor(cube: DataCube, layerName: string, datastoreInfo: DataStoreInfo) {
    this.cube = cube;
    this.layerName = layerName;
    this.datastoreInfo = datastoreInfo;
    this.priorityQueue = new PriorityQueue({
      // small priorities take precedence
      comparator: (b, a) => b.priority - a.priority,
    });
    this.fetchingBatchCount = 0;
    this.consecutiveErrorCount = 0;
    this.isRetryScheduled = false;
    this.abortController = new AbortController();
  }

  pull(): void {
    // Start to download some buckets
    while (
      this.fetchingBatchCount < PullQueueConstants.BATCH_LIMIT &&
      this.priorityQueue.length > 0
    ) {
      const batch = [];

      while (batch.length < BATCH_SIZE && this.priorityQueue.length > 0) {
        const address = this.priorityQueue.dequeue().bucket;
        const bucket = this.cube.getOrCreateBucket(address);

        if (bucket.type === "data" && bucket.needsRequest()) {
          batch.push(address);
          bucket.markAsRequested();
        }
      }

      if (batch.length > 0) {
        this.pullBatch(batch);
      }
    }
  }

  abortRequests() {
    this.abortController.abort();
    this.abortController = new AbortController();
  }

  private async pullBatch(batch: Array<BucketAddress>): Promise<void> {
    // Loading a bunch of buckets
    this.fetchingBatchCount++;
    const { dataset } = Store.getState();
    const layerInfo = getLayerByName(dataset, this.layerName);
    const { renderMissingDataBlack } = Store.getState().datasetConfiguration;

    let hasErrored = false;
    try {
      const bucketBuffers = await asAbortable(
        requestWithFallback(layerInfo, batch),
        this.abortController.signal,
        PULL_ABORTION_ERROR,
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
          this.handleBucket(bucketAddress, bucketBuffer);
        }
      }
    } catch (error) {
      for (const bucketAddress of batch) {
        const bucket = this.cube.getBucket(bucketAddress);

        if (bucket.type === "data") {
          bucket.markAsFailed(false);

          if (bucket.dirty) {
            bucket.addToPullQueueWithHighestPriority();
          }
        }
      }

      if (!(error instanceof DOMException && error.name === "AbortError")) {
        // AbortErrors are deliberate. Don't show them on the console.
        console.error(error);
        hasErrored = true;
      }
    } finally {
      if (hasErrored) {
        this.consecutiveErrorCount++;
      } else {
        this.consecutiveErrorCount = 0;
      }
      this.fetchingBatchCount--;

      if (!hasErrored) {
        // Continue to process the pull queue without delay.
        this.pull();
      } else {
        // The current batch failed and we want to schedule a retry. However,
        // parallel batches might fail, too, and also want to schedule a retry.
        // To avoid that pull() is called X times in Y seconds, we only
        // initiate a retry after a sleep if no concurrent invocation
        // "claimed" the `isRetryScheduled` boolean.
        if (!this.isRetryScheduled) {
          this.isRetryScheduled = true;
          sleep(this.getRetryDelay()).then(() => {
            this.isRetryScheduled = false;
            this.pull();
          });
        }
      }
    }
  }

  private getRetryDelay(): number {
    const exponentialBackOff = 25 * 2 ** (this.consecutiveErrorCount / 10);
    return Math.min(exponentialBackOff, MAX_RETRY_DELAY);
  }

  private handleBucket(
    bucketAddress: BucketAddress,
    bucketData: Uint8Array | null | undefined,
  ): void {
    const bucket = this.cube.getBucket(bucketAddress);

    if (bucket.type !== "data") {
      return;
    }
    if (this.cube.shouldEagerlyMaintainUsedValueSet()) {
      // If we assume that the value set of the bucket is needed often (for proofreading),
      // we compute it here eagerly and then send the data to the bucket.
      // That way, the computations of the value set are spread out over time instead of being
      // clustered when DataCube.getValueSetForAllBuckets is called. This improves the FPS rate.
      bucket.receiveData(bucketData, true);
    } else {
      bucket.receiveData(bucketData);
    }
  }

  add(item: PullQueueItem): void {
    // Theoretically, this queue could contain duplicates.
    // However pull() will check that a bucket really needs
    // a request to avoid redundant fetches.
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
