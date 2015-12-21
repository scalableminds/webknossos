Marionette = require("backbone.marionette")
app        = require("app")
constants  = require("oxalis/constants")
utils      = require("libs/utils")

class DatasetPositionView extends Marionette.ItemView

  tagName : "form"
  className : "form-inline dataset-position-view"
  template : _.template("""
    <div class="form-group">
      <div class="input-group">
        <span class="input-group-addon">Position</span>
        <input id="trace-position-input" class="form-control" type="text" value="<%= position() %>">
      </div>
    </div>
    <div class="form-group">
      <% if(isArbitrayMode) { %>
        <div class="input-group">
          <span class="input-group-addon">Rotation</span>
          <input id="trace-rotation-input" class="form-control" type="text" value="<%= rotation() %>">
        </div>
      <% } %>
    </div>
  """)

  templateHelpers :
    position : ->
      @vec3ToString(@flycam.getPosition())

    rotation : ->
      @vec3ToString(@flycam3d.getRotation())

    vec3ToString : (vec3) ->
      vec3 = utils.floorArray(vec3)
      return vec3[0] + ", " + vec3[1] + ", " + vec3[2]

  events :
    "change #trace-position-input" : "changePosition"
    "change #trace-rotation-input" : "changeRotation"


  initialize : (options) ->

    @viewMode = constants.MODE_PLANE_TRACING
    @listenTo(@model, "change:mode", @updateViewMode)

    # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
    @listenTo(@model.get("flycam3d"), "changed", @render)
    @listenTo(@model.get("flycam"), "positionChanged", @render)


  serializeData : ->

    return _.extend(@model, {
      isArbitrayMode : @viewMode in constants.MODES_ARBITRARY
    })


  updateViewMode : (@viewMode) ->

    @render()


  changePosition : (event) ->

    posArray = utils.stringToNumberArray(event.target.value)
    if posArray.length == 3
      @model.flycam.setPosition(posArray)
      app.vent.trigger("centerTDView")


  changeRotation : (event) ->

    rotArray = utils.stringToNumberArray(event.target.value)
    if rotArray.length == 3
      @model.flycam3d.setRotation rotArray


  onDestroy : ->

    @model.flycam3d.off("changed")
    @model.flycam.off("positionChanged")

module.exports = DatasetPositionView
