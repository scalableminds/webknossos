### define
jquery : $
underscore : _
libs/event_mixin : EventMixin
libs/input : Input
three.trackball : Trackball
../camera_controller : CameraController
../../model/dimensions : Dimensions
../../view/plane_view : PlaneView
../../constants : constants
../annotations/skeletontracing_controller : SkeletonTracingController
../annotations/volumetracing_controller : VolumeTracingController
three : THREE
###

class PlaneController

  # See comment in Controller class on general controller architecture.
  #
  # Plane Controller: Responsible for Plane Modes


  bindings : []
  model : null
  view : null
  gui : null

  input :
    mouseControllers : []
    keyboard : null
    keyboardNoLoop : null
    keyboardLoopDelayed : null

    unbind : ->

      for mouse in @mouseControllers
        mouse.unbind()
      @mouseControllers = []
      @keyboard?.unbind()
      @keyboardNoLoop?.unbind()
      @keyboardLoopDelayed?.unbind()


  constructor : (@model, stats, @gui, @view, @sceneController) ->

    _.extend(@, new EventMixin())

    @isStarted = false

    @flycam = @model.flycam

    @oldNmPos = @model.scaleInfo.voxelToNm( @flycam.getPosition() )

    @planeView = new PlaneView(@model, @flycam, @view, stats)

    @activeViewport = constants.PLANE_XY

    # initialize Camera Controller
    @cameraController = new CameraController(@planeView.getCameras(), @flycam, @model)

    @canvasesAndNav = $("#main")[0]

    @TDViewControls = $('#TDViewControls')
    @TDViewControls.addClass("btn-group")

    @gui.on
      newBoundingBox : (bb) => @sceneController.setBoundingBox(bb)

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

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return

    @initTrackballControls()
    @bind()


  initMouse : ->

    for planeId in [0..2]
      do (planeId) =>
        inputcatcher = $("#plane#{constants.PLANE_NAMES[planeId]}")
        @input.mouseControllers.push(
          new Input.Mouse( inputcatcher, @getPlaneMouseControls(planeId), planeId ))

    @input.mouseControllers.push(
      new Input.Mouse($("#TDView"), @getTDViewMouseControls(), constants.TDView ))


  getTDViewMouseControls : ->

    return {
      leftDownMove : (delta) => @moveTDView(delta)
      scroll : (value) => @zoomTDView(value, true)
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
    pos = @model.scaleInfo.voxelToNm(@flycam.getPosition())
    @controls = new THREE.TrackballControls(
      @planeView.getCameras()[constants.TDView],
      view,
      new THREE.Vector3(pos...),
      => @flycam.update())

    @controls.noZoom = true
    @controls.noPan = true
    @controls.staticMoving = true

    @controls.target.set(
      @model.scaleInfo.voxelToNm(@flycam.getPosition())...)

    @flycam.on
      positionChanged : (position) =>

        nmPosition = @model.scaleInfo.voxelToNm(position)

        @controls.target.set( nmPosition... )
        @controls.update()

        # As the previous step will also move the camera, we need to
        # fix this by offsetting the viewport

        invertedDiff = []
        for i in [0..2]
          invertedDiff.push( @oldNmPos[i] - nmPosition[i] )
        @oldNmPos = nmPosition

        @cameraController.moveTDView(
                new THREE.Vector3( invertedDiff... ))

    @cameraController.on
      cameraPositionChanged : =>
        @controls.update()


  initKeyboard : ->

    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    getMoveValue  = (timeFactor) =>
      if @activeViewport in [0..2]
        return @model.user.get("moveValue") * timeFactor / @model.scaleInfo.baseVoxel / constants.FPS
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

      "space"         : (timeFactor, first) => @moveZ( getMoveValue(timeFactor)    , first)
      "f"             : (timeFactor, first) => @moveZ( getMoveValue(timeFactor)    , first)
      "d"             : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor)    , first)
      "shift + f"     : (timeFactor, first) => @moveZ( getMoveValue(timeFactor) * 5, first)
      "shift + d"     : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor) * 5, first)

      "shift + space" : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor)    , first)
      "ctrl + space"  : (timeFactor, first) => @moveZ(-getMoveValue(timeFactor)    , first)

    , @model.user.get("keyboardDelay")
    )

    @model.user.on({
      keyboardDelayChanged : (value) => @input.keyboardLoopDelayed.delay = value
      })

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

    @cameraController.setClippingDistance @model.user.get("clippingDistance")
    @sceneController.setClippingDistance @model.user.get("clippingDistance")


  start : (newMode) ->

    @stop()

    @initKeyboard()
    @init()
    @initMouse()
    @sceneController.start()
    @planeView.start()

    @isStarted = true


  stop : ->

    if @isStarted
      @input.unbind()
      @planeView.stop()
      @sceneController.stop()

    @isStarted = false

  bind : ->

    @planeView.bind()

    @planeView.on
      render : => @render()
      renderCam : (id, event) => @sceneController.updateSceneForCam(id)

    @sceneController.on
      newGeometries : (list, event) =>
        for geometry in list
          @planeView.addGeometry(geometry)
      removeGeometries : (list, event) =>
        for geometry in list
          @planeView.removeGeometry(geometry)
    @sceneController.skeleton?.on
      newGeometries : (list, event) =>
        for geometry in list
          @planeView.addGeometry(geometry)
      removeGeometries : (list, event) =>
        for geometry in list
          @planeView.removeGeometry(geometry)


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

    @model.user.set("scale", (Number) scale)


  scrollPlanes : (delta, type) =>

    switch type
      when null then @moveZ(delta, true)
      when "alt"
        @zoomPlanes(delta, true)


  calculateGlobalPos : (clickPos) =>

    curGlobalPos  = @flycam.getPosition()
    zoomFactor    = @flycam.getPlaneScalingFactor()
    scaleFactor   = @planeView.scaleFactor
    planeRatio    = @model.scaleInfo.baseVoxelFactors
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
