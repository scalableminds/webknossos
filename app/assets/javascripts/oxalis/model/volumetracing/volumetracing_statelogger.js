StateLogger = require("../statelogger")

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, version, tracingId, tracingType, allowUpdate, @volumeTracing, @pushQueue) ->

    super(flycam, version, tracingId, tracingType, allowUpdate)


  pushDiff : (action, value, push = true) ->

    @pushQueue.pushImpl()
    super(arguments...)

    if push
      @pushImpl()


  pushNow : ->

    pushQueuePromise = @pushQueue.pushImpl()
    stateLoggerPromise = super(arguments...)
    return Promise.all([pushQueuePromise, stateLoggerPromise])


  stateSaved : (args...) ->

    return super(args...) and @pushQueue.stateSaved()


  concatUpdateTracing : ->

    @pushDiff(
      "updateTracing"
      {
        activeCell : @volumeTracing.getActiveCellId()
        editPosition : @flycam.getPosition()
        nextCell : @volumeTracing.idCount
      }
      false
    )

module.exports = VolumeTracingStateLogger
