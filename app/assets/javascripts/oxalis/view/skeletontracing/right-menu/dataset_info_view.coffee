### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
oxalis/controller/viewmodes/arbitrary_controller : ArbitraryController
###

class DatasetInfoView extends Backbone.Marionette.ItemView

  className : "col-sm-12"
  id : "dataset"
  template : _.template("""
    <div class="well">
      <p><%= annotationType %></p>
      <p>DataSet: <%= dataSetName %></p>
      <p>Viewport width: <%= chooseUnit(zoomLevel) %></p>
    </div>
    <div id="zoomstep-warning" class="volume-controls">
      <p>Volume tracings are only fully supported at a smaller zoom level. Please zoom in to annotate.</p>
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


  serializeData : ->

    return {
      annotationType : @model.get("tracingType")
      zoomLevel : @calculateZoomLevel()
      dataSetName :@model.get("dataset").get("name")
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

