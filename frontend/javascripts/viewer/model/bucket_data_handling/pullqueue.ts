import app from "app";
import PriorityQueue from "js-priority-queue";
import { asAbortable, sleep } from "libs/utils";
import type { BucketAddress } from "viewer/constants";
import constants from "viewer/constants";
import { getLayerByName } from "viewer/model/accessors/dataset_accessor";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import { requestWithFallback } from "viewer/model/bucket_data_handling/wkstore_adapter";
import type { DataStoreInfo } from "viewer/store";
import Store from "viewer/store";
import type { DataBucket } from "./bucket";

// For a layer where t should be treated like z (see DataCube.usesTRecycling), widens
// a single-t request address into a full 32-t-aligned-batch request address, so that the
// wire request always fetches a whole batch instead of one t-slice at a time (see
// getTBatchSiblingAddresses for how the response is then fanned out to every t within it).
function snapToTBatchAddress(cube: DataCube, address: BucketAddress): BucketAddress {
  if (!cube.usesTRecycling) {
    return address;
  }
  const additionalCoordinates = address[4] ?? [];
  const t = additionalCoordinates.find((coord) => coord.name === "t")?.value ?? 0;
  const batchStart = Math.floor(t / constants.BUCKET_WIDTH) * constants.BUCKET_WIDTH;
  const batchedCoordinates = additionalCoordinates.map((coord) =>
    coord.name === "t" ? { ...coord, value: batchStart, length: constants.BUCKET_WIDTH } : coord,
  );
  return [address[0], address[1], address[2], address[3], batchedCoordinates];
}

