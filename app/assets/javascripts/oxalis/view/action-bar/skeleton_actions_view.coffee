_          = require("lodash")
Marionette = require("backbone.marionette")
Constants  = require("oxalis/constants")

# TODO FINISH MERGE

class SkeletonActionsView extends Marionette.ItemView

  template : _.template("""
    <div class="btn-group">
      <button type="button" class="btn btn-default btn-primary" id="mode-trace">Trace</button>
      <button type="button" class="btn btn-default " id="mode-watch">Watch</button>


      <button type="button" class="btn btn-default" id="mode-trace">Add Node (Right-Click) </button>
      <button type="button" class="btn btn-default" id="mode-trace">Create new cell (C)</button>
    </div>
  """)

  modeMapping :
    "mode-trace" : Constants.VOLUME_MODE_TRACE
    "mode-move" : Constants.VOLUME_MODE_MOVE

  events :
    "click button" : "changeMode"


  initialize : (options) ->

    return
  #   @listenTo(app.vent, "changeVolumeMode", @updateForMode)


  # changeMode : (evt) ->

  #   mode = @modeMapping[evt.target.id]
  #   app.vent.trigger("changeVolumeMode", mode)


  # updateForMode : (mode) ->

  #   @$("button").removeClass("btn-primary")

  #   buttonId = _.invert(@modeMapping)[mode]
  #   @$("##{buttonId}").addClass("btn-primary")

  addNode : ->

    # create xy offset
    position = @model.flycam.getPosition()
    position[0] = position[0] + Math.pow(2, @model.flycam.getIntegerZoomStep())
    position[1] = position[1] + Math.pow(2, @model.flycam.getIntegerZoomStep())

    datasetConfig = @model.get("datasetConfiguration")

    # add node
    @model.skeletonTracing.addNode(
      position,
      constants.TYPE_USUAL,
      constants.PLANE_XY, # xy viewport
      @model.flycam.getIntegerZoomStep(),
      if datasetConfig.get("fourBit") then 4 else 8,
      datasetConfig.get("interpolation")
    )

module.exports = SkeletonActionsView
