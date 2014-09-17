### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
oxalis/controller/viewmodes/arbitrary_controller : ArbitraryController
###

class DatsetActionsView extends Backbone.Marionette.ItemView

  className : "col-sm-12"
  id : "dataset"
  template : _.template("""
    <div class="well">
      <p><% annotationType %></p>
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

    @listenTo(app.vent, "model:sync", ->

      @_model.flycam3d.on("changed", =>
        @render()
      )

      @_model.flycam.on("zoomStepChanged", =>
        @render()
      )

      @render()
    )

  serializeData : ->

    #TODO refactor / remove after deepmodel
    defaults =
      annotationType : @tracingType
      zoomLevel : 0
      dataSetName: ""

    if @_model.flycam or @_model.flycam3d
      _.extend(defaults,
        zoomLevel : @calculateZoomLevel()
        dataSetName :@_model.dataSetName
      )

    return defaults


  calculateZoomLevel : ->

    if @_model.mode in constants.MODES_PLANE
      zoom  = @_model.flycam.getPlaneScalingFactor()
      width = constants.PLANE_WIDTH

    if @_model.mode in constants.MODES_ARBITRARY
      zoom  = @_model.flycam3d.zoomStep
      width = ArbitraryController::WIDTH

    # unit is nm
    return zoom * width * app.scaleInfo.baseVoxel


  onClose : ->

    @_model.flycam3d.off("changed")
    @_model.flycam.off("changed")

