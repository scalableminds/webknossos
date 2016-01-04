marionette          = require("backbone.marionette")
app                 = require("app")
constants           = require("oxalis/constants")
ArbitraryController = require("oxalis/controller/viewmodes/arbitrary_controller")

class DatasetInfoView extends Backbone.Marionette.ItemView

  className : "col-sm-12 flex-column"
  id : "dataset"
  template : _.template("""
    <div class="well">
      <p><%- annotationType %></p>
      <p>DataSet: <%- dataSetName %></p>
      <p>Viewport width: <%- chooseUnit(zoomLevel) %></p>
      <% if(treeCount != null) { %>
        <p>Total number of trees: <%- treeCount %></p>
      <% } %>
    </div>
  """)

  templateHelpers :
    chooseUnit : ->
      if(@zoomLevel < 1000)
        return @zoomLevel.toFixed(0) + " nm"
      else if (@zoomLevel < 1000000)
        return (@zoomLevel / 1000).toFixed(1) + " μm"
      else
        return (@zoomLevel / 1000000).toFixed(1) + " mm"


  initialize : (options) ->

    @listenTo(@model.flycam3d, "changed", @render)
    @listenTo(@model.flycam, "zoomStepChanged", @render)

    if @model.skeletonTracing
      @listenTo(@model.skeletonTracing, "deleteTree", @render)
      @listenTo(@model.skeletonTracing, "mergeTree", @render)
      @listenTo(@model.skeletonTracing, "newTree", @render)


  serializeData : ->

    annotationType = @model.get("tracingType")
    task = @model.get("tracing").task

    # In case we have a task display its id as well
    if task then annotationType += " #{task.formattedHash}"

    return {
      annotationType : annotationType
      zoomLevel : @calculateZoomLevel()
      dataSetName : @model.get("dataset").get("name")
      treeCount : @model.skeletonTracing?.trees.length
    }


  calculateZoomLevel : ->

    if @model.mode in constants.MODES_PLANE
      zoom  = @model.flycam.getPlaneScalingFactor()
      width = constants.PLANE_WIDTH

    if @model.mode in constants.MODES_ARBITRARY
      zoom  = @model.flycam3d.zoomStep
      width = ArbitraryController::WIDTH

    # unit is nm
    return zoom * width * app.scaleInfo.baseVoxel


  onDestroy : ->

    @model.flycam3d.off("changed")
    @model.flycam.off("zoomStepChanged")

module.exports = DatasetInfoView
