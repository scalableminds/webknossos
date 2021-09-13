// @flow
import _ from "lodash";

import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { alert, document } from "libs/window";
import { sendToStore } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import AsyncTaskQueue from "libs/async_task_queue";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Toast from "libs/toast";

const BATCH_SIZE = 32;
const DEBOUNCE_TIME = 1000;

class PushQueue {
  dataSetName: string;
  cube: DataCube;
  taskQueue: AsyncTaskQueue;
  sendData: boolean;
  queue: Set<DataBucket>;

  constructor(cube: DataCube, sendData: boolean = true) {
    this.cube = cube;
    this.taskQueue = new AsyncTaskQueue(Infinity);
    this.sendData = sendData;
    this.queue = new Set();

    const autoSaveFailureMessage = "Auto-Save failed!";
    this.taskQueue.on("failure", () => {
      document.body.classList.add("save-error");
      Toast.error(autoSaveFailureMessage, { sticky: true });
    });
    this.taskQueue.on("success", () => {
      document.body.classList.remove("save-error");
      Toast.close(autoSaveFailureMessage);
    });
  }

  stateSaved(): boolean {
    return (
      this.queue.size === 0 &&
      this.cube.temporalBucketManager.getCount() === 0 &&
      !this.taskQueue.isBusy()
    );
  }

  insert(bucket: DataBucket): void {
    this.queue.add(bucket);
    this.push();
  }

  clear(): void {
    this.queue.clear();
  }

  print(): void {
    this.queue.forEach(e => console.log(e));
  }

  pushImpl = async () => {
    await this.cube.temporalBucketManager.getAllLoadedPromise();
    if (!this.sendData) {
      return;
    }

    while (this.queue.size) {
      let batchSize = Math.min(BATCH_SIZE, this.queue.size);
      const batch = [];
      for (const bucket of this.queue) {
        if (batchSize <= 0) break;

        this.queue.delete(bucket);
        batch.push(bucket);
        batchSize--;
      }
      // fire and forget
      this.taskQueue.scheduleTask(() => this.pushBatch(batch));
    }
    try {
      // wait here
      await this.taskQueue.join();
    } catch (error) {
      alert("We've encountered a permanent issue while saving. Please try to reload the page.");
    }
  };

  push = _.debounce(this.pushImpl, DEBOUNCE_TIME);

  pushBatch(batch: Array<DataBucket>): Promise<void> {
    return sendToStore(batch);
  }
}

export default PushQueue;
