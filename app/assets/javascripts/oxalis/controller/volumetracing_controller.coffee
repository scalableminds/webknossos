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
          @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))
      
      leftMouseDown : (pos, shiftPressed, altPressed) =>
        @model.volumeTracing.startEditing()
      
      leftMouseUp : =>
        @model.volumeTracing.finishLayer()
      
      rightDownMove : (delta, pos, ctrlPressed) =>
        @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))
      
      rightMouseDown : (pos, shiftPressed, altPressed) =>
        @prevActiveCell = @model.volumeTracing.getActiveCellId()
        @model.volumeTracing.setActiveCell(0)
        @model.volumeTracing.startEditing()
      
      rightMouseUp : =>
        @model.volumeTracing.finishLayer()
        @model.volumeTracing.setActiveCell( @prevActiveCell )

      leftClick : (pos, shiftPressed, altPressed) =>
        @model.volumeTracing.setActiveCell(
          @model.binary.cube.getLabel(
            @calculateGlobalPos( pos )))
          

    @keyboardControls =

      "c" : =>
        @model.volumeTracing.createCell()