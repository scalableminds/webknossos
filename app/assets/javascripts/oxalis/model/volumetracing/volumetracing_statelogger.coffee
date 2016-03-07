StateLogger = require("../statelogger")
$ = require("jquery")

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, @flycam3d, version, tracingId, tracingType, allowUpdate, @volumeTracing, @pushQueue) ->

    super(flycam, version, tracingId, tracingType, allowUpdate)


  pushDiff : (action, value, push = true) ->

    @pushQueue.pushImpl()
    super(arguments...)

    if push
      @pushImpl()


  pushNow : ->

    pushQueuePromise = @pushQueue.pushImpl()
    stateLoggerPromise = super(arguments...)
    return $.when(pushQueuePromise, stateLoggerPromise)


  concatUpdateTracing : ->

    @pushDiff(
      "updateTracing"
      {
        activeCell : @volumeTracing.getActiveCellId()
        editPosition : @flycam.getPosition()
        editRotation : @flycam3d.getRotation()
        nextCell : @volumeTracing.idCount
      }
      false
    )

module.exports = VolumeTracingStateLogger
