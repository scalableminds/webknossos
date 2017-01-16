class BinaryDataConnectionInfo {
  static initClass() {
    this.prototype.ROUND_TRIP_TIME_SMOOTHER = 0.125;
    this.prototype.BANDWIDTH_SMOOTHER = 0.125;

    // Give some typical initial values here to allow selection of initial loading strategy
    this.prototype.roundTripTime = 200;
    this.prototype.bandwidth = 100000;

    this.prototype.loggedData = [];
    this.prototype.totalBuckets = 0;
    this.prototype.totalBytes = 0;
  }

  log(dataLayerName, startTime, loadedBuckets, loadedBytes) {
    const endTime = new Date().getTime();
    const roundTripTime = endTime - startTime;
    const bandwidth = (loadedBytes / roundTripTime) * 1000;

    this.loggedData.push({
      timestamp: endTime,
      duration: roundTripTime,
      dataLayer: dataLayerName,
      bytes: loadedBytes,
      buckets: loadedBuckets,
    });

    this.totalBuckets += loadedBuckets;
    this.totalBytes += loadedBytes;

    this.roundTripTime = ((1 - this.ROUND_TRIP_TIME_SMOOTHER) * this.roundTripTime) + (this.ROUND_TRIP_TIME_SMOOTHER * roundTripTime);
    this.bandwidth = ((1 - this.BANDWIDTH_SMOOTHER) * this.bandwidth) + (this.BANDWIDTH_SMOOTHER * bandwidth);
  }
}
BinaryDataConnectionInfo.initClass();

export default BinaryDataConnectionInfo;
