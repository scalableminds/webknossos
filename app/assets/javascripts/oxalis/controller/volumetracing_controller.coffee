### define
../model/dimensions : Dimensions
../constants : constants
###

class VolumeTracingController

  constructor : ( objects ) ->

    _.extend( @, objects)

    @mouseControls =
      
      leftDownMove : (delta, pos) =>
        @drawVolume( @calculateGlobalPos([pos.x, pos.y]))
      
      leftClick : (pos, shiftPressed, altPressed, plane) =>
        @model.volumeTracing.startEditing()
      
      leftMouseUp : =>
        @model.volumeTracing.finishLayer()
      
      rightClick : (pos, ctrlPressed) =>
        @selectLayer(@calculateGlobalPos(pos))
          

    @keyboardControls =

      "n" : =>
        @model.volumeTracing.createCell()

  selectLayer : (pos) =>
    @model.volumeTracing.selectLayer( pos )

  drawVolume : (pos) ->
    @model.volumeTracing.addToLayer(pos)