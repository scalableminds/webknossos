_          = require("lodash")
Marionette = require("backbone.marionette")
Constants  = require("oxalis/constants")

class SkeletonActionsView extends Marionette.ItemView

  template : _.template("""
    <div class="btn-group">
      <button type="button" class="btn btn-default" id="add-node">Add Node (Right-Click) </button>
    </div>
  """)

  events :
    "click #add-node" : "addNode"

  addNode : ->

    # create xy offset
    position = @model.flycam.getPosition()

    datasetConfig = @model.get("datasetConfiguration")

    # add node
    @model.skeletonTracing.addNode(
      position,
      @model.flycam.getRotation(Constants.PLANE_XY),
      Constants.TYPE_USUAL,
      Constants.PLANE_XY, # xy viewport
      @model.flycam.getIntegerZoomStep(),
      if datasetConfig.get("fourBit") then 4 else 8,
      datasetConfig.get("interpolation")
    )
    newPosition = position.slice()
    newPosition[0] += Math.pow(2, @model.flycam.getIntegerZoomStep())
    newPosition[1] += Math.pow(2, @model.flycam.getIntegerZoomStep())
    @model.flycam.setPosition(newPosition)

module.exports = SkeletonActionsView
