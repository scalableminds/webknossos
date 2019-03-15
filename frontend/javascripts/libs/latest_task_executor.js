// @flow

import Deferred from "libs/deferred";

type Task<T> = <T>() => Promise<T>;

export default class LatestTaskExecutor<T> {
  promiseFnQueue: Array<{ fn: Task<T>, deferred: Deferred<T, Error> }> = [];

  schedule(fn: Task<T>): Promise<T> {
    return new Promise(resolve => {
      const deferred = new Deferred();
      this.promiseFnQueue.push({ fn, deferred });

      if (this.promiseFnQueue.length === 1) {
        this.__executeLatestPromise();
      } else {
        // The promise will be scheduled as soon as the next promise
        // from the queue is fulfilled.
      }
      return resolve(deferred.promise());
    });
  }

  __executeLatestPromise(): void {
    if (this.promiseFnQueue.length === 0) {
      return;
    }

    const latestTask = this.promiseFnQueue.pop();
    const { fn, deferred } = latestTask;

    // Discard the remaining queue
    this.promiseFnQueue.forEach(queueObject => {
      // All other tasks are not executed, since
      // there already become obsolete.
      queueObject.deferred.reject(new Error("Skipped task"));
    });
    this.promiseFnQueue = [latestTask];

    // Start the latest task
    const promise = fn();
    promise.then(result => {
      this.promiseFnQueue.shift();
      deferred.resolve(result);
      this.__executeLatestPromise();
    });
  }
}
