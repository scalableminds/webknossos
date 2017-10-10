/**
 * temporal_bucket_manager.js
 * @flow
 */

import _ from "lodash";
import PullQueue, { PullQueueConstants } from "oxalis/model/binary/pullqueue";
import PushQueue from "oxalis/model/binary/pushqueue";
import type { DataBucket } from "oxalis/model/binary/bucket";

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

  pullBucket(bucket: DataBucket): Array<Promise<void>> {
    this.pullQueue.add({
      bucket: bucket.zoomedAddress,
      priority: PullQueueConstants.PRIORITY_HIGHEST,
    });
    return this.pullQueue.pull();
  }

  makeLoadedPromise(bucket: DataBucket): Promise<void> {
    const loadedPromise = new Promise((resolve, _reject) =>
      bucket.on("bucketLoaded", () => {
        if (bucket.dirty) {
          this.pushQueue.insert(bucket);
        }

        this.loadedPromises = _.without(this.loadedPromises, loadedPromise);
        return resolve();
      }),
    );
    return loadedPromise;
  }

  async getAllLoadedPromise(): Promise<void> {
    await Promise.all(this.loadedPromises);
  }
}

export default TemporalBucketManager;
