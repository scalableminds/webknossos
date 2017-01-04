import Backbone from "backbone";
import _ from "lodash";
import $ from "jquery";
import app from "app";
import Request from "libs/request";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";

class StateLogger {
  static initClass() {

    this.prototype.PUSH_THROTTLE_TIME  = 30000; //30s
    this.prototype.SAVE_RETRY_WAITING_TIME  = 5000;
  }

  constructor(flycam, version, tracingId, tracingType, allowUpdate) {

    this.flycam = flycam;
    this.version = version;
    this.tracingId = tracingId;
    this.tracingType = tracingType;
    this.allowUpdate = allowUpdate;
    _.extend(this, Backbone.Events);
    this.mutexedPush = _.mutexPromise(this.pushImpl, -1);

    this.newDiffs = [];

    // Push state to server whenever a user moves
    this.listenTo(this.flycam, "positionChanged", this.push);
  }


  pushDiff(action, value, push = true) {

    this.newDiffs.push({
      action,
      value
    });
    // In order to assure that certain actions are atomic,
    // it is sometimes necessary not to push.
    if (push) {
      return this.push();
    }
  }


  concatUpdateTracing() {

    throw new Error("concatUpdateTracing has to be overwritten by subclass!");
  }


  //### SERVER COMMUNICATION

  stateSaved() {

    return this.newDiffs.length === 0;
  }


  push() {

    if (this.allowUpdate) {
      return this.pushThrottled();
    }
  }


  pushThrottled() {
    // Pushes the buffered tracing to the server. Pushing happens at most
    // every 30 seconds.

    this.pushThrottled = _.throttle(this.mutexedPush, this.PUSH_THROTTLE_TIME);
    return this.pushThrottled();
  }


  pushNow() {   // Interface for view & controller

    return this.mutexedPush(false);
  }

  // alias for `pushNow`
  // needed for save delegation by `Model`
  // see `model.coffee`
  save() {

    return this.pushNow();
  }


  pushImpl(notifyOnFailure) {

    if (!this.allowUpdate) {
      return Promise.resolve();
    }

    // TODO: remove existing updateTracing
    this.concatUpdateTracing();

    const diffsCurrentLength = this.newDiffs.length;
    console.log("Sending data: ", this.newDiffs);
    ErrorHandling.assert(this.newDiffs.length > 0, "Empty update sent to server!", {
      newDiffs: this.newDiffs
    });

    return Request.sendJSONReceiveJSON(
      `/annotations/${this.tracingType}/${this.tracingId}?version=${(this.version + 1)}`,{
      method : "PUT",
      data : this.newDiffs
    }
    ).then(
      response => {
        this.newDiffs = this.newDiffs.slice(diffsCurrentLength);
        this.version = response.version;
        return this.pushDoneCallback();
      },
      responseObject => {
        return this.pushFailCallback(responseObject, notifyOnFailure);
      }
    );
  }


  pushFailCallback(response, notifyOnFailure) {

    $('body').addClass('save-error');

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


    setTimeout((() => this.pushNow()), this.SAVE_RETRY_WAITING_TIME);
    if (notifyOnFailure) {
      return this.trigger("pushFailed");
    }
  }


  pushDoneCallback() {

    this.trigger("pushDone");
    return $('body').removeClass('save-error');
  }
}
StateLogger.initClass();


export default StateLogger;
