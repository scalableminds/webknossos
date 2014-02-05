### define
./statelogger : StateLogger
###

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, version, tracingId, tracingType, allowUpdate, @volumeTracing) ->

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
