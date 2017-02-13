/*
 * task_serializer.js
 * @flow
 */

import Utils from "libs/utils";
import Deferred from "libs/deferred";

type AsyncTask = () => Promise<void>;

class TaskSerializer {
  // Executes asynchronous tasks in order.
  //
  // Each action is executed after the previous action
  // is finished. Any output of the previous action is
  // passed to the current action.

  maxRetry: number;
  retryTimeMs: number;
  tasks: Array<AsyncTask> = [];
  deferreds: Map<AsyncTask, Deferred<void, any>> = new Map();
  doneDeferred: Deferred<void, any> = new Deferred();
  nextArguments: Array<any>;
  retryCount: number = 0;
  running: boolean = false;
  failed: boolean = false;

  constructor(maxRetry: number = 3, retryTimeMs: number = 1000) {
    this.maxRetry = maxRetry;
    this.retryTimeMs = retryTimeMs;
  }


  isBusy(): boolean {
    return this.running || this.tasks.length !== 0;
  }

  scheduleTask(task: AsyncTask): Promise<void> {
    this.tasks.push(task);
    const deferred = new Deferred();
    this.deferreds.set(task, deferred);
    if (!this.running) {
      this.executeNext();
    }
    return deferred.promise();
  }

  scheduleTasks(tasks: Array<AsyncTask>): Promise<*> {
    return Promise.all(tasks.map(task => this.scheduleTask(task)));
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
    return this.doneDeferred.promise();
  }

  async executeNext(): Promise<void> {
    this.running = true;
    while (this.tasks.length > 0) {
      const currentTask = this.tasks.shift();
      try {
        const response = await currentTask();
        this.signalResolve(currentTask, response);
      } catch (error) {
        this.retryCount++;
        this.tasks.unshift(currentTask);

        if (this.retryCount >= this.maxRetry) {
          this.failed = true;
          this.signalReject(currentTask, error);
        } else {
          await Utils.sleep(this.retryTimeMs);
        }
      }
    }
    this.running = false;
    this.doneDeferred.resolve();
    this.doneDeferred = new Deferred();
  }
}

export default TaskSerializer;
