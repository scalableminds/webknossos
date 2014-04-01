### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
libs/utils : Utils
###

class DatsetPositionView extends Marionette.ItemView

  template : _.template("""
    <div class="input-group">
      <span class="input-group-addon">Position</span>
      <input id="trace-position-input" class="form-control" type="text" value="<%= vec3ToString(position) %>">
    </div>
    <% if(isArbitrayMode()) { %>
      <div class="input-group">
        <span class="input-group-addon">Rotation</span>
        <input id="trace-rotation-input" class="form-control" type="text" value="<%= vec3ToString(rotation) %>">
      </div>
    <% } %>
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

    {@_model, @controlMode} = options

    @listenTo(app.vent, "model:sync", ->

      # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
      @_model.flycam3d.on("changed", =>
        @render()
      )

      @_model.flycam.on("positionChanged", =>
        @render()
      )

      @render()
    )

  serializeData : ->

    #TODO refactor / remove after deepmodel
    defaults =
      position : [0,0,0]
      rotation : [0,0,0]
      controlMode : @controlMode

    if @_model.flycam
      _.extend(defaults,
        position : @_model.flycam.getPosition()
      )
    if @_model.flycam3d
      _.extend(defaults,
        rotation :@_model.flycam3d.getRotation()
      )

    return defaults


  # TODO MEASURE PERFORMANCE HIT BECAUSE OF CONSTANT RE-RENDER
  changePosition : (event) ->

    posArray = Utils.stringToNumberArray(event.target.value)
    if posArray.length == 3
      @_model.flycam.setPosition(posArray)

    @render()


  changeRotation : (event) ->

    rotArray = Utils.stringToNumberArray(event.target.value)
    if rotArray.length == 3
      @_model.flycam3d.setRotation rotArray

    @render()


  onClose : ->

    @_model.flycam3d.off("changed")
    @_model.flycam.off("changed")

