### define
../statelogger : StateLogger
###

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, @flycam3d, version, tracingId, tracingType, allowUpdate, @volumeTracing, @pushQueue) ->

    super(flycam, version, tracingId, tracingType, allowUpdate)


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
        editRotation : @flycam3d.getRotation()
        nextCell : @volumeTracing.idCount
      }
      false
    )
