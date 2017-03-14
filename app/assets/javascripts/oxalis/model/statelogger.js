/**
 * statelogger.js
 * @flow
 */

import Backbone from "backbone";
import _ from "lodash";
import $ from "jquery";
import app from "app";
import Store from "oxalis/store";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";

const PUSH_THROTTLE_TIME = 30000; // 30s
const SAVE_RETRY_WAITING_TIME = 5000;

type DiffType = {
  action: string;
  value: Object;
};

// Returns a wrapper function that rejects all invocations while an
// instance of the function is still running. The mutex can be
// cleared with a predefined timeout. The wrapped function is
// required to return a `Promise` at all times.
function mutexPromise(func, timeout = 20000) {
  let promise = null;

  return function (...args: Array<any>) {
    if (!promise) {
      let internalPromise;
      promise = internalPromise = func.apply(this, args);
      if (timeout >= 0) {
        setTimeout((() => {
          if (promise === internalPromise) { promise = null; }
        }), timeout);
      }
      promise.then(
        () => { promise = null; },
        () => { promise = null; });
      return promise;
    } else {
      return Promise.reject("mutex");
    }
  };
}

class StateLogger {

  version: number;
  tracingId: string;
  tracingType: string;
  allowUpdate: boolean;
  newDiffs: Array<DiffType>;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;
  on: Function;


  constructor(version: number, tracingId: string, tracingType: string, allowUpdate: boolean) {
    this.version = version;
    this.tracingId = tracingId;
    this.tracingType = tracingType;
    this.allowUpdate = allowUpdate;
    _.extend(this, Backbone.Events);

    this.newDiffs = [];

    // Push state to server whenever a user moves
    Store.subscribe(() => { this.push(); });
  }


  pushDiff(action: string, value: Object, push: boolean = true): void {
    this.newDiffs.push({
      action,
      value,
    });
    // In order to assure that certain actions are atomic,
    // it is sometimes necessary not to push.
    if (push) {
      this.push();
    }
  }


  concatUpdateTracing() {
    throw new Error("concatUpdateTracing has to be overwritten by subclass!");
  }


  // ### SERVER COMMUNICATION

  stateSaved() {
    return this.newDiffs.length === 0;
  }


  push() {
    if (this.allowUpdate) {
      this.pushThrottled();
    }
  }


  pushNow() {
   // Interface for view & controller

    return this.mutexedPush(false);
  }

  // alias for `pushNow`
  // needed for save delegation by `Model`
  // see `model.js`
  save() {
    return this.pushNow();
  }


  mutexedPush = mutexPromise(this.pushImpl, -1);
  pushThrottled = _.throttle(this.mutexedPush, PUSH_THROTTLE_TIME);


  pushImpl(notifyOnFailure: boolean) {
    if (!this.allowUpdate) {
      return Promise.resolve();
    }

    // TODO: remove existing updateTracing
    this.concatUpdateTracing();

    const diffsCurrentLength = this.newDiffs.length;
    console.log("Sending data: ", this.newDiffs);
    ErrorHandling.assert(this.newDiffs.length > 0, "Empty update sent to server!", {
      newDiffs: this.newDiffs,
    });

    return Request.sendJSONReceiveJSON(
      `/annotations/${this.tracingType}/${this.tracingId}?version=${(this.version + 1)}`, {
        method: "PUT",
        data: this.newDiffs,
      },
    ).then(
      (response) => {
        this.newDiffs = this.newDiffs.slice(diffsCurrentLength);
        this.version = response.version;
        this.pushDoneCallback();
      },
      responseObject => this.pushFailCallback(responseObject, notifyOnFailure),
    );
  }


  pushFailCallback(response: Response, notifyOnFailure: boolean) {
    $("body").addClass("save-error");

    // HTTP Code 409 'conflict' for dirty state
    if (response.status === 409) {
      app.router.off("beforeunload");
      alert(`\
It seems that you edited the tracing simultaneously in different windows.
Editing should be done in a single window only.

In order to restore the current window, a reload is necessary.\
`);
      app.router.reload();
    }


    setTimeout((() => this.pushNow()), SAVE_RETRY_WAITING_TIME);
    if (notifyOnFailure) {
      this.trigger("pushFailed");
    }
  }


  pushDoneCallback() {
    this.trigger("pushDone");
    $("body").removeClass("save-error");
  }
}


export default StateLogger;
