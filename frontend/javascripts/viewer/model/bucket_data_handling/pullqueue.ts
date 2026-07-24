import app from "app";
import PriorityQueue from "js-priority-queue";
import { asAbortable, sleep } from "libs/utils";
import type { BucketAddress } from "viewer/constants";
import { getLayerByName } from "viewer/model/accessors/dataset_accessor";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { requestWithFallback } from "viewer/model/bucket_data_handling/wkstore_adapter";
import type { DataStoreInfo } from "viewer/store";
import Store from "viewer/store";
import type { DataBucket } from "./bucket";

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
  private isDestroyed: boolean = false;

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

    // Capture the exact bucket objects this batch was launched for. Buckets are looked
    // up by address, but a bucket can be evicted and a fresh one recreated at the same
    // address while this request is in flight — most notably during a reload, which
    // aborts this request via abortRequests() and (synchronously) evicts the affected
    // buckets. Once that happens, this request has been superseded: a newer bucket and
    // request now own the address. This stale request must not touch that new bucket,
    // neither by writing its outdated data nor by marking it as failed. We therefore
    // compare object identity (against the captured bucket) before acting on any bucket
    // below. This capture is synchronous (no await since markAsRequested in pull()), so
    // it reliably reflects the buckets this batch requested.
    const requestedBucketByAddress = new Map(
      batch.map((address) => [address, this.cube.getBucket(address)] as const),
    );

    let hasErrored = false;
    let failedBucketAddresses = [];
    try {
      const bucketResults = await asAbortable(
        requestWithFallback(layerInfo, batch),
        this.abortController.signal,
        PULL_ABORTION_ERROR,
      );

      for (const [index, bucketAddress] of batch.entries()) {
        try {
          const bucketResult = bucketResults[index];
          const bucket = this.cube.getBucket(bucketAddress);

          // Skip if this request has been superseded, i.e. the bucket we requested was
          // evicted/replaced in the meantime (see the identity note above). We use
          // getBucket (not getOrCreateBucket) so we don't resurrect an evicted bucket
          // just to fill it with now-stale data.
          if (bucket.type !== "data" || bucket !== requestedBucketByAddress.get(bucketAddress)) {
            continue;
          }

          switch (bucketResult.type) {
            case "data": {
              this.handleBucket(bucket, bucketResult.data);
              break;
            }
            case "empty": {
              if (renderMissingDataBlack) {
                // Render empty buckets as black (zeroed) data.
                this.handleBucket(bucket, null);
              } else {
                bucket.markAsMissing();
              }
              break;
            }
            case "failure": {
              // The bucket could not be read. Schedule it for a retry via the
              // batch-level error handling below.
              failedBucketAddresses.push(bucketAddress);
              break;
            }
          }
        } catch {
          failedBucketAddresses.push(bucketAddress);
        }
      }

      if (failedBucketAddresses.length > 0) {
        throw new Error("Some buckets could not be handled.");
      }
    } catch (error) {
      if (this.isDestroyed) {
        return;
      }
      failedBucketAddresses = failedBucketAddresses.length === 0 ? batch : failedBucketAddresses;
      for (const bucketAddress of failedBucketAddresses) {
        const bucket = this.cube.getBucket(bucketAddress);

        // Only touch the bucket if it is still the exact object this request was launched
        // for. If it was evicted/replaced meanwhile (e.g. by a reload that aborted this
        // request), a newer request now owns the address and marking it as failed here
        // would clobber that fresh, legitimately-requested bucket.
        if (bucket !== requestedBucketByAddress.get(bucketAddress)) {
          continue;
        }

        // Only mark the bucket as failed if it is still in the REQUESTED state.
        // A bucket might have already transitioned to another state (e.g. LOADED
        // via an earlier result in the same batch), in which case markAsFailed()
        // would throw. Skipping it lets the loop safely handle the remaining buckets.
        if (bucket.type === "data" && bucket.isRequested()) {
          bucket.markAsFailed();

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

      if (!this.isDestroyed && this.isEmpty() && !this.isRetryScheduled) {
        app.vent.emit("pullqueue:empty", this.layerName);
      }
    }
  }

  private getRetryDelay(): number {
    const exponentialBackOff = 25 * 2 ** (this.consecutiveErrorCount / 10);
    return Math.min(exponentialBackOff, MAX_RETRY_DELAY);
  }

  private handleBucket(
    bucket: DataBucket,
    bucketData: Uint8Array<ArrayBuffer> | null | undefined,
  ): void {
    if (this.cube.shouldEagerlyMaintainUsedValueSet()) {
      // If we assume that the value set of the bucket is needed often (for proofreading),
      // we compute it here eagerly and then send the data to the bucket.
      // That way, the computations of the value set are spread out over time instead of being
      // clustered when DataCube.getValueSetForAllAccessedBuckets is called. This improves the FPS rate.
      bucket.receiveData(bucketData, true);
    } else {
      bucket.receiveData(bucketData);
    }
  }

  isEmpty(): boolean {
    return this.priorityQueue.length === 0 && this.fetchingBatchCount === 0;
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

  destroy() {
    this.isDestroyed = true;
    this.clear();
    this.abortRequests();
  }
}

export default PullQueue;
