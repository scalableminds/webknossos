### define
../statelogger : StateLogger
###

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, version, tracingId, tracingType, allowUpdate, @volumeTracing, @pushQueue) ->

    super(flycam, version, tracingId, tracingType, allowUpdate)

    # For now, just save regularily
    @flycam.on
      positionChanged : =>
        @push()


  concatUpdateTracing : (array) ->

    return array.concat( {
      action : "updateTracing"
      value : {
        activeCellId : @volumeTracing.getActiveCellId()
        editPosition : @flycam.getPosition()
      }
    })
