import _ from "lodash";
// const ROUND_TRIP_TIME_SMOOTHER = 0.125;
// const BANDWIDTH_SMOOTHER = 0.125;

import window from "libs/window";

type CallableStatsUpdate = (stats: Stats) => void;
type DataConnectionInfoEntry = {
  endTime: number;
  startTime: number;
  loadedBytesInMb: number;
};

type Stats = {
  avgRoundTripTime: number;
  avgDownloadSpeedInMBperS: number;
  accumulatedDownloadedBytes: number;
};

const defaultStats: Stats = {
  avgRoundTripTime: 0,
  avgDownloadSpeedInMBperS: 0,
  accumulatedDownloadedBytes: 0,
};

class DataConnectionInfo {
  data: DataConnectionInfoEntry[];
  subscriber: Array<CallableStatsUpdate>;
  lastStats: Stats;
  accumulatedDownloadedBytes: number;

  constructor() {
    // Give some typical initial values here to allow selection of initial loading strategy
    this.data = [];
    this.subscriber = [];
    this.lastStats = defaultStats;
    this.accumulatedDownloadedBytes = 0;
    setInterval(this.informAboutStatsUpdate, 1500);
  }

  _informAboutStatsUpdate() {
    // calculate stats update
    // Pass stats to all subscribers
  }

  informAboutStatsUpdate = () => {
    const stats = this.getStatistics();
    if (_.isEqual(this.lastStats, stats)) {
      return;
    }
    this.subscriber.forEach((notifyFunction) => notifyFunction(stats));
    this.lastStats = stats;
  };

  onStatisticUpdates(notifyFunction: CallableStatsUpdate): () => void {
    this.subscriber.push(notifyFunction);
    const unsubscribe = () => {
      this.subscriber = this.subscriber.filter(
        (currentFunc: CallableStatsUpdate) => currentFunc !== notifyFunction,
      );
    };
    return unsubscribe;
  }

  filterOutOldEntries() {
    const currentTime = window.performance.now();
    this.data = this.data.filter((entry) => currentTime - entry.endTime < 5000);
  }

  log(startTime: number, endTime: number, loadedBytes: number): void {
    // TODO: stalling of requests is included in the round trip time :/. try not to measure this. maybe overkill.
    // TODO: consider saving all failed buckets for ever and not only those within the last 5 secs.
    // Filter out requests that have 0 loaded bytes.
    if (loadedBytes <= 0) {
      return;
    }
    this.accumulatedDownloadedBytes += loadedBytes;
    const loadedBytesInMb = loadedBytes / 10 ** 6;
    const dataEntry = {
      startTime,
      endTime,
      loadedBytesInMb,
    };
    this.data.push(dataEntry);
  }

  getStatistics(): Stats {
    this.filterOutOldEntries();
    if (this.data.length === 0) {
      return { ...defaultStats, accumulatedDownloadedBytes: this.accumulatedDownloadedBytes };
    }
    const sumOfDownloadMBytes = _.sum(this.data.map((entry) => entry.loadedBytesInMb));
    const avgRoundTripTime =
      _.sum(this.data.map((entry) => entry.endTime - entry.startTime)) / this.data.length;
    const startingTime = _.min(this.data.map((entry) => entry.startTime)) || 1;
    const endTime = _.max(this.data.map((entry) => entry.endTime)) || 1;
    const roundTripTimeInSec = (endTime - startingTime) / 1000;
    const avgDownloadSpeedInMBperS = sumOfDownloadMBytes / roundTripTimeInSec;
    return {
      avgDownloadSpeedInMBperS,
      avgRoundTripTime,
      accumulatedDownloadedBytes: this.accumulatedDownloadedBytes,
    };
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
