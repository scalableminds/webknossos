### define
../model/dimensions : Dimensions
../constants : constants
###

class VolumeTracingController

  MERGE_MODE_NORMAL : 0
  MERGE_MODE_CELL1  : 1
  MERGE_MODE_CELL2  : 2

  constructor : ( { @model, @view, @sceneController, @cameraController, @move, @calculateGlobalPos, @gui } ) ->

    @inDeleteMode = false

    @gui.on
      setActiveCell : (id) => @model.volumeTracing.setActiveCell(id)
      createNewCell : => @model.volumeTracing.createCell()

    @mouseControls =
      
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
          

    @keyboardControls =

      "c" : =>
        @model.volumeTracing.createCell()


    # Merging

    # no merging for now
    $("#btn-merge").hide()

    @mergeMode = @MERGE_MODE_NORMAL
    isMergeVisible = ->
      return $("#merge").css("visibility") == "visible"

    $("#btn-merge").on "click", ->
      $("#merge").css
        visibility : if isMergeVisible() then "hidden" else "visible"
      if isMergeVisible()
        $("#merge-cell1").focus()

    inputModeMapping =
      "#merge-cell1" : @MERGE_MODE_CELL1
      "#merge-cell2" : @MERGE_MODE_CELL2

    for input of inputModeMapping

      do (input) =>
        $(input).on "focus", =>
          @mergeMode = inputModeMapping[input]
          console.log @mergeMode
        $(input).keypress (event) =>
          if event.which == 13
            @merge()


  merge : ->

    inputs = [ $("#merge-cell1"), $("#merge-cell2") ]
    $("#merge").css( visibility: "hidden")
    console.log "Merge:", $("#merge-cell1").val(), $("#merge-cell2").val()

    for input in inputs
      input.blur()
      input.val("")



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
