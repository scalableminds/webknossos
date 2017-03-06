/**
 * volumetracing_statelogger.js
 * @flow
 */

import StateLogger from "oxalis/model/statelogger";
import VolumeTracing from "oxalis/model/volumetracing/volumetracing";
import PushQueue from "oxalis/model/binary/pushqueue";
import Flycam2D from "oxalis/model/flycam2d";

class VolumeTracingStateLogger extends StateLogger {

  volumeTracing: VolumeTracing;
  pushQueue: PushQueue;

  constructor(flycam: Flycam2D, version: number, tracingId: string, tracingType: string, allowUpdate: boolean, volumeTracing: VolumeTracing, pushQueue: PushQueue) {
    super(flycam, version, tracingId, tracingType, allowUpdate);
    this.volumeTracing = volumeTracing;
    this.pushQueue = pushQueue;
  }


  pushDiff(action: string, value: Object, push: boolean = true) {
    this.pushQueue.pushImpl();
    super.pushDiff(action, value, push);

    if (push) {
      this.pushQueue.pushImpl();
    }
  }


  pushNow() {
    const pushQueuePromise = this.pushQueue.pushImpl();
    const stateLoggerPromise = super.pushNow();
    return Promise.all([pushQueuePromise, stateLoggerPromise]);
  }


  stateSaved() {
    return super.stateSaved() && this.pushQueue.stateSaved();
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
