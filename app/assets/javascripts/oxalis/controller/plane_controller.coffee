### define
jquery : $
underscore : _
libs/event_mixin : EventMixin
libs/input : Input
three.trackball : Trackball
./camera_controller : CameraController
../model/dimensions : Dimensions
../view/plane_view : PlaneView
../constants : constants
./celltracing_controller : CellTracingController
./volumetracing_controller : VolumeTracingController
three : THREE
###

class PlaneController

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


  constructor : (@model, stats, @gui, renderer, scene, @sceneController, @controlMode) ->

    _.extend(@, new EventMixin())

    @isStarted = false

    @flycam = @model.flycam

    @oldNmPos = @model.scaleInfo.voxelToNm( @flycam.getPosition() )

    @view  = new PlaneView(@model, @flycam, stats, renderer, scene)

    @activeViewport = constants.PLANE_XY

    # initialize Camera Controller
    @cameraController = new CameraController(@view.getCameras(), @flycam, @model)

    @canvasesAndNav = $("#main")[0]

    @TDViewControls = $('#TDViewControls')
    @TDViewControls.addClass("btn-group")

    buttons = [
        name : "3D"
        callback : @cameraController.changeTDViewDiagonal
      ,
        name : "XY"
        callback : @cameraController.changeTDViewXY
        color : "#f00"
      ,
        name : "YZ"
        callback : @cameraController.changeTDViewYZ
        color : "#00f"
      ,
        name : "XZ"
        callback : @cameraController.changeTDViewXZ
        color : "#0f0"
    ]

    for button in buttons

      button.control = @TDViewControls.append(
        $("<button>", type : "button", class : "btn btn-small")
          .html("#{if button.color then "<span style=\"background: #{button.color}\"></span>" else ""}#{button.name}")
          .on("click", button.callback)
      )

    objects = { @model, @view, @sceneController, @cameraController, @move, @calculateGlobalPos, planeController : this }
    @cellTracingController = new CellTracingController( objects, @controlMode )
    @volumeTracingController = new VolumeTracingController( objects )

    meshes = @sceneController.getMeshes()

    for mesh in meshes
      @view.addGeometry(mesh)

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
        @input.mouseControllers.push( new Input.Mouse( inputcatcher,
          _.extend(@activeSubController.mouseControls,
            {
              over : => @view.setActiveViewport( @activeViewport = planeId )
              scroll : @scrollPlanes
            }), planeId))

    @input.mouseControllers.push( new Input.Mouse($("#TDView"),
      leftDownMove : (delta) => @moveTDView(delta)
      scroll : (value) => @zoomTDView(value, true)
      leftClick : (position, plane, event) =>
        @cellTracingController.onClick(position, event.shiftKey, event.altKey, constants.TDView)
      over : => @view.setActiveViewport( @activeViewport = constants.TDView ),
    constants.TDView
    ) )


  initTrackballControls : ->

    view = $("#TDView")[0]
    pos = @model.scaleInfo.voxelToNm(@flycam.getPosition())
    @controls = new THREE.TrackballControls(
      @view.getCameras()[constants.TDView],
      view,
      new THREE.Vector3(pos...),
      => @flycam.update())

    @controls.noZoom = true
    @controls.noPan = true

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

    @input.keyboardNoLoop = new Input.KeyboardNoLoop(
      _.extend(@activeSubController.keyboardControls,
        {
          #Zoom in/out
          "i" : => @zoom( 1, false)
          "o" : => @zoom(-1, false)

          #Change move value
          "h" : => @changeMoveValue(25)
          "g" : => @changeMoveValue(-25)
        }))

  init : ->

    @cameraController.setClippingDistance @model.user.get("clippingDistance")
    @sceneController.setClippingDistance @model.user.get("clippingDistance")


  start : (newMode) ->

    @stop()

    if newMode == constants.MODE_PLANE_TRACING
      @activeSubController = @cellTracingController
    else if newMode == constants.MODE_VOLUME
      @activeSubController = @volumeTracingController

    @initKeyboard()
    @init()
    @initMouse()
    @sceneController.start()
    @view.start()

    @isStarted = true


  stop : ->

    if @isStarted
      @input.unbind()
      @view.stop()
      @sceneController.stop()

    @isStarted = false

  bind : ->

    @view.bind()

    @view.on
      render : => @render()
      finishedRender : => @model.cellTracing.rendered()
      renderCam : (id, event) => @sceneController.updateSceneForCam(id)

    @sceneController.on
      newGeometries : (list, event) =>
        for geometry in list
          @view.addGeometry(geometry)
      removeGeometries : (list, event) =>
        for geometry in list
          @view.removeGeometry(geometry)
    @sceneController.skeleton.on
      newGeometries : (list, event) =>
        for geometry in list
          @view.addGeometry(geometry)
      removeGeometries : (list, event) =>
        for geometry in list
          @view.removeGeometry(geometry)


  render : ->

    @model.logConnectionInfo()

    for dataLayerName of @model.binary
      if (@sceneController.pingDataLayer(dataLayerName))
        @model.binary[dataLayerName].ping(@flycam.getPosition(), {
          zoomStep:     @flycam.getIntegerZoomStep()
          area:         @flycam.getAreas()
          activePlane:  @activeViewport
        })

    @model.cellTracing.globalPosition = @flycam.getPosition()
    @cameraController.update()
    @sceneController.update()


  move : (v, increaseSpeedWithZoom = true) =>

    if @activeViewport in [0..2]
      @flycam.movePlane( v, @activeViewport, increaseSpeedWithZoom )
    else
      @moveTDView( {x : -v[0], y : -v[1]} )


  moveX : (x) => @move([x, 0, 0])

  moveY : (y) => @move([0, y, 0])

  moveZ : (z, first) =>

    if @activeViewport == constants.TDView
      return

    if(first)
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

    @cameraController.zoomTDView(value, zoomToPosition, @view.curWidth)


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
      when null then @moveZ(delta)
      #when "shift" then @cellTracingController.setParticleSize(delta)
      when "shift" then @cellTracingController.setRadius(delta)
      when "alt"
        @zoomPlanes(delta, true)


  calculateGlobalPos : (clickPos) =>

    curGlobalPos  = @flycam.getPosition()
    zoomFactor    = @flycam.getPlaneScalingFactor()
    scaleFactor   = @view.scaleFactor
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


  centerActiveNode : ->

    @activeSubController.centerActiveNode()

