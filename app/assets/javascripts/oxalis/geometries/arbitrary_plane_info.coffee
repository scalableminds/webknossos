marionette = require("backbone.marionette")

class ArbitraryPlaneInfo extends Backbone.Marionette.ItemView

  NOT_RECORDING_CLASS : "not-recording"
  NOT_RECORDING : "Watching"
  RECORDING_CLASS : "Recording"
  RECORDING : "RECORDING"

  tagName: "div"
  id: "arbitrary-info-canvas"
  className: ->
    if @model.get("isRecording")
      return @RECORDING_CLASS
    else
      return @NOT_RECORDING_CLASS

  template : _.template("""
    <span class="recording-text">
      <%= recordingText %>
    </span>
  """)

  constructor : ->

    @model = new Backbone.Model({
      isRecording : false,
      recordingText : @NOT_RECORDING
    })

    super()


  initialize : ->

    @listenTo(@model, "change", @render)


  updateInfo : (isRecording) ->

    @model.set({
      isRecording : isRecording,
      recordingText : if isRecording then @RECORDING else @NOT_RECORDING
    })

    @$el
      .removeClass(@NOT_RECORDING_CLASS)
      .removeClass(@RECORDING_CLASS)
      .addClass(@className())


module.exports = ArbitraryPlaneInfo
