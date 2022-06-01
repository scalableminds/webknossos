import _ from "lodash";

const ROUND_TRIP_TIME_SMOOTHER = 0.125;
const BANDWIDTH_SMOOTHER = 0.125;

type CallableStatsUpdate = (stats: Object) => void;

class DataConnectionInfo {
  roundTripTime: number;
  bandwidth: number;
  totalBuckets: number;
  totalBytes: number;
  failedBuckets: number;
  subscriber: Array<CallableStatsUpdate>;

  constructor() {
    // Give some typical initial values here to allow selection of initial loading strategy
    this.roundTripTime = 200;
    this.bandwidth = 100000;
    this.totalBuckets = 0;
    this.totalBytes = 0;
    this.failedBuckets = 0;
    this.subscriber = [];
  }

  _informAboutStatsUpdate() {
    // calculate stats update
    // Pass stats to all subscribers
  }

  informAboutStatsUpdate = _.throttle(() => {
    const stats = this.getStatistics();
    this.subscriber.forEach((notifyFunction) => notifyFunction(stats));
  });

  onStatisticUpdates(notifyFunction: CallableStatsUpdate): () => void {
    this.subscriber.push(notifyFunction);
    const unsubscribe = () => {
      this.subscriber.filter((currentFunc: CallableStatsUpdate) => currentFunc !== notifyFunction);
      return null;
    };
    return unsubscribe;
  }

  log(
    startingTime: number,
    roundTripTime: number,
    loadedBuckets: number,
    loadedBytes: number,
    failedBuckets: number,
  ): void {
    const bandwidth = (loadedBytes / roundTripTime) * 1000;
    this.totalBuckets += loadedBuckets;
    this.failedBuckets += failedBuckets;
    this.totalBytes += loadedBytes;
    this.roundTripTime =
      (1 - ROUND_TRIP_TIME_SMOOTHER) * this.roundTripTime +
      ROUND_TRIP_TIME_SMOOTHER * roundTripTime;
    this.bandwidth = (1 - BANDWIDTH_SMOOTHER) * this.bandwidth + BANDWIDTH_SMOOTHER * bandwidth;
  }

  getStatistics() {
    // TODO
  }
}

let globalDataConnectionInfo: DataConnectionInfo | null = null;
export function getGlobalDataConnectionInfo(): DataConnectionInfo {
  if (globalDataConnectionInfo == null) {
    globalDataConnectionInfo = new DataConnectionInfo();
  }
  return globalDataConnectionInfo;
}

export default DataConnectionInfo;
