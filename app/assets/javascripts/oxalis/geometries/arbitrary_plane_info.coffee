marionette    = require("backbone.marionette")
ToggleButton  = require("bootstrap-toggle")

class ArbitraryPlaneInfo extends Backbone.Marionette.ItemView

  id : "arbitrary-info-canvas"

  template : _.template("""
    <input type="checkbox" <%= getCheckedStatus() %> >
  """)

  templateHelpers :
    getCheckedStatus : ->
      return "checked" if @flightmodeRecording

  events :
    "change input" : "handleCheckboxChange"

  ui :
    "checkbox" : "input"


  initialize : ->

    @listenTo(@model, "change:flightmodeRecording", @updateCheckboxToggle)


  onRender : ->

    @ui.checkbox.bootstrapToggle({
      off : "Watching",
      offstyle : "success",
      on : "SHIFT-SPACE FOR UNDO",
      onstyle : "danger",
      width : 240,
    })
    @updateCheckboxToggle()


  handleCheckboxChange : (evt) ->

    value = evt.target.checked
    @model.set("flightmodeRecording", value)

    # Set a inital waypoint when enabling flight mode
    # TODO: use the offical wK API
    if value = true
      app.oxalis.arbitraryController.setWaypoint()


  updateCheckboxToggle : ->
    if @model.get("flightmodeRecording") == @ui.checkbox.prop("checked")
      return
    @ui.checkbox.prop({ checked:  @model.get("flightmodeRecording") }).change()


  onDestroy : ->

    @ui.checkbox.bootstrapToggle("destroy")


module.exports = ArbitraryPlaneInfo
