### define
underscore : _
../viewmodes/plane_controller : PlaneController
###

class VolumeTacingPlaneController extends PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Volume Tracing Plane Controller:
  # Extends Plane controller to add controls that are specific to Volume
  # Tracing.


  getMouseControls : ->

    return _.extend super(),
      
      leftDownMove : (delta, pos, plane, event) =>

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

        cellId = @model.binary["segmentation"].cube.getDataValue(
                  @calculateGlobalPos( pos ))

        if cellId > 0
          if      @mergeMode == @MERGE_MODE_NORMAL
            @model.volumeTracing.setActiveCell( cellId )
          else if @mergeMode == @MERGE_MODE_CELL1
            $("#merge-cell1").val(cellId)
            $("#merge-cell2").focus()
          else if @mergeMode == @MERGE_MODE_CELL2
            $("#merge-cell2").val(cellId)
            @merge()


  getKeyboardControls : ->

    _.extend super(),

      "c" : =>
        @model.volumeTracing.createCell()
