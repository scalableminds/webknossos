### define
../../model/dimensions : Dimensions
../../constants : constants
libs/input : Input
###

class VolumeTracingController

  # See comment in Controller class on general controller architecture.
  #
  # Volume Tracing Controller:
  # Add Volume Tracing controls that are not specific to the view mode.
  # Also, this would be the place to define general Volume Tracing
  # functions that can be called by the specific view mode controller.


  MERGE_MODE_NORMAL : 0
  MERGE_MODE_CELL1  : 1
  MERGE_MODE_CELL2  : 2

  CONTROL_MODE_MOVE : 0
  CONTROL_MODE_TRACE : 1


  constructor : ( @model, @sceneController, @volumeTracingView ) ->

    @inDeleteMode = false
    @controlMode = @CONTROL_MODE_MOVE


    # Keyboard shortcuts
    new Input.KeyboardNoLoop(
      "m" : => @toggleControlMode()
    )

    # Control mode
    @controlModeMapping =
      "control-mode-move" : @CONTROL_MODE_MOVE
      "control-mode-trace" : @CONTROL_MODE_TRACE

    for control of @controlModeMapping

      do (control) =>
        $("#" + control).on "click", =>
          @setControlMode(@controlModeMapping[control])


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


  setControlMode : (@controlMode) ->

    # Set button class
    for button in $("#control-mode .btn-group").children()

      $(button).removeClass("btn-primary")
      if @controlMode == @controlModeMapping[$(button).attr("id")]
        $(button).addClass("btn-primary")


  toggleControlMode : ->

    if @controlMode == @CONTROL_MODE_MOVE
      @setControlMode(@CONTROL_MODE_TRACE)
    else
      @setControlMode(@CONTROL_MODE_MOVE)


  merge : ->

    inputs = [ $("#merge-cell1"), $("#merge-cell2") ]
    $("#merge").css( visibility: "hidden")
    console.log "Merge:", $("#merge-cell1").val(), $("#merge-cell2").val()

    for input in inputs
      input.blur()
      input.val("")


  handleCellSelection : (cellId) ->

    if cellId > 0
      if      @mergeMode == @MERGE_MODE_NORMAL
        @model.volumeTracing.setActiveCell( cellId )
      else if @mergeMode == @MERGE_MODE_CELL1
        $("#merge-cell1").val(cellId)
        $("#merge-cell2").focus()
      else if @mergeMode == @MERGE_MODE_CELL2
        $("#merge-cell2").val(cellId)
        @merge()



  enterDeleteMode : ->

    return if @inDeleteMode

    @inDeleteMode = true

    @prevActiveCell = @model.volumeTracing.getActiveCellId()
    @model.volumeTracing.setActiveCell(0)


  restoreAfterDeleteMode : ->

    if @inDeleteMode
      @model.volumeTracing.setActiveCell( @prevActiveCell )
    @inDeleteMode = false


  drawVolume : (pos) ->

    @model.volumeTracing.addToLayer(pos)
