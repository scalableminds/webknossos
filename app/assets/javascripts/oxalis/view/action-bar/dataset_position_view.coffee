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
        <input id="trace-position-input" class="form-control" type="text" value="<%= vec3ToString(position) %>">
      </div>
    </div>
    <div class="form-group">
      <% if(isArbitrayMode()) { %>
        <div class="input-group">
          <span class="input-group-addon">Rotation</span>
          <input id="trace-rotation-input" class="form-control" type="text" value="<%= vec3ToString(rotation) %>">
        </div>
      <% } %>
    </div>
  """)

  templateHelpers :
    vec3ToString : (vec3) ->
      return Math.floor(vec3[0]) + ", " + Math.floor(vec3[1]) + ", " + Math.floor(vec3[2])

    isArbitrayMode : ->
      return @controlMode in constants.MODES_ARBITRARY

  events :
    "change #trace-position-input" : "changePosition"
    "change #trace-rotation-input" : "changeRotation"


  initialize : (options) ->

    # TODO make controlMode a property of the model and read from there
    @listenTo(app.vent, "changeViewMode", @render)

    # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
    @listenTo(@model.get("flycam3d"), "changed", @render)
    @listenTo(@model.get("flycam"), "positionChanged", @render)


  serializeData : ->

    #TODO refactor / remove after deepmodel
    data =
      controlMode : @model.controlMode

    if @model.flycam
      _.extend(data,
        position : @model.flycam.getPosition()
      )
    if @model.flycam3d
      _.extend(data,
        rotation : @model.flycam3d.getRotation()
      )

    return data


  # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
  changePosition : (event) ->

    posArray = Utils.stringToNumberArray(event.target.value)
    if posArray.length == 3
      @model.flycam.setPosition(posArray)

    @render()


  changeRotation : (event) ->

    rotArray = Utils.stringToNumberArray(event.target.value)
    if rotArray.length == 3
      @model.flycam3d.setRotation rotArray

    @render()


  onDestroy : ->

    @model.flycam3d.off("changed")
    @model.flycam.off("positionChanged")

