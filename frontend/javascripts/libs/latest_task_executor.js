// @flow

import Deferred from "libs/deferred";

type Task<T> = () => Promise<T>;
export const SKIPPED_TASK_REASON = "Skipped task";

/*
 * The LatestTaskExecutor class allows to schedule tasks
 * (see above type definition), which will be executed
 * sequentially. However, the crux is that unstarted tasks
 * are discarded if there is a newer task available.
 * Existing tasks are not cancelled, which is why
 * there can be at most two running tasks per
 * LatestTaskExecutor instance.
 *
 * See the corresponding spec for examples.
 */

export default class LatestTaskExecutor<T> {
  taskQueue: Array<{ task: Task<T>, deferred: Deferred<T, Error> }> = [];

  schedule(task: Task<T>): Promise<T> {
    return new Promise(resolve => {
      const deferred = new Deferred();
      this.taskQueue.push({ task, deferred });

      if (this.taskQueue.length === 1) {
        this.__executeLatestPromise();
      } else {
        // The promise will be scheduled as soon as the next promise
        // from the queue is fulfilled.
      }
      return resolve(deferred.promise());
    });
  }

  __executeLatestPromise(): void {
    if (this.taskQueue.length === 0) {
      return;
    }

    const latestTask = this.taskQueue.pop();
    const { task, deferred } = latestTask;

    // Discard the remaining queue
    this.taskQueue.forEach(queueObject => {
      // All other tasks are not executed, since
      // they've already become obsolete.
      queueObject.deferred.reject(new Error(SKIPPED_TASK_REASON));
    });
    this.taskQueue = [latestTask];

    // Start the latest task
    const promise = task();
    promise.then(result => {
      this.taskQueue.shift();
      deferred.resolve(result);
      this.__executeLatestPromise();
    });
  }
}
