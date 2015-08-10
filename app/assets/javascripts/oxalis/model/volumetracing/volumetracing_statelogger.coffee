### define
../statelogger : StateLogger
###

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, version, tracingId, tracingType, allowUpdate, updatePipeline, @volumeTracing, @pushQueue) ->

    super(flycam, version, tracingId, tracingType, allowUpdate, updatePipeline)


  pushDiff : (action, value, push = true) ->

    @pushQueue.pushImpl()
    super(arguments...)

    if push
      @pushImpl()


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
