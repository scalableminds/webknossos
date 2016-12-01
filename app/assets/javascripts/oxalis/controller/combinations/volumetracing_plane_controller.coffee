_                       = require("lodash")
Constants               = require("oxalis/constants")
PlaneController         = require("../viewmodes/plane_controller")
VolumeTracingController = require("../annotations/volumetracing_controller")

class VolumeTracingPlaneController extends PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Volume Tracing Plane Controller:
  # Extends Plane controller to add controls that are specific to Volume
  # Tracing.


  constructor : (@model, @view, @sceneController, @volumeTracingController) ->

    super(@model, @view, @sceneController)

    @listenTo(@model.flycam, "positionChanged", =>
      @render3dCell @model.volumeTracing.getActiveCellId()
    )
    @listenTo(@model.flycam, "zoomStepChanged", =>
      @render3dCell @model.volumeTracing.getActiveCellId()
    )

    @listenTo(@model.user, "isosurfaceDisplayChanged", -> @render3dCell @model.volumeTracing.getActiveCellId())
    @listenTo(@model.user, "isosurfaceBBsizeChanged", -> @render3dCell @model.volumeTracing.getActiveCellId())
    @listenTo(@model.user, "isosurfaceResolutionChanged", -> @render3dCell @model.volumeTracing.getActiveCellId())
    @listenTo(@model.volumeTracing, "newActiveCell", (id) ->
      id = @model.volumeTracing.getActiveCellId()
      if id > 0
        @render3dCell id)


  simulateTracing : =>

    @model.volumeTracing.setMode(Constants.VOLUME_MODE_TRACE)

    controls = @getPlaneMouseControls()
    pos = (x, y) -> {x, y}

    controls.leftMouseDown(pos(100, 100), 0, {})

    _.defer =>
      controls.leftDownMove(null, pos(200, 100))
      _.defer =>
        controls.leftDownMove(null, pos(200, 200))
        _.defer =>
          controls.leftDownMove(null, pos(100, 200))
          _.defer =>
            controls.leftDownMove(null, pos(100, 100))
            controls.leftMouseUp()
            _.defer =>
              pos = @model.flycam.getPosition()
              pos[2]++
              @model.flycam.setPosition(pos)
              _.defer(@simulateTracing)


  getPlaneMouseControls : (planeId) ->

    return _.extend super(planeId),

      leftDownMove : (delta, pos, plane, event) =>

        if @model.volumeTracing.mode == Constants.VOLUME_MODE_MOVE
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
        @adjustSegmentationOpacity()

      leftMouseUp : =>

        @model.volumeTracing.finishLayer()
        @volumeTracingController.restoreAfterDeleteMode()

      rightDownMove : (delta, pos, plane, event) =>

        @model.volumeTracing.addToLayer( @calculateGlobalPos(pos))

      rightMouseDown : (pos, plane, event) =>

        @volumeTracingController.enterDeleteMode()
        @model.volumeTracing.startEditing(plane)
        @adjustSegmentationOpacity()

      rightMouseUp : =>

        @model.volumeTracing.finishLayer()
        @volumeTracingController.restoreAfterDeleteMode()

      leftClick : (pos, plane, event) =>

        cellId = @model.getSegmentationBinary().cube.getDataValue(
                  @calculateGlobalPos( pos ))

        @volumeTracingController.handleCellSelection( cellId )


  adjustSegmentationOpacity : ->

    if @model.user.get("segmentationOpacity") < 10
      @model.user.set("segmentationOpacity", 50)


  getKeyboardControls : ->

    _.extend super(),

      "c" : =>
        @model.volumeTracing.createCell()


module.exports = VolumeTracingPlaneController
