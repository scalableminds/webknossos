/* eslint-disable no-await-in-loop */
import { createNanoEvents, Emitter } from "nanoevents";
import _ from "lodash";
import Deferred from "libs/deferred";
import * as Utils from "libs/utils";
type AsyncTask = () => Promise<void>;

class AsyncTaskQueue {
  // Executes asynchronous tasks in order.
  //
  // Each action is executed after the previous action
  // is finished. Any output of the previous action is
  // passed to the current action.
  maxRetry: number;
  retryTimeMs: number;
  failureEventThreshold: number;
  tasks: Array<AsyncTask> = [];
  deferreds: Map<AsyncTask, Deferred<void, any>> = new Map();
  doneDeferred: Deferred<void, any> = new Deferred();
  retryCount: number = 0;
  running: boolean = false;
  failed: boolean = false;
  emitter: Emitter;

  constructor(maxRetry: number = 3, retryTimeMs: number = 1000, failureEventThreshold: number = 3) {
    this.emitter = createNanoEvents();

    this.maxRetry = maxRetry;
    this.retryTimeMs = retryTimeMs;
    this.failureEventThreshold = failureEventThreshold;
  }

  isBusy(): boolean {
    return this.running || this.tasks.length !== 0;
  }

  scheduleTask(task: AsyncTask): Promise<void> {
    this.tasks.push(task);
    const deferred = new Deferred();
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Deferred<unknown, unknown>' is n... Remove this comment to see the full error message
    this.deferreds.set(task, deferred);

    if (this.failed) {
      this.restart();
    }

    if (!this.running) {
      this.executeNext();
    }

    // @ts-expect-error ts-migrate(2322) FIXME: Type 'Promise<unknown>' is not assignable to type ... Remove this comment to see the full error message
    return deferred.promise();
  }

  scheduleTasks(tasks: Array<AsyncTask>): Promise<any> {
    return Promise.all(tasks.map((task) => this.scheduleTask(task)));
  }

  async restart(): Promise<void> {
    // To restart the pipeline after it failed.
    // Returns a new Promise for the first item.
    if (this.failed && this.tasks.length > 0) {
      this.failed = false;
      this.retryCount = 0;
      this.running = false;
      // Reinsert first action
      await this.executeNext();
    }
  }

  signalResolve(task: AsyncTask, obj: any): void {
    const deferred = this.deferreds.get(task);
    this.deferreds.delete(task);

    if (deferred != null) {
      deferred.resolve(obj);
    }
  }

  signalReject(task: AsyncTask, error: any): void {
    const deferred = this.deferreds.get(task);
    this.deferreds.delete(task);

    if (deferred != null) {
      deferred.reject(error);
    }
  }

  join(): Promise<void> {
    if (this.isBusy()) {
      return this.doneDeferred.promise();
    } else {
      return Promise.resolve();
    }
  }

  async executeNext(): Promise<void> {
    this.running = true;

    while (this.tasks.length > 0) {
      const currentTask = this.tasks.shift();

      try {
        // @ts-expect-error ts-migrate(2722) FIXME: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
        const response = await currentTask();
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'AsyncTask | undefined' is not as... Remove this comment to see the full error message
        this.signalResolve(currentTask, response);
        this.emitter.emit("success");
      } catch (error) {
        this.retryCount++;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'AsyncTask | undefined' is not as... Remove this comment to see the full error message
        this.tasks.unshift(currentTask);

        if (this.retryCount > this.failureEventThreshold) {
          console.error("AsyncTaskQueue failed with error", error);
          this.emitter.emit("failure", this.retryCount);
        }

        if (this.retryCount >= this.maxRetry) {
          this.failed = true;
          // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'AsyncTask | undefined' is not as... Remove this comment to see the full error message
          this.signalReject(currentTask, error);
          this.running = false;
          this.doneDeferred.reject(error);
          this.doneDeferred = new Deferred();
          return;
        } else {
          await Utils.sleep(this.retryTimeMs);
        }
      }
    }

    this.running = false;
    this.doneDeferred.resolve();
    this.doneDeferred = new Deferred();
  }

  on(event: string | number, cb: (...args: any) => void) {
    this.emitter.on(event, cb);
  }
}

export default AsyncTaskQueue;
