import window from "libs/window";
import _ from "lodash";

const CONSIDERED_TIMESPAN_IN_STATS = 5000;

type DataConnectionInfoEntry = {
  endTime: number;
  startTime: number;
  loadedBytes: number;
};

type Stats = {
  avgRoundTripTime: number;
  avgDownloadSpeedInBytesPerS: number;
  accumulatedDownloadedBytes: number;
};

const defaultStats: Stats = {
  avgRoundTripTime: 0,
  avgDownloadSpeedInBytesPerS: 0,
  accumulatedDownloadedBytes: 0,
};

class DataConnectionInfo {
  data: DataConnectionInfoEntry[];
  lastStats: Stats;
  accumulatedDownloadedBytes: number;

  constructor() {
    // Give some typical initial values here to allow selection of initial loading strategy
    this.data = [];
    this.lastStats = defaultStats;
    this.accumulatedDownloadedBytes = 0;
  }

  filterOutOldEntries() {
    const currentTime = window.performance.now();
    this.data = this.data.filter(
      (entry) => currentTime - entry.endTime < CONSIDERED_TIMESPAN_IN_STATS,
    );
  }

  log(startTime: number, endTime: number, loadedBytes: number): void {
    // Filter out requests that have 0 loaded bytes.
    if (loadedBytes <= 0) {
      return;
    }
    this.accumulatedDownloadedBytes += loadedBytes;
    const dataEntry = {
      startTime,
      endTime,
      loadedBytes,
    };
    this.data.push(dataEntry);
  }

  getStatistics(): Stats {
    this.filterOutOldEntries();
    if (this.data.length === 0) {
      return { ...defaultStats, accumulatedDownloadedBytes: this.accumulatedDownloadedBytes };
    }
    const sumOfDownloadBytes = _.sum(this.data.map((entry) => entry.loadedBytes));
    const avgRoundTripTime =
      _.sum(this.data.map((entry) => entry.endTime - entry.startTime)) / this.data.length;
    const startingTime = _.min(this.data.map((entry) => entry.startTime)) || 1;
    const endTime = _.max(this.data.map((entry) => entry.endTime)) || 1;
    const totalDuration = (endTime - startingTime) / 1000;
    const avgDownloadSpeedInBytesPerS = sumOfDownloadBytes / totalDuration;
    return {
      avgDownloadSpeedInBytesPerS,
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
