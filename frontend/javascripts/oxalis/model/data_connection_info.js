/**
 * data_connection_info.js
 * @flow
 */

const ROUND_TRIP_TIME_SMOOTHER = 0.125;
const BANDWIDTH_SMOOTHER = 0.125;

class DataConnectionInfo {
  roundTripTime: number;
  bandwidth: number;
  totalBuckets: number;
  totalBytes: number;

  constructor() {
    // Give some typical initial values here to allow selection of initial loading strategy
    this.roundTripTime = 200;
    this.bandwidth = 100000;

    this.totalBuckets = 0;
    this.totalBytes = 0;
  }

  log(dataLayerName: string, startTime: number, loadedBuckets: number, loadedBytes: number): void {
    const endTime = new Date().getTime();
    const roundTripTime = endTime - startTime;
    const bandwidth = (loadedBytes / roundTripTime) * 1000;

    this.totalBuckets += loadedBuckets;
    this.totalBytes += loadedBytes;

    this.roundTripTime =
      (1 - ROUND_TRIP_TIME_SMOOTHER) * this.roundTripTime +
      ROUND_TRIP_TIME_SMOOTHER * roundTripTime;
    this.bandwidth = (1 - BANDWIDTH_SMOOTHER) * this.bandwidth + BANDWIDTH_SMOOTHER * bandwidth;
  }
}

export default DataConnectionInfo;
