### define
jquery : $
underscore : _
./camera_controller : CameraController
../model/dimensions : Dimensions
libs/event_mixin : EventMixin
libs/input : Input
../view/plane_view : PlaneView
../constants : constants
libs/threejs/TrackballControls : TrackballControls
./celltracing_controller : CellTracingController
./volumetracing_controller : VolumeTracingController
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


  constructor : (@model, stats, @gui, renderer, scene, @sceneController) ->

    _.extend(@, new EventMixin())

    @isStarted = false

    @flycam = @model.flycam
    @flycam.setPosition(@model.route.data.editPosition)
    @flycam.setZoomStep(@model.user.zoom)
    @flycam.setQuality(@model.user.quality)

    @view  = new PlaneView(@model, @flycam, stats, renderer, scene)

    # initialize Camera Controller
    @cameraController = new CameraController(@view.getCameras(), @view.getLights(), @flycam, @model)

    @canvasesAndNav = $("#main")[0]

    @prevControls = $('#prevControls')
    @prevControls.addClass("btn-group")

    buttons = [
        name : "3D View"
        callback : @cameraController.changePrevSV
      ,
        name : "XY Plane"
        callback : @cameraController.changePrevXY
        color : "#f00"
      ,
        name : "YZ Plane"
        callback : @cameraController.changePrevYZ
        color : "#00f"
      ,
        name : "XZ Plane"
        callback : @cameraController.changePrevXZ
        color : "#0f0"
    ]

    for button in buttons

      button.control = @prevControls.append(
        $("<button>", type : "button", class : "btn btn-small")
          .html("#{if button.color then "<span style=\"background: #{button.color}\"></span>" else ""}#{button.name}")
          .on("click", button.callback)
      )    

    objects = { @model, @view, @sceneController, @cameraController, @move, @calculateGlobalPos }
    @cellTracingController = new CellTracingController( objects )
    @volumeTracingController = new VolumeTracingController( objects )

    meshes = @sceneController.getMeshes()
    
    for mesh in meshes
      @view.addGeometry(mesh)

    @flycam.setPosition(@model.route.data.editPosition)

    @model.user.triggerAll()

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault()
      return

    @initTrackballControls()
    @bind()


  initMouse : ->

    for planeId in ["xy", "yz", "xz"]
      @input.mouseControllers.push( new Input.Mouse($("#plane#{planeId}"),
        _.extend(@activeSubController.mouseControls,
          {
            over : @view["setActivePlane#{planeId.toUpperCase()}"]
            scroll : @scroll
          })))

    @input.mouseControllers.push( new Input.Mouse($("#skeletonview"),
      leftDownMove : (delta) => 
        @cameraController.movePrevX(delta.x * @model.user.getMouseInversionX())
        @cameraController.movePrevY(delta.y * @model.user.getMouseInversionY())
      scroll : (value) =>
        @cameraController.zoomPrev(value,
          @input.mouseControllers[constants.VIEW_3D].position,
          @view.curWidth)
      leftClick : (position, shiftPressed, altPressed) =>
        @cellTracingController.onClick(position, shiftPressed, altPressed, constants.VIEW_3D)
    ) )


  initTrackballControls : ->

    view = $("#skeletonview")[0]
    pos = @model.scaleInfo.voxelToNm(@flycam.getPosition())
    @controls = new THREE.TrackballControls(
      @view.getCameras()[constants.VIEW_3D],
      view, 
      new THREE.Vector3(pos...), 
      => @flycam.hasChanged = true )
    
    @controls.noZoom = true
    @controls.noPan = true

    @controls.target.set(
      @model.scaleInfo.voxelToNm(@flycam.getPosition())...)

    @flycam.on
      positionChanged : (position) =>
        @controls.setTarget(
          new THREE.Vector3(@model.scaleInfo.voxelToNm(position)...))

    @cameraController.on
      cameraPositionChanged : =>
        @controls.update()


  initKeyboard : ->
    
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      event.preventDefault() if (event.which == 32 or event.which == 18 or 37 <= event.which <= 40) and !$(":focus").length
      return

    @input.keyboard = new Input.Keyboard(

      #ScaleTrianglesPlane
      "l" : => @view.scaleTrianglesPlane(-@model.user.scaleValue)
      "k" : => @view.scaleTrianglesPlane( @model.user.scaleValue)

      #Move
      "left"  : => @moveX(-@model.user.moveValue)
      "right" : => @moveX( @model.user.moveValue)
      "up"    : => @moveY(-@model.user.moveValue)
      "down"  : => @moveY( @model.user.moveValue)

      #misc keys
      # TODO: what does this? I removed it, I need the key.
      #"n" : => Helper.toggle()
      #"ctr + s"       : => @model.route.pushImpl()
    )

    @input.keyboardLoopDelayed = new Input.Keyboard(

      #Move Z
      "space" : (first) => @moveZ( @model.user.moveValue, first)
      "f" : (first) => @moveZ( @model.user.moveValue, first)
      "d" : (first) => @moveZ( - @model.user.moveValue, first)
      "shift + f" : (first) => @moveZ( @model.user.moveValue * 5, first)
      "shift + d" : (first) => @moveZ( - @model.user.moveValue * 5, first)

      "shift + space" : (first) => @moveZ(-@model.user.moveValue, first)
      "ctrl + space" : (first) => @moveZ(-@model.user.moveValue, first)

    )

    @model.user.on({
      keyboardDelayChanged : (value) => @input.keyboardLoopDelayed.delay = value
      })
    
    @input.keyboardNoLoop = new Input.KeyboardNoLoop( 
      _.extend(@activeSubController.keyboardControls,
        {
          #Zoom in/out
          "i" : => @zoomIn(false)
          "o" : => @zoomOut(false)

          #Change move value
          "h" : => @changeMoveValue(0.1)
          "g" : => @changeMoveValue(-0.1)
        }))

  init : ->

    @cameraController.setRouteClippingDistance @model.user.routeClippingDistance
    @sceneController.setRouteClippingDistance @model.user.routeClippingDistance


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

    @model.binary.ping(@flycam.getPosition(), {zoomStep: @flycam.getIntegerZoomStep(), area: [@flycam.getArea(constants.PLANE_XY),
                        @flycam.getArea(constants.PLANE_YZ), @flycam.getArea(constants.PLANE_XZ)], activePlane: @flycam.getActivePlane()})
    @model.route.globalPosition = @flycam.getPosition()
    @cameraController.update()
    @sceneController.update()
    @model.route.rendered()

  move : (v) => @flycam.moveActivePlane(v)

  moveX : (x) => @move([x, 0, 0])
  moveY : (y) => @move([0, y, 0])
  moveZ : (z, first) =>
    if(first)
      activePlane = @flycam.getActivePlane()
      @flycam.move(Dimensions.transDim(
        [0, 0, (if z < 0 then -1 else 1) << @flycam.getIntegerZoomStep()],
        activePlane), activePlane)
    else
      @move([0, 0, z])

  zoomIn : (zoomToMouse) =>
    if zoomToMouse
      @zoomPos = @getMousePosition()
    @cameraController.zoomIn()
    if zoomToMouse
      @finishZoom()

  zoomOut : (zoomToMouse) =>
    if zoomToMouse
      @zoomPos = @getMousePosition()
    @cameraController.zoomOut()
    if zoomToMouse
      @finishZoom()

  finishZoom : =>
    
    # Move the plane so that the mouse is at the same position as
    # before the zoom
    if @isMouseOver()
      mousePos = @getMousePosition()
      moveVector = [@zoomPos[0] - mousePos[0],
                    @zoomPos[1] - mousePos[1],
                    @zoomPos[2] - mousePos[2]]
      @flycam.move(moveVector, @flycam.getActivePlane())

    @model.user.setValue("zoom", @flycam.getZoomStep())

  getMousePosition : ->
    activePlane = @flycam.getActivePlane()
    pos = @input.mouseControllers[activePlane].position
    return @calculateGlobalPos([pos.x, pos.y])

  isMouseOver : ->
    activePlane = @flycam.getActivePlane()
    return @input.mouseControllers[activePlane].isMouseOver

  changeMoveValue : (delta) ->
    moveValue = @model.user.moveValue + delta
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue)
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue)

    @gui.updateMoveValue(moveValue)

  scroll : (delta, type) =>
    switch type
      when null then @moveZ(delta)
      when "shift" then @cellTracingController.setParticleSize(delta)
      when "alt"
        if delta > 0
          @zoomIn(true)
        else
          @zoomOut(true)

  calculateGlobalPos : (clickPos) =>
    curGlobalPos  = @flycam.getPosition()
    zoomFactor    = @flycam.getPlaneScalingFactor()
    scaleFactor   = @view.scaleFactor
    planeRatio    = @model.scaleInfo.baseVoxelFactors
    position = switch @flycam.getActivePlane()
      when constants.PLANE_XY 
        [ curGlobalPos[0] - (constants.WIDTH * scaleFactor / 2 - clickPos[0]) / scaleFactor * planeRatio[0] * zoomFactor, 
          curGlobalPos[1] - (constants.WIDTH * scaleFactor / 2 - clickPos[1]) / scaleFactor * planeRatio[1] * zoomFactor, 
          curGlobalPos[2] ]
      when constants.PLANE_YZ 
        [ curGlobalPos[0], 
          curGlobalPos[1] - (constants.WIDTH * scaleFactor / 2 - clickPos[1]) / scaleFactor * planeRatio[1] * zoomFactor, 
          curGlobalPos[2] - (constants.WIDTH * scaleFactor / 2 - clickPos[0]) / scaleFactor * planeRatio[2] * zoomFactor ]
      when constants.PLANE_XZ 
        [ curGlobalPos[0] - (constants.WIDTH * scaleFactor / 2 - clickPos[0]) / scaleFactor * planeRatio[0] * zoomFactor, 
          curGlobalPos[1], 
          curGlobalPos[2] - (constants.WIDTH * scaleFactor / 2 - clickPos[1]) / scaleFactor * planeRatio[2] * zoomFactor ]