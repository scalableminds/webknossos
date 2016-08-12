_          = require("lodash")
Marionette = require("backbone.marionette")
Constants  = require("oxalis/constants")

class SkeletonActionsView extends Marionette.ItemView

  template : _.template("""
    <% if(isTracingMode()) { %>
      <div class="btn-group">
	<button type="button" class="btn btn-default" id="add-node">Add Node (Right-Click) </button>
      </div>
    <% } %>
  """)

  templateHelpers :
    isTracingMode : ->
      return @mode == Constants.MODE_PLANE_TRACING

  events :
    "click #add-node" : "addNode"

  initialize : ->

    @listenTo(@model, "change:mode", @render)


  addNode : ->

    datasetConfig = @model.get("datasetConfiguration")

    # add node
    @model.skeletonTracing.addNode(
      @model.flycam.getPosition(),
      @model.flycam.getRotation(Constants.PLANE_XY),
      Constants.PLANE_XY, # xy viewport
      @model.flycam.getIntegerZoomStep(),
      if datasetConfig.get("fourBit") then 4 else 8,
      datasetConfig.get("interpolation")
    )

module.exports = SkeletonActionsView
