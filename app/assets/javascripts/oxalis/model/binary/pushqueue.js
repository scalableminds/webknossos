import Cube from "./cube";
import Request from "../../../libs/request";
import MultipartData from "../../../libs/multipart_data";

class PushQueue {
  static initClass() {
  
    this.prototype.BATCH_LIMIT  = 1;
    this.prototype.BATCH_SIZE  = 32;
    this.prototype.DEBOUNCE_TIME  = 1000;
    this.prototype.MESSAGE_TIMEOUT  = 10000;
  }


  constructor(dataSetName, cube, layer, tracingId, updatePipeline, sendData) {

    if (sendData == null) { sendData = true; }
    this.dataSetName = dataSetName;
    this.cube = cube;
    this.layer = layer;
    this.tracingId = tracingId;
    this.updatePipeline = updatePipeline;
    this.sendData = sendData;
    this.queue = [];
    this.push = _.debounce(this.pushImpl, this.DEBOUNCE_TIME);
  }


  stateSaved() {

    return this.queue.length === 0 &&
           this.cube.temporalBucketManager.getCount() === 0 &&
           !this.updatePipeline.isBusy();
  }


  insert(bucket) {

    this.queue.push( bucket );
    this.removeDuplicates();
    return this.push();
  }


  insertFront(bucket) {

    this.queue.unshift( bucket );
    this.removeDuplicates();
    return this.push();
  }


  clear() {

    return this.queue = [];
  }


  removeDuplicates() {

    this.queue.sort( this.comparePositions );

    let i = 0;
    return (() => {
      const result = [];
      while (i < this.queue.length - 1) {
        if (this.comparePositions( this.queue[i], this.queue[i+1] ) === 0) {
          result.push(this.queue.splice( i, 1 ));
        } else {
          result.push(i++);
        }
      }
      return result;
    })();
  }


  comparePositions([x1, y1, z1], [x2, y2, z2]) {

      return (x1 - x2) || (y1 - y2) || (z1 - z2);
    }


  print() {

    return this.queue.map((e) =>
      console.log(e));
  }


  pushImpl() {

    return this.cube.temporalBucketManager.getAllLoadedPromise().then(() => {

      if (!this.sendData) {
        return Promise.resolve();
      }

      while (this.queue.length) {

        const batchSize = Math.min(this.BATCH_SIZE, this.queue.length);
        const batch = this.queue.splice(0, batchSize);
        this.pushBatch(batch);
      }

      return this.updatePipeline.getLastActionPromise();
    }
    );
  }


  pushBatch(batch) {

    const getBucketData = bucket => this.cube.getBucket(bucket).getData();
    return this.layer.sendToStore(batch, getBucketData);
  }
}
PushQueue.initClass();


export default PushQueue;
