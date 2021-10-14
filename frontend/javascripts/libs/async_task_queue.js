/*
 * task_serializer.js
 * @flow
 *
 */

/* eslint-disable no-await-in-loop */

import BackboneEvents from "backbone-events-standalone";
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
  nextArguments: Array<any>;
  retryCount: number = 0;
  running: boolean = false;
  failed: boolean = false;

  // Copied from backbone events (TODO: handle this better)
  on: Function;
  trigger: Function;

  constructor(maxRetry: number = 3, retryTimeMs: number = 1000, failureEventThreshold: number = 3) {
    _.extend(this, BackboneEvents);
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
    this.deferreds.set(task, deferred);
    if (this.failed) {
      this.restart();
    }
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
        const response = await currentTask();
        this.signalResolve(currentTask, response);
        this.trigger("success");
      } catch (error) {
        this.retryCount++;
        this.tasks.unshift(currentTask);
        if (this.retryCount > this.failureEventThreshold) {
          console.error("AsyncTaskQueue failed with error", error);
          this.trigger("failure", this.retryCount);
        }
        if (this.retryCount >= this.maxRetry) {
          this.failed = true;
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
}

export default AsyncTaskQueue;
