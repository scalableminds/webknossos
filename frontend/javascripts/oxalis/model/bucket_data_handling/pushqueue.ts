import _ from "lodash";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { alert, document } from "libs/window";
import { sendToStore } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import AsyncTaskQueue from "libs/async_task_queue";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Toast from "libs/toast";
export const COMPRESSING_BATCH_SIZE = 32;
// Only process the PushQueue after there was no user interaction
// for PUSH_DEBOUNCE_TIME milliseconds...
const PUSH_DEBOUNCE_TIME = 1000;
// ...unless a timeout of PUSH_DEBOUNCE_MAX_WAIT_TIME milliseconds
// is exceeded. Then, initiate a push.
const PUSH_DEBOUNCE_MAX_WAIT_TIME = 30000;

class PushQueue {
  dataSetName: string;
  cube: DataCube;
  compressionTaskQueue: AsyncTaskQueue;
  sendData: boolean;
  // The pendingQueue contains all buckets which are marked as
  // "should be snapshotted and saved". That queue is processed
  // in a debounced manner and sent to the `compressionTaskQueue`.
  // The `compressionTaskQueue` compresses the bucket data and
  // sends it to the save queue.
  pendingQueue: Set<DataBucket>;

  constructor(cube: DataCube, sendData: boolean = true) {
    this.cube = cube;
    this.compressionTaskQueue = new AsyncTaskQueue(Infinity);
    this.sendData = sendData;
    this.pendingQueue = new Set();
    const autoSaveFailureMessage = "Auto-Save failed!";
    this.compressionTaskQueue.on("failure", () => {
      console.error("PushQueue failure");

      if (document.body != null) {
        document.body.classList.add("save-error");
      }

      Toast.error(autoSaveFailureMessage, {
        sticky: true,
      });
    });
    this.compressionTaskQueue.on("success", () => {
      if (document.body != null) {
        document.body.classList.remove("save-error");
      }

      Toast.close(autoSaveFailureMessage);
    });
  }

  stateSaved(): boolean {
    return (
      this.pendingQueue.size === 0 &&
      this.cube.temporalBucketManager.getCount() === 0 &&
      !this.compressionTaskQueue.isBusy()
    );
  }

  insert(bucket: DataBucket): void {
    if (!this.pendingQueue.has(bucket)) {
      this.pendingQueue.add(bucket);
      bucket.dirtyCount++;
    }

    this.push();
  }

  clear(): void {
    this.pendingQueue.clear();
  }

  print(): void {
    this.pendingQueue.forEach((e) => console.log(e));
  }

  pushImpl = async () => {
    await this.cube.temporalBucketManager.getAllLoadedPromise();

    if (!this.sendData) {
      return;
    }

    while (this.pendingQueue.size) {
      let batchSize = Math.min(COMPRESSING_BATCH_SIZE, this.pendingQueue.size);
      const batch = [];

      for (const bucket of this.pendingQueue) {
        if (batchSize <= 0) break;
        this.pendingQueue.delete(bucket);
        batch.push(bucket);
        batchSize--;
      }

      // fire and forget
      this.compressionTaskQueue.scheduleTask(() => this.pushBatch(batch));
    }

    try {
      // wait here
      await this.compressionTaskQueue.join();
    } catch (error) {
      alert("We've encountered a permanent issue while saving. Please try to reload the page.");
    }
  };
  push = _.debounce(this.pushImpl, PUSH_DEBOUNCE_TIME, {
    maxWait: PUSH_DEBOUNCE_MAX_WAIT_TIME,
  });

  pushBatch(batch: Array<DataBucket>): Promise<void> {
    return sendToStore(batch, this.cube.layerName);
  }
}

export default PushQueue;