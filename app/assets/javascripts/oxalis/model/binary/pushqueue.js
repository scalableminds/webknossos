/**
 * pushqueue.js
 * @flow
 */

import _ from "lodash";
import type Layer from "oxalis/model/binary/layers/layer";
import AsyncTaskQueue from "libs/async_task_queue";
import type { Vector4 } from "oxalis/constants";
import type DataCube from "oxalis/model/binary/data_cube";
import type { DataBucket } from "oxalis/model/binary/bucket";
import Toast from "libs/toast";
import { document } from "libs/window";

const BATCH_SIZE = 32;
const DEBOUNCE_TIME = 1000;

class PushQueue {
  dataSetName: string;
  cube: DataCube;
  layer: Layer;
  taskQueue: AsyncTaskQueue;
  sendData: boolean;
  queue: Set<DataBucket>;

  constructor(cube: DataCube, layer: Layer, taskQueue: AsyncTaskQueue, sendData: boolean = true) {
    this.cube = cube;
    this.layer = layer;
    this.taskQueue = taskQueue;
    this.sendData = sendData;
    this.queue = new Set();

    const autoSaveFailureMessage = "Auto-Save failed!";
    this.taskQueue.on("failure", () => {
      document.body.classList.add("save-error");
      Toast.error(autoSaveFailureMessage, true);
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

  comparePositions([x1, y1, z1]: Vector4, [x2, y2, z2]: Vector4): number {
    return x1 - x2 || y1 - y2 || z1 - z2;
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
    return this.layer.sendToStore(batch);
  }
}

export default PushQueue;
