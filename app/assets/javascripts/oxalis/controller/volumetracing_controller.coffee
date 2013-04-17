### define
../model/dimensions : Dimensions
../constants : constants
###

class VolumeTracingController

  constructor : (@model, @view, @sceneController, @cameraController) ->




  selectLayer : (pos) =>
    @model.volumeTracing.selectLayer( pos )

  drawVolume : (pos) ->
    @model.volumeTracing.addToLayer(pos)