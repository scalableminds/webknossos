### define
../model/dimensions : Dimensions
../constants : constants
###

class VolumeTracingController

  constructor : ( { @model, @view, @sceneController, @cameraController, @move, @calculateGlobalPos } ) ->

    @inDeleteMode = false

    @mouseControls =
      
      leftDownMove : (delta, pos, event) =>

        if event.ctrlKey
          @move [
            delta.x * @model.user.getMouseInversionX() / @view.scaleFactor
            delta.y * @model.user.getMouseInversionY() / @view.scaleFactor
            0
          ]
        else
          @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))
      
      leftMouseDown : (pos, plane, event) =>

        @enterDeleteMode( event.shiftKey )
        @model.volumeTracing.startEditing(plane)
      
      leftMouseUp : =>

        @model.volumeTracing.finishLayer()
        @restoreAfterDeleteMode()
      
      rightDownMove : (delta, pos, plane, event) =>

        @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))
      
      rightMouseDown : (pos, plane, event) =>

        @enterDeleteMode()
        @model.volumeTracing.startEditing(plane)
      
      rightMouseUp : =>

        @model.volumeTracing.finishLayer()
        @restoreAfterDeleteMode()

      leftClick : (pos, plane, event) =>

        cell = @model.binary["segmentation"].cube.getDataValue(
                  @calculateGlobalPos( pos ))

        if cell > 0
          @model.volumeTracing.setActiveCell( cell )
          

    @keyboardControls =

      "c" : =>
        @model.volumeTracing.createCell()


  enterDeleteMode : (enter = true) ->

    @inDeleteMode = enter

    if @inDeleteMode
      @prevActiveCell = @model.volumeTracing.getActiveCellId()
      @model.volumeTracing.setActiveCell(0)


  restoreAfterDeleteMode : ->

    if @inDeleteMode
      @model.volumeTracing.setActiveCell( @prevActiveCell )
    @inDeleteMode = false


  drawVolume : (pos) ->

    @model.volumeTracing.addToLayer(pos)
