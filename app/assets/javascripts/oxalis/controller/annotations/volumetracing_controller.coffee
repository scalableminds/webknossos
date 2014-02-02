### define
../../model/dimensions : Dimensions
../../constants : constants
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
