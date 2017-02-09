/**
 * volumetracing_statelogger.js
 * @flow weak
 */

import StateLogger from "oxalis/model/statelogger";
import VolumeTracing from "oxalis/model/volumetracing/volumetracing";
import PushQueue from "oxalis/model/binary/pushqueue";

class VolumeTracingStateLogger extends StateLogger {

  volumeTracing: VolumeTracing;
  pushQueue: PushQueue;

  constructor(flycam, version, tracingId, tracingType, allowUpdate, volumeTracing, pushQueue) {
    super(flycam, version, tracingId, tracingType, allowUpdate);
    this.volumeTracing = volumeTracing;
    this.pushQueue = pushQueue;
  }


  pushDiff(action, value, push = true, ...args) {
    this.pushQueue.pushImpl();
    super.pushDiff(action, value, push, ...args);

    if (push) {
      this.pushImpl();
    }
  }


  pushNow(...args) {
    const pushQueuePromise = this.pushQueue.pushImpl();
    const stateLoggerPromise = super.pushNow(...args);
    return Promise.all([pushQueuePromise, stateLoggerPromise]);
  }


  stateSaved(...args) {
    return super.stateSaved(...args) && this.pushQueue.stateSaved();
  }


  concatUpdateTracing() {
    return this.pushDiff(
      "updateTracing",
      {
        activeCell: this.volumeTracing.getActiveCellId(),
        editPosition: this.flycam.getPosition(),
        nextCell: this.volumeTracing.idCount,
      },
      false,
    );
  }
}

export default VolumeTracingStateLogger;
