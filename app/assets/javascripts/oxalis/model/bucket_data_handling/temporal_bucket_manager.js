/**
 * temporal_bucket_manager.js
 * @flow
 */

import _ from "lodash";

import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import PullQueue, { PullQueueConstants } from "oxalis/model/bucket_data_handling/pullqueue";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";

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

    if (bucket.isMissing()) {
      this.pushBucket(bucket);
    } else {
      this.loadedPromises.push(this.makeLoadedPromise(bucket));
    }
  }

  pullBucket(bucket: DataBucket): Array<Promise<void>> {
    this.pullQueue.add({
      bucket: bucket.zoomedAddress,
      priority: PullQueueConstants.PRIORITY_HIGHEST,
    });
    return this.pullQueue.pull();
  }

  pushBucket(bucket: DataBucket) {
    if (bucket.dirty) {
      this.pushQueue.insert(bucket);
    }
  }

  makeLoadedPromise(bucket: DataBucket): Promise<void> {
    const loadedPromise = new Promise((resolve, _reject) => {
      const onLoadedOrMissingHandler = () => {
        this.pushBucket(bucket);
        this.loadedPromises = _.without(this.loadedPromises, loadedPromise);
        return resolve();
      };
      bucket.on("bucketLoaded", onLoadedOrMissingHandler);
      bucket.on("bucketMissing", onLoadedOrMissingHandler);
    });
    return loadedPromise;
  }

  async getAllLoadedPromise(): Promise<void> {
    await Promise.all(this.loadedPromises);
  }
}

export default TemporalBucketManager;
