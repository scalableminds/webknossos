import Deferred from "libs/async/deferred";
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
 *
 * If you need the same behavior plus cancellation of running
 * tasks, take a look at the saga-based `createDebouncedAbortableCallable`
 * utility.
 */

export default class LatestTaskExecutor<T> {
  taskQueue: Array<{
    task: Task<T>;
    deferred: Deferred<T, Error>;
  }> = [];

  schedule(task: Task<T>): Promise<T> {
    return new Promise((resolve) => {
      const deferred = new Deferred();
      this.taskQueue.push({
        task,
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Deferred<unknown, unknown>' is not assignabl... Remove this comment to see the full error message
        deferred,
      });

      if (this.taskQueue.length === 1) {
        this.__executeLatestPromise();
      } else {
        // The promise will be scheduled as soon as the next promise
        // from the queue is fulfilled.
      }

      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Promise<unknown>' is not assigna... Remove this comment to see the full error message

      return resolve(deferred.promise());
    });
  }

  __executeLatestPromise(): void {
    if (this.taskQueue.length === 0) {
      return;
    }

    const latestTask = this.taskQueue.pop();
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'task' does not exist on type '{ task: Ta... Remove this comment to see the full error message
    const { task, deferred } = latestTask;
    // Discard the remaining queue
    this.taskQueue.forEach((queueObject) => {
      // All other tasks are not executed, since
      // they've already become obsolete.
      queueObject.deferred.reject(new Error(SKIPPED_TASK_REASON));
    });
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ task: Task<T>; deferred: Deferred<T, Error... Remove this comment to see the full error message
    this.taskQueue = [latestTask];
    // Start the latest task
    const promise = task();
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'result' implicitly has an 'any' type.
    promise.then((result) => {
      this.taskQueue.shift();
      deferred.resolve(result);

      this.__executeLatestPromise();
    });
  }
}
