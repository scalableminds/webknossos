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

    {@_model, @controlMode, @tracingType} = options

    @listenTo(@_model.flycam3d, "changed", @render)
    @listenTo(@_model.flycam, "zoomStepChanged", @render)


  serializeData : ->

    return {
      annotationType : @tracingType
      zoomLevel : @calculateZoomLevel()
      dataSetName :@_model.get("dataset").get("name")
    }


  calculateZoomLevel : ->

    if @_model.mode in constants.MODES_PLANE
      zoom  = @_model.flycam.getPlaneScalingFactor()
      width = constants.PLANE_WIDTH

    if @_model.mode in constants.MODES_ARBITRARY
      zoom  = @_model.flycam3d.zoomStep
      width = ArbitraryController::WIDTH

    # unit is nm
    return zoom * width * app.scaleInfo.baseVoxel


  onDestroy : ->

    @_model.flycam3d.off("changed")
    @_model.flycam.off("zoomStepChanged")

