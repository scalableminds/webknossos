import StateLogger from "../statelogger";

class VolumeTracingStateLogger extends StateLogger {


  constructor(flycam, version, tracingId, tracingType, allowUpdate, volumeTracing, pushQueue) {
    super(flycam, version, tracingId, tracingType, allowUpdate);
    this.volumeTracing = volumeTracing;
    this.pushQueue = pushQueue;
  }


  pushDiff(action, value, push) {

    if (push == null) { push = true; }
    this.pushQueue.pushImpl();
    super.pushDiff(...arguments);

    if (push) {
      return this.pushImpl();
    }
  }


  pushNow() {

    const pushQueuePromise = this.pushQueue.pushImpl();
    const stateLoggerPromise = super.pushNow(...arguments);
    return Promise.all([pushQueuePromise, stateLoggerPromise]);
  }


  stateSaved(...args) {

    return super.stateSaved(...args) && this.pushQueue.stateSaved();
  }


  concatUpdateTracing() {

    return this.pushDiff(
      "updateTracing",
      {
        activeCell : this.volumeTracing.getActiveCellId(),
        editPosition : this.flycam.getPosition(),
        nextCell : this.volumeTracing.idCount
      },
      false
    );
  }
}

export default VolumeTracingStateLogger;
