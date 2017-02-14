/**
 * pushqueue.js
 * @flow
 */

import _ from "lodash";
import type Layer from "oxalis/model/binary/layers/layer";
import TaskSerializer from "libs/task_serializer";
import type { Vector4 } from "oxalis/constants";
import DataCube from "oxalis/model/binary/data_cube";

const BATCH_SIZE = 32;
const DEBOUNCE_TIME = 1000;

class PushQueue {

  dataSetName: string;
  cube: DataCube;
  layer: Layer;
  tracingId: string;
  taskSerializer: TaskSerializer;
  sendData: boolean;
  queue: Array<Vector4>;

  constructor(dataSetName: string, cube: DataCube, layer: Layer, tracingId: string,
    taskSerializer: TaskSerializer, sendData: boolean = true) {
    this.dataSetName = dataSetName;
    this.cube = cube;
    this.layer = layer;
    this.tracingId = tracingId;
    this.taskSerializer = taskSerializer;
    this.sendData = sendData;
    this.queue = [];
  }


  stateSaved(): boolean {
    return this.queue.length === 0 &&
           this.cube.temporalBucketManager.getCount() === 0 &&
           !this.taskSerializer.isBusy();
  }


  insert(bucketAddress: Vector4): void {
    this.queue.push(bucketAddress);
    this.removeDuplicates();
    this.push();
  }


  insertFront(bucketAddress: Vector4): void {
    this.queue.unshift(bucketAddress);
    this.removeDuplicates();
    this.push();
  }


  clear(): void {
    this.queue = [];
  }


  removeDuplicates(): void {
    this.queue.sort(this.comparePositions);

    let i = 0;
    while (i < this.queue.length - 1) {
      if (this.comparePositions(this.queue[i], this.queue[i + 1]) === 0) {
        this.queue.splice(i, 1);
      } else {
        i++;
      }
    }
  }


  comparePositions([x1, y1, z1]: Vector4, [x2, y2, z2]: Vector4): number {
    return (x1 - x2) || (y1 - y2) || (z1 - z2);
  }


  print(): void {
    this.queue.forEach(e => console.log(e));
  }


  pushImpl = async () => {
    await this.cube.temporalBucketManager.getAllLoadedPromise();
    if (!this.sendData) {
      return;
    }

    while (this.queue.length) {
      const batchSize = Math.min(BATCH_SIZE, this.queue.length);
      const batch = this.queue.splice(0, batchSize);
      this.taskSerializer.scheduleTask(() => this.pushBatch(batch));
    }
    await this.taskSerializer.join();
  };


  push = _.debounce(this.pushImpl, DEBOUNCE_TIME);


  pushBatch(batch: Array<Vector4>): Promise<void> {
    const getBucketData = bucket => this.cube.getBucket(bucket).getData();
    return this.layer.sendToStore(batch, getBucketData);
  }
}


export default PushQueue;