// The addresses of every bucket whose data is present in the response for `address` (see
// snapToTBatchAddress): just `address` itself for a layer without t-recycling, or every
// valid t within the aligned 32-batch `address` belongs to otherwise.
function getTBatchSiblingAddresses(cube: DataCube, address: BucketAddress): Array<BucketAddress> {
  if (!cube.usesTRecycling) {
    return [address];
  }
  const additionalCoordinates = address[4] ?? [];
  const t = additionalCoordinates.find((coord) => coord.name === "t")?.value ?? 0;
  const batchStart = Math.floor(t / constants.BUCKET_WIDTH) * constants.BUCKET_WIDTH;
  const bounds = cube.additionalAxes.t?.bounds;
  const siblings: Array<BucketAddress> = [];

  for (let dt = 0; dt < constants.BUCKET_WIDTH; dt++) {
    const nt = batchStart + dt;
    if (bounds != null && (nt < bounds[0] || nt >= bounds[1])) {
      continue;
    }
    const siblingCoordinates = additionalCoordinates.map((coord) =>
      coord.name === "t" ? { ...coord, value: nt } : coord,
    );
    siblings.push([address[0], address[1], address[2], address[3], siblingCoordinates]);
  }

  return siblings;
}

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
    // For a t-recycling layer, always request a whole aligned 32-t batch instead
    // of a single t (see snapToTBatchAddress) — never just the one t-slice that happens to
    // be needed right now. The response is then fanned out to every valid t within it (see
    // getTBatchSiblingAddresses/handleBatchedBucketResult), so scrubbing through t within an
    // already-fetched batch needs no further request from any consumer, not just rendering.
    const wireBatch = batch.map((address) => snapToTBatchAddress(this.cube, address));

    let hasErrored = false;
    let failedBucketAddresses = [];
    try {
      const bucketResults = await asAbortable(
        requestWithFallback(layerInfo, wireBatch),
        this.abortController.signal,
        PULL_ABORTION_ERROR,
      );

      for (const [index, bucketAddress] of batch.entries()) {
        try {
          const bucketResult = bucketResults[index];
          const siblingAddresses = getTBatchSiblingAddresses(this.cube, bucketAddress);

          switch (bucketResult.type) {
            case "data": {
              this.handleBatchedBucketResult(
                siblingAddresses,
                bucketResult.data,
                renderMissingDataBlack,
              );
              break;
            }
            case "empty": {
              this.handleBatchedBucketResult(siblingAddresses, null, renderMissingDataBlack);
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
    voxelOffsetInWireData: number = 0,
  ): void {
    if (this.cube.shouldEagerlyMaintainUsedValueSet()) {
      // If we assume that the value set of the bucket is needed often (for proofreading),
      // we compute it here eagerly and then send the data to the bucket.
      // That way, the computations of the value set are spread out over time instead of being
      // clustered when DataCube.getValueSetForAllAccessedBuckets is called. This improves the FPS rate.
      bucket.receiveData(bucketData, true, voxelOffsetInWireData);
    } else {
      bucket.receiveData(bucketData, false, voxelOffsetInWireData);
    }
  }

  // Applies one wire response (data or empty) to every sibling address it covers (see
  // getTBatchSiblingAddresses — just the one originally-requested bucket for a plain
  // request, or every valid t within a fetched batch). Siblings beyond the one actually
  // requested via pull() are opportunistically transitioned from UNREQUESTED to REQUESTED
  // here so they can receive this "free" data too (this is the whole point of always
  // fetching full t-batches); a sibling already in some other state (e.g. still loading via
  // a different concurrent request) is left untouched.
  private handleBatchedBucketResult(
    siblingAddresses: Array<BucketAddress>,
    bucketData: Uint8Array<ArrayBuffer> | null,
    renderMissingDataBlack: boolean,
  ): void {
    const isBatched = siblingAddresses.length > 1;

    for (const siblingAddress of siblingAddresses) {
      const sibling = this.cube.getOrCreateBucket(siblingAddress);

      if (sibling.type !== "data") {
        continue;
      }
      const didMarkAsRequested = sibling.needsRequest();
      if (didMarkAsRequested) {
        sibling.markAsRequested();
      }
      if (!sibling.isRequested()) {
        // The bucket might already be LOADED or MISSING.
        continue;
      }

      try {
        if (bucketData == null) {
          if (renderMissingDataBlack) {
            // Render empty buckets as black (zeroed) data.
            this.handleBucket(sibling, null);
          } else {
            sibling.markAsMissing();
          }
          continue;
        }

        // Note that this is a voxel offset, not a slice index: receiveData slices the wire
        // buffer at [channelCount * offset, channelCount * (offset + effectiveVoxelCount)).
        const voxelOffsetInWireData = isBatched
          ? (sibling.getT() % constants.BUCKET_WIDTH) * this.cube.getEffectiveBucketVoxelCount()
          : 0;
        this.handleBucket(sibling, bucketData, voxelOffsetInWireData);
      } catch (error) {
        // handleBucket can throw — most plainly on a malformed wire buffer, which, since that
        // buffer is shared across the whole batch, fails for every sibling. Undoing the
        // transition above is ours to do: pullBatch's failedBucketAddresses only knows about
        // the address that was originally requested, and a bucket left in REQUESTED is stuck
        // there for good (pull() only admits UNREQUESTED buckets, the GC skips REQUESTED ones,
        // and ensureLoaded would await an event that is never emitted).
        // A sibling that was already REQUESTED when we found it belongs to a concurrent batch
        // — or is this batch's own primary — so settling it is that owner's job, not ours.
        if (didMarkAsRequested && sibling.isRequested()) {
          sibling.markAsFailed();

          if (sibling.dirty) {
            sibling.addToPullQueueWithHighestPriority();
          }
        }

        // Rethrowing aborts the remaining siblings, which is intended: the failure is usually
        // a property of the shared buffer, so continuing would just repeat the same error
        // (and its ErrorHandling.notify) up to BUCKET_WIDTH times. Untouched siblings stay
        // UNREQUESTED, i.e. exactly as before this batching existed, and get requested again
        // when actually demanded. The throw is also what puts the originally requested bucket
        // into failedBucketAddresses (see pullBatch).
        throw error;
      }
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
