app                       = require("app")
Backbone                  = require("backbone")
$                         = require("jquery")
_                         = require("lodash")
Utils                     = require("libs/utils")
Input                     = require("libs/input")
Trackball                 = require("three.trackball")
CameraController          = require("../camera_controller")
Dimensions                = require("../../model/dimensions")
PlaneView                 = require("../../view/plane_view")
constants                 = require("../../constants")
SkeletonTracingController = require("../annotations/skeletontracing_controller")
VolumeTracingController   = require("../annotations/volumetracing_controller")
THREE                     = require("three")

class PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Plane Controller: Responsible for Plane Modes


  bindings : []
  model : null
  view : null

  input :
    mouseControllers : []
    keyboard : null
    keyboardNoLoop : null
    keyboardLoopDelayed : null

    destroy : ->

      for mouse in @mouseControllers
        mouse.destroy()
      @mouseControllers = []
      @keyboard?.destroy()
      @keyboardNoLoop?.destroy()
      @keyboardLoopDelayed?.destroy()


  constructor : (@model, @view, @sceneController) ->

    _.extend(this, Backbone.Events)

    @isStarted = false

    @flycam = @model.flycam

    @oldNmPos = app.scaleInfo.voxelToNm( @flycam.getPosition() )

    @planeView = new PlaneView(@model, @view)

    @activeViewport = constants.PLANE_XY

    # initialize Camera Controller
    @cameraController = new CameraController(@planeView.getCameras(), @flycam, @model)

    @canvasesAndNav = $("#main")[0]

    @TDViewControls = $('#TDViewControls')
    @TDViewControls.addClass("btn-group")

    callbacks = [
      @cameraController.changeTDViewDiagonal,
      @cameraController.changeTDViewXY,
      @cameraController.changeTDViewYZ,
      @cameraController.changeTDViewXZ
    ]
    $("#TDViewControls button").each((i, element) =>
      $(element).on("click", callbacks[i])
    )

    meshes = @sceneController.getMeshes()

    for mesh in meshes
      @planeView.addGeometry(mesh)

    @model.user.triggerAll()
    @model.datasetConfiguration.triggerAll()

    @initTrackballControls()
    @bindToEvents()
    @stop()


  initMouse : ->

    for planeId in [0..2]
      do (planeId) =>
        inputcatcher = $("#plane#{constants.PLANE_NAMES[planeId]}")
        @input.mouseControllers.push(
          new Input.Mouse(inputcatcher, @getPlaneMouseControls(planeId), planeId))

    @input.mouseControllers.push(
      new Input.Mouse($("#TDView"), @getTDViewMouseControls(), constants.TDView ))


  getTDViewMouseControls : ->

    return {
      leftDownMove : (delta) => @moveTDView(delta)
      scroll : (value) => @zoomTDView(Utils.clamp(-1, value, 1), true)
      over : => @planeView.setActiveViewport( @activeViewport = constants.TDView )
    }


  getPlaneMouseControls : (planeId) ->

    return {

      leftDownMove : (delta, pos) =>

        @move [
          delta.x * @model.user.getMouseInversionX() / @planeView.scaleFactor
          delta.y * @model.user.getMouseInversionY() / @planeView.scaleFactor
          0
        ]

      over : =>
        $(':focus').blur()
        @planeView.setActiveViewport( @activeViewport = planeId )

      scroll : @scrollPlanes
    }


  initTrackballControls : ->

    view = $("#TDView")[0]
    pos = app.scaleInfo.voxelToNm(@flycam.getPosition())
    @controls = new THREE.TrackballControls(
      @planeView.getCameras()[constants.TDView],
      view,
      new THREE.Vector3(pos...),
      -> app.vent.trigger("rerender"))

    @controls.noZoom = true
    @controls.noPan = true
    @controls.staticMoving = true

    @controls.target.set(
      app.scaleInfo.voxelToNm(@flycam.getPosition())...)

    @listenTo(@flycam, "positionChanged", (position) ->

      nmPosition = app.scaleInfo.voxelToNm(position)

      @controls.target.set( nmPosition... )
      @controls.update()

      # As the previous step will also move the camera, we need to
      # fix this by offsetting the viewport

      invertedDiff = []
      for i in [0..2]
        invertedDiff.push( @oldNmPos[i] - nmPosition[i] )
      @oldNmPos = nmPosition

      @cameraController.moveTDView(
        new THREE.Vector3( invertedDiff... )
      )
    )

    @listenTo(@cameraController, "cameraPositionChanged", @controls.update)


  initKeyboard : ->

    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    getMoveValue  = (timeFactor) =>
      if @activeViewport in [0..2]
        return @model.user.get("moveValue") * timeFactor / app.scaleInfo.baseVoxel / constants.FPS
      else
        return constants.TDView_MOVE_SPEED * timeFactor / constants.FPS

    @input.keyboard = new Input.Keyboard(

      #ScaleTrianglesPlane
      "l" : (timeFactor) => @scaleTrianglesPlane(-@model.user.get("scaleValue") * timeFactor )
      "k" : (timeFactor) => @scaleTrianglesPlane( @model.user.get("scaleValue") * timeFactor )

      #Move
      "left"  : (timeFactor) => @moveX(-getMoveValue(timeFactor))
      "right" : (timeFactor) => @moveX( getMoveValue(timeFactor))
      "up"    : (timeFactor) => @moveY(-getMoveValue(timeFactor))
      "down"  : (timeFactor) => @moveY( getMoveValue(timeFactor))

    )

    @input.keyboardLoopDelayed = new Input.Keyboard(

      # KeyboardJS is sensitive to ordering (complex combos first)
      "shift + f"     : (timeFactor, first) => @moveZ( getMoveValue(timeFactor) * 5, first)
      "shift + d"     : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor) * 5, first)

      "shift + space" : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor)    , first)
      "ctrl + space"  : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor)    , first)
      "space"         : (timeFactor, first) => @moveZ( getMoveValue(timeFactor)    , first)
      "f"             : (timeFactor, first) => @moveZ( getMoveValue(timeFactor)    , first)
      "d"             : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor)    , first)

    , @model.user.get("keyboardDelay")
    )

    @listenTo(@model.user, "change:keyboardDelay", (model, value) -> @input.keyboardLoopDelayed.delay = value)

    @input.keyboardNoLoop = new Input.KeyboardNoLoop( @getKeyboardControls() )


  getKeyboardControls : ->

    return {
      #Zoom in/out
      "i" : => @zoom( 1, false)
      "o" : => @zoom(-1, false)

      #Change move value
      "h" : => @changeMoveValue(25)
      "g" : => @changeMoveValue(-25)
    }


  init : ->

    @cameraController.setClippingDistance(@model.user.get("clippingDistance"))
    @sceneController.setClippingDistance(@model.user.get("clippingDistance"))


  start : (newMode) ->

    @stop()

    @sceneController.start()
    @planeView.start()

    @initKeyboard()
    @init()
    @initMouse()

    @isStarted = true


  stop : ->

    if @isStarted
      @input.destroy()

    @sceneController.stop()
    @planeView.stop()

    @isStarted = false

  bindToEvents : ->

    @planeView.bindToEvents()

    @listenTo(@planeView, "render", @render)
    @listenTo(@planeView, "renderCam", @sceneController.updateSceneForCam)

    @listenTo(@sceneController, "newGeometries", (list) ->
      for geometry in list
        @planeView.addGeometry(geometry)
    )
    @listenTo(@sceneController, "removeGeometries", (list) ->
      for geometry in list
        @planeView.removeGeometry(geometry)
    )

    # TODO check for ControleMode rather the Object existence
    if @sceneController.skeleton
      @listenTo(@sceneController.skeleton, "newGeometries", (list) ->
        for geometry in list
          @planeView.addGeometry(geometry)
      )
      @listenTo(@sceneController.skeleton, "removeGeometries", (list) ->
        for geometry in list
          @planeView.removeGeometry(geometry)
      )


  render : ->

    for dataLayerName of @model.binary
      if (@sceneController.pingDataLayer(dataLayerName))
        @model.binary[dataLayerName].ping(@flycam.getPosition(), {
          zoomStep:     @flycam.getIntegerZoomStep()
          area:         @flycam.getAreas()
          activePlane:  @activeViewport
        })

    @cameraController.update()
    @sceneController.update()


  move : (v, increaseSpeedWithZoom = true) =>

    if @activeViewport in [0..2]
      @flycam.movePlane( v, @activeViewport, increaseSpeedWithZoom )
    else
      @moveTDView( {x : -v[0], y : -v[1]} )


  moveX : (x) => @move([x, 0, 0])

  moveY : (y) => @move([0, y, 0])

  moveZ : (z, oneSlide) =>

    if @activeViewport == constants.TDView
      return

    if oneSlide
      @flycam.move(
        Dimensions.transDim(
          [0, 0, (if z < 0 then -1 else 1) << @flycam.getIntegerZoomStep()],
          @activeViewport),
        @activeViewport)

    else
      @move([0, 0, z], false)


  zoom : (value, zoomToMouse) ->

    if @activeViewport in [0..2]
      @zoomPlanes(value, zoomToMouse)
    else
      @zoomTDView(value, zoomToMouse)


  zoomPlanes : (value, zoomToMouse) ->

    if zoomToMouse
      @zoomPos = @getMousePosition()

    @flycam.zoomByDelta( value )
    @model.user.set("zoom", @flycam.getPlaneScalingFactor())

    if zoomToMouse
      @finishZoom()


  zoomTDView : (value, zoomToMouse) ->

    if zoomToMouse
      zoomToPosition = @input.mouseControllers[constants.TDView].position

    @cameraController.zoomTDView(value, zoomToPosition, @planeView.curWidth)


  moveTDView : (delta) ->

    @cameraController.moveTDViewX(delta.x * @model.user.getMouseInversionX())
    @cameraController.moveTDViewY(delta.y * @model.user.getMouseInversionY())


  finishZoom : =>

    # Move the plane so that the mouse is at the same position as
    # before the zoom
    if @isMouseOver()
      mousePos = @getMousePosition()
      moveVector = [@zoomPos[0] - mousePos[0],
                    @zoomPos[1] - mousePos[1],
                    @zoomPos[2] - mousePos[2]]
      @flycam.move(moveVector, @activeViewport)

  getMousePosition : ->

    pos = @input.mouseControllers[@activeViewport].position
    return @calculateGlobalPos(pos)


  isMouseOver : ->

    return @input.mouseControllers[@activeViewport].isMouseOver


  changeMoveValue : (delta) ->

    moveValue = @model.user.get("moveValue") + delta
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue)
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue)

    @model.user.set("moveValue", (Number) moveValue)


  scaleTrianglesPlane : (delta) ->

    scale = @model.user.get("scale") + delta
    scale = Math.min(constants.MAX_SCALE, scale)
    scale = Math.max(constants.MIN_SCALE, scale)

    @model.user.set("scale", scale)


  scrollPlanes : (delta, type) =>

    switch type
      when null then @moveZ(delta, true)
      when "alt"
        @zoomPlanes(Utils.clamp(-1, delta, 1), true)


  calculateGlobalPos : (clickPos) =>

    curGlobalPos  = @flycam.getPosition()
    zoomFactor    = @flycam.getPlaneScalingFactor()
    scaleFactor   = @planeView.scaleFactor
    planeRatio    = app.scaleInfo.baseVoxelFactors
    position = switch @activeViewport
      when constants.PLANE_XY
        [ curGlobalPos[0] - (constants.VIEWPORT_WIDTH * scaleFactor / 2 - clickPos.x) / scaleFactor * planeRatio[0] * zoomFactor,
          curGlobalPos[1] - (constants.VIEWPORT_WIDTH * scaleFactor / 2 - clickPos.y) / scaleFactor * planeRatio[1] * zoomFactor,
          curGlobalPos[2] ]
      when constants.PLANE_YZ
         [ curGlobalPos[0],
          curGlobalPos[1] - (constants.VIEWPORT_WIDTH * scaleFactor / 2 - clickPos.y) / scaleFactor * planeRatio[1] * zoomFactor,
          curGlobalPos[2] - (constants.VIEWPORT_WIDTH * scaleFactor / 2 - clickPos.x) / scaleFactor * planeRatio[2] * zoomFactor ]
      when constants.PLANE_XZ
        [ curGlobalPos[0] - (constants.VIEWPORT_WIDTH * scaleFactor / 2 - clickPos.x) / scaleFactor * planeRatio[0] * zoomFactor,
          curGlobalPos[1],
          curGlobalPos[2] - (constants.VIEWPORT_WIDTH * scaleFactor / 2 - clickPos.y) / scaleFactor * planeRatio[2] * zoomFactor ]

module.exports = PlaneController
