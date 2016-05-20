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
      on : "RECORDING",
      onstyle : "danger",
      width : 140,
    })
    @updateCheckboxToggle()


  handleCheckboxChange : (evt) ->

    value = evt.target.checked
    @model.set("flightmodeRecording", value)


  updateCheckboxToggle : ->
    if @model.get("flightmodeRecording") == @ui.checkbox.prop("checked")
      return
    @ui.checkbox.prop({ checked:  @model.get("flightmodeRecording") }).change()


  onDestroy : ->

    @ui.checkbox.bootstrapToggle("destroy")


module.exports = ArbitraryPlaneInfo
