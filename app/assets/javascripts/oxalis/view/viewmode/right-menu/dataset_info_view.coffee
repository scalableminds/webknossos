Marionette          = require("backbone.marionette")
app                 = require("app")
constants           = require("oxalis/constants")
ArbitraryController = require("oxalis/controller/viewmodes/arbitrary_controller")

class DatasetInfoView extends Marionette.View

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

  templateContext :
    chooseUnit : ->
      if(@zoomLevel < 1000)
        return @zoomLevel.toFixed(0) + " nm"
      else if (@zoomLevel < 1000000)
        return (@zoomLevel / 1000).toFixed(1) + " μm"
      else
        return (@zoomLevel / 1000000).toFixed(1) + " mm"


  initialize : (options) ->

    @render = _.throttle(@render, 100)
    @listenTo(@model.flycam3d, "changed", @render)
    @listenTo(@model.flycam, "zoomStepChanged", @render)

    if @model.skeletonTracing
      @listenTo(@model.skeletonTracing, "deleteTree", @render)
      @listenTo(@model.skeletonTracing, "mergeTree", @render)
      @listenTo(@model.skeletonTracing, "newTree", @render)


  # Rendering performance optimization
  attachElContent : (html) ->
    this.el.innerHTML = html
    return html


  serializeData : ->

    annotationType = @model.get("tracingType")
    tracing = @model.get("tracing")
    task = tracing.task
    name = tracing.name

    # In case we have a task display its id as well
    if task then annotationType += ": #{task.id}"
    # Or display an explorative tracings name if there is one
    if name then annotationType += ": #{name}"

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
