### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
libs/utils : Utils
###

class DatasetPositionView extends Backbone.Marionette.ItemView

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
      <% if(isArbitrayMode()) { %>
        <div class="input-group">
          <span class="input-group-addon">Rotation</span>
          <input id="trace-rotation-input" class="form-control" type="text" value="<%= rotation() %>">
        </div>
      <% } %>
    </div>
  """)

  templateHelpers :
    position : ->
      @vec3ToString(@flycam.position)

    rotation : ->
      @vec3ToString(@flycam3d.rotation)

    vec3ToString : (vec3) ->
      return Math.floor(vec3[0]) + ", " + Math.floor(vec3[1]) + ", " + Math.floor(vec3[2])

    isArbitrayMode : ->
      return @controlMode in constants.MODES_ARBITRARY

  events :
    "change #trace-position-input" : "changePosition"
    "change #trace-rotation-input" : "changeRotation"


  initialize : (options) ->

    @listenTo(app.vent, "changeViewMode", @render)

    # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
    @listenTo(@model.get("flycam3d"), "changed", @render)
    @listenTo(@model.get("flycam"), "positionChanged", @render)


  changePosition : (event) ->

    posArray = Utils.stringToNumberArray(event.target.value)
    if posArray.length == 3
      @model.flycam.setPosition(posArray)


  changeRotation : (event) ->

    rotArray = Utils.stringToNumberArray(event.target.value)
    if rotArray.length == 3
      @model.flycam3d.setRotation rotArray


  onDestroy : ->

    @model.flycam3d.off("changed")
    @model.flycam.off("positionChanged")

