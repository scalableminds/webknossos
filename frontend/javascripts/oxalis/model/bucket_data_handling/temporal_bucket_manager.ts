import _ from "lodash";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import type PushQueue from "oxalis/model/bucket_data_handling/pushqueue";

class TemporalBucketManager {
  // Manages temporal buckets (i.e., buckets created for annotation where
  // the original bucket has not arrived from the server yet) and handles
  // their special treatment.
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  loadedPromises: Array<Promise<void>>;

  constructor(pullQueue: PullQueue, pushQueue: PushQueue) {
    this.pullQueue = pullQueue;
    this.pushQueue = pushQueue;
    this.loadedPromises = [];
  }

  getCount(): number {
    return this.loadedPromises.length;
  }

  addBucket(bucket: DataBucket): void {
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
        if (bucket.dirty) {
          this.pushQueue.insert(bucket);
        }

        this.loadedPromises = _.without(this.loadedPromises, loadedPromise);
        return resolve();
      };

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
