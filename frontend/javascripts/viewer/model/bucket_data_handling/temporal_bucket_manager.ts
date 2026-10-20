import without from "lodash-es/without";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type PullQueue from "viewer/model/bucket_data_handling/pullqueue";
import type PushQueue from "viewer/model/bucket_data_handling/pushqueue";

class TemporalBucketManager {
  // Manages temporal buckets (i.e., buckets created for annotation where
  // the original bucket has not arrived from the server yet) and handles
  // their special treatment.
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  loadedPromises: Array<Promise<void>>;
  // The buckets whose backend data is still awaited.
  pendingBuckets: Set<DataBucket> = new Set();

  constructor(pullQueue: PullQueue, pushQueue: PushQueue) {
    this.pullQueue = pullQueue;
    this.pushQueue = pushQueue;
    this.loadedPromises = [];
  }

  getCount(): number {
    // Counts the buckets whose saving waits for their backend data. A bucket saved
    // via partial updates does not: its data is only needed for display.
    let count = 0;
    for (const bucket of this.pendingBuckets) {
      if (!bucket.savedViaPartialUpdates) count++;
    }
    return count;
  }

  addBucket(bucket: DataBucket): void {
    this.pendingBuckets.add(bucket);
    this.pullBucket(bucket);
    this.loadedPromises.push(this.makeLoadedPromise(bucket));
  }

  pullBucket(bucket: DataBucket): void {
    bucket.addToPullQueueWithHighestPriority();
    this.pullQueue.pull();
  }

  makeLoadedPromise(bucket: DataBucket): Promise<void> {
    const loadedPromise: Promise<void> = new Promise((resolve, _reject) => {
      const onLoadedOrMissingHandler = () => {
        this.pendingBuckets.delete(bucket);
        if (bucket.dirty) {
          if (bucket.savedViaPartialUpdates) {
            // The bucket was edited while loading, so ending the mutation couldn't clear
            // `dirty` yet: it has to stay set until the backend data is merged (see
            // receiveData). That happened now, and nothing needs to be pushed.
            bucket.clearDirtyIfSavedViaPartialUpdates();
          } else {
            this.pushQueue.insert(bucket);
          }
        }

        this.loadedPromises = without(this.loadedPromises, loadedPromise);
        return resolve();
      };

      // No "bucketRequestFailed" here: These buckets are dirty, so the pull queue retries
      // them until the real backend data is read and merged (resolving as empty could lose data).
      bucket.on("bucketLoaded", onLoadedOrMissingHandler);
      bucket.on("bucketMissing", onLoadedOrMissingHandler);
    });
    return loadedPromise;
  }

  getAllLoadedPromise = async () => {
    await Promise.all(this.loadedPromises);
  };
}

export default TemporalBucketManager;
