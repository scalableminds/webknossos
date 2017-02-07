/**
 * pushqueue.js
 * @flow weak
 */

import _ from "lodash";
import type { LayerType } from "oxalis/model";
import Pipeline from "libs/pipeline";
import type { Vector4 } from "oxalis/constants";
import DataCube from "./data_cube";

const BATCH_SIZE = 32;
const DEBOUNCE_TIME = 1000;

class PushQueue {

  dataSetName: string;
  cube: DataCube;
  layer: LayerType;
  tracingId: string;
  updatePipeline: Pipeline;
  sendData: boolean;
  queue: Array<Vector4>;

  constructor(dataSetName: string, cube: DataCube, layer: LayerType, tracingId: string, updatePipeline: Pipeline, sendData = true) {
    this.dataSetName = dataSetName;
    this.cube = cube;
    this.layer = layer;
    this.tracingId = tracingId;
    this.updatePipeline = updatePipeline;
    this.sendData = sendData;
    this.queue = [];
  }


  stateSaved() {
    return this.queue.length === 0 &&
           this.cube.temporalBucketManager.getCount() === 0 &&
           !this.updatePipeline.isBusy();
  }


  insert(bucketAddress: Vector4) {
    this.queue.push(bucketAddress);
    this.removeDuplicates();
    this.push();
  }


  insertFront(bucketAddress: Vector4) {
    this.queue.unshift(bucketAddress);
    this.removeDuplicates();
    this.push();
  }


  clear() {
    this.queue = [];
  }


  removeDuplicates() {
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


  comparePositions([x1, y1, z1], [x2, y2, z2]) {
    return (x1 - x2) || (y1 - y2) || (z1 - z2);
  }


  print() {
    this.queue.forEach(e =>
      console.log(e));
  }


  pushImpl = () => this.cube.temporalBucketManager.getAllLoadedPromise().then(
    () => {
      if (!this.sendData) {
        return Promise.resolve();
      }

      while (this.queue.length) {
        const batchSize = Math.min(BATCH_SIZE, this.queue.length);
        const batch = this.queue.splice(0, batchSize);
        this.pushBatch(batch);
      }

      return this.updatePipeline.getLastActionPromise();
    },
  )


  push = _.debounce(this.pushImpl, DEBOUNCE_TIME);


  pushBatch(batch) {
    const getBucketData = bucket => this.cube.getBucket(bucket).getData();
    this.layer.sendToStore(batch, getBucketData);
  }
}


export default PushQueue;
