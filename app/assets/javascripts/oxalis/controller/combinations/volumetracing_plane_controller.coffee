### define
underscore : _
oxalis/constants : Constants
../viewmodes/plane_controller : PlaneController
../annotations/volumetracing_controller : VolumeTracingController
###

class VolumeTracingPlaneController extends PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Volume Tracing Plane Controller:
  # Extends Plane controller to add controls that are specific to Volume
  # Tracing.


  constructor : (@model, stats, @view, @sceneController, @volumeTracingController) ->

    super(@model, stats, @view, @sceneController)

    @listenTo(@model.flycam, "positionChanged", =>
      @render3dCell @model.volumeTracing.getActiveCellId()
    )
    @listenTo(@model.flycam, "zoomStepChanged", =>
      @render3dCell @model.volumeTracing.getActiveCellId()
    )

    @listenTo(@model.user, "isosurfaceDisplayChanged", -> @render3dCell @model.volumeTracing.getActiveCellId())
    @listenTo(@model.user, "isosurfaceBBsizeChanged", -> @render3dCell @model.volumeTracing.getActiveCellId())
    @listenTo(@model.user, "isosurfaceResolutionChanged", -> @render3dCell @model.volumeTracing.getActiveCellId())
    @listenTo(@model.volumeTracing, "newActiveCell", (id) -> @render3dCell id)


  getPlaneMouseControls : (planeId) ->

    return _.extend super(planeId),

      leftDownMove : (delta, pos, plane, event) =>

        if @volumeTracingController.controlMode == Constants.VOLUME_MODE_MOVE
          @move [
            delta.x * @model.user.getMouseInversionX() / @planeView.scaleFactor
            delta.y * @model.user.getMouseInversionY() / @planeView.scaleFactor
            0
          ]
        else
          @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))

      leftMouseDown : (pos, plane, event) =>

        if event.shiftKey
          @volumeTracingController.enterDeleteMode()
        @model.volumeTracing.startEditing(plane)

      leftMouseUp : =>

        @model.volumeTracing.finishLayer()
        @volumeTracingController.restoreAfterDeleteMode()

      rightDownMove : (delta, pos, plane, event) =>

        @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))

      rightMouseDown : (pos, plane, event) =>

        @volumeTracingController.enterDeleteMode()
        @model.volumeTracing.startEditing(plane)

      rightMouseUp : =>

        @model.volumeTracing.finishLayer()
        @volumeTracingController.restoreAfterDeleteMode()

      leftClick : (pos, plane, event) =>

        cellId = @model.getSegmentationBinary().cube.getDataValue(
                  @calculateGlobalPos( pos ))

        @volumeTracingController.handleCellSelection( cellId )


  getKeyboardControls : ->

    _.extend super(),

      "c" : =>
        @model.volumeTracing.createCell()


  render3dCell : (id) ->

    unless @model.user.get("isosurfaceDisplay")
      @sceneController.removeShapes()
    else
      bb = @model.flycam.getViewportBoundingBox()
      res = @model.user.get("isosurfaceResolution")
      @sceneController.showShapes(@scaleIsosurfaceBB(bb), res, id)
    @model.flycam.update()

  scaleIsosurfaceBB : (bb) ->
    factor = @model.user.get("isosurfaceBBsize")
    for i in [0..2]
      width = bb.max[i] - bb.min[i]
      diff = (factor - 1) * width / 2
      bb.min[i] -= diff
      bb.max[i] += diff
    return bb
