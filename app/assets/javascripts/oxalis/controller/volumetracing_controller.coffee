### define
../model/dimensions : Dimensions
../constants : constants
###

class VolumeTracingController

  constructor : ( { @model, @view, @sceneController, @cameraController, @move, @calculateGlobalPos } ) ->

    @mouseControls =
      
      leftDownMove : (delta, pos, ctrlPressed) =>
        
        if ctrlPressed
          @move [
            delta.x * @model.user.getMouseInversionX() / @view.scaleFactor
            delta.y * @model.user.getMouseInversionY() / @view.scaleFactor
            0
          ]
        else
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