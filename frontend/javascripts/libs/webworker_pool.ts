import _ from "lodash";
export default class WebWorkerPool<P, R> {
  // This class can be used to instantiate multiple web workers
  // which are then used for computation in a simple round-robin manner.
  //
  // Example:
  // const compressionPool = new WebWorkerPool(
  //   () => createWorker(ByteArraysToLz4Base64Worker),
  //   COMPRESSION_WORKER_COUNT,
  // );
  // const promise1 = compressionPool.submit(data1);
  // const promise2 = compressionPool.submit(data2);
  workers: Array<(...args: Array<P>) => R>;
  currentWorkerIdx: number;

  constructor(workerFn: () => (...args: Array<P>) => R, count: number) {
    this.workers = _.range(0, count).map((_idx) => workerFn());
    this.currentWorkerIdx = 0;
  }

  submit(...args: Array<P>): R {
    this.currentWorkerIdx = (this.currentWorkerIdx + 1) % this.workers.length;
    return this.workers[this.currentWorkerIdx](...args);
  }
}
