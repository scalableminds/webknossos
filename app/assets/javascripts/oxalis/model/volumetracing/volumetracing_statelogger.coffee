### define
../statelogger : StateLogger
###

class VolumeTracingStateLogger extends StateLogger


  constructor : (flycam, version, tracingId, tracingType, allowUpdate, updatePipeline, @volumeTracing, @pushQueue) ->

    super(flycam, version, tracingId, tracingType, allowUpdate, updatePipeline)

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
