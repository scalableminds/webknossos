class BinaryDataConnectionInfo

  ROUND_TRIP_TIME_SMOOTHER : .125
  BANDWIDTH_SMOOTHER : .125

  #Give some typical initial values here to allow selection of initial loading strategy
  roundTripTime : 200
  bandwidth : 100000

  loggedData : []
  totalBuckets : 0
  totalBytes : 0

  log : (dataLayerName, startTime, loadedBuckets, loadedBytes) ->

    endTime = new Date().getTime()
    roundTripTime = endTime - startTime
    bandwidth = loadedBytes / roundTripTime * 1000

    @loggedData.push({
      timestamp: endTime,
      duration: roundTripTime,
      dataLayer: dataLayerName,
      bytes: loadedBytes,
      buckets: loadedBuckets
    })

    @totalBuckets += loadedBuckets
    @totalBytes += loadedBytes

    @roundTripTime = (1 - @ROUND_TRIP_TIME_SMOOTHER) * @roundTripTime + @ROUND_TRIP_TIME_SMOOTHER * roundTripTime
    @bandwidth = (1 - @BANDWIDTH_SMOOTHER) * @bandwidth + @BANDWIDTH_SMOOTHER * bandwidth

module.exports = BinaryDataConnectionInfo
