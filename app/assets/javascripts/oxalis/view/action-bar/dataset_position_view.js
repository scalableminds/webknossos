Marionette = require("backbone.marionette")
Clipboard  = require("clipboard-js")
app        = require("app")
constants  = require("oxalis/constants")
utils      = require("libs/utils")
Toast      = require("libs/toast")
{V3}       = require("libs/mjs")

class DatasetPositionView extends Marionette.View

  tagName : "div"
  className : "form-inline dataset-position-view"
  template : _.template("""
    <div class="form-group">
      <div class="input-group">
        <span class="input-group-btn">
          <button class="btn btn-primary">Position</button>
        </span>
        <input id="trace-position-input" class="form-control" type="text" value="<%- position() %>">
      </div>
    </div>
    <div class="form-group">
      <% if(isArbitrayMode()) { %>
        <div class="input-group">
          <span class="input-group-addon">Rotation</span>
          <input id="trace-rotation-input" class="form-control" type="text" value="<%- rotation() %>">
        </div>
      <% } %>
    </div>
  """)

  templateContext :
    position : ->
      V3.floor(@flycam.getPosition()).join(", ")

    rotation : ->
      V3.round(@flycam3d.getRotation()).join(", ")

    isArbitrayMode : ->
      return @mode in constants.MODES_ARBITRARY


  events :
    "change #trace-position-input" : "changePosition"
    "change #trace-rotation-input" : "changeRotation"
    "click button" : "copyToClipboard"

  ui :
    "positionInput" : "#trace-position-input"
    "rotationInput" : "#trace-rotation-input"


  initialize : (options) ->

    @render = _.throttle(@render, 100)
    @listenTo(@model, "change:mode", @render)

    # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
    @listenTo(@model.get("flycam3d"), "changed", @render)
    @listenTo(@model.get("flycam"), "positionChanged", @render)


  # Rendering performance optimization
  attachElContent : (html) ->
    this.el.innerHTML = html
    return html


  changePosition : (event) ->

    posArray = utils.stringToNumberArray(event.target.value)
    if posArray.length == 3
      @model.flycam.setPosition(posArray)
      app.vent.trigger("centerTDView")
      @ui.positionInput.get(0).setCustomValidity("")
    else
      @ui.positionInput.get(0).setCustomValidity("Please supply a valid position, like 1,1,1!")
      @ui.positionInput.get(0).reportValidity()
    return


  changeRotation : (event) ->

    rotArray = utils.stringToNumberArray(event.target.value)
    if rotArray.length == 3
      @model.flycam3d.setRotation(rotArray)
      @ui.rotationInput.get(0).setCustomValidity("")
    else
      @ui.rotationInput.get(0).setCustomValidity("Please supply a valid rotation, like 1,1,1!")
      @ui.rotationInput.get(0).reportValidity()
    return


  copyToClipboard : (evt) ->

    evt.preventDefault()

    positionString = @ui.positionInput.val()
    Clipboard.copy(positionString).then(
      -> Toast.success("Position copied to clipboard")
    )

  onDestroy : ->

    @model.flycam3d.off("changed")
    @model.flycam.off("positionChanged")

module.exports = DatasetPositionView
