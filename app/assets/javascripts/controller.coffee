### define
model : Model
view : View
geometry_factory : GeometryFactory
libs/event_mixin : EventMixin
input : Input
helper : Helper
libs/flycam2 : Flycam
geometries/plane : Plane
controller/cameracontroller : CameraController
controller/scenecontroller : SceneController
###

PLANE_XY         = 0
PLANE_YZ         = 1
PLANE_XZ         = 2
VIEW_3D          = 3
WIDTH            = 380
TEXTURE_WIDTH    = 512


class Controller

  constructor : ->

    _.extend(this, new EventMixin())

    # create Model, View and Flycam
    @model = new Model()
    @flycam = new Flycam(WIDTH)
    @view  = new View(@model, @flycam)

    @sceneController = new SceneController([2000, 2000, 2000], @flycam, @model, @mainPlanes)
    meshes      = @sceneController.getMeshes()
    for mesh in meshes
      @view.addGeometry(VIEW_3D, mesh)

    # initialize Camera Controller
    @cameraController = new CameraController(@view.getCameras(), @flycam, [2000, 2000, 2000], @sceneController)
    
    @view.on "render", (event) => @render()
    @view.on "renderCam", (id, event) => @sceneController.updateSceneForCam(id)

    # FIXME probably not the best place?!
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      if event.which == 32 or 37 <= event.which <= 40 then event.preventDefault(); return

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault(); return

    @canvases = $("#render")[0]

    @prevControls = $('#prevControls')
    values        = ["XY Plane", "YZ Plane", "XZ Plane", "3D View"]
    callbacks     = [@cameraController.changePrevXY, @cameraController.changePrevYZ,
                      @cameraController.changePrevXZ, @cameraController.changePrevSV]
    buttons       = new Array(4)
    for i in [VIEW_3D, PLANE_XY, PLANE_YZ, PLANE_XZ]
      buttons[i] = document.createElement "input"
      buttons[i].setAttribute "type", "button"
      buttons[i].setAttribute "value", values[i]
      buttons[i].addEventListener "click", callbacks[i], true
      @prevControls.append buttons[i]
  
    @model.User.Configuration.initialize().then(
      (data) =>
        @initMouse() if data.mouseActive is true
        @initKeyboard() if data.keyboardActive is true
        @initGamepad() if data.gamepadActive is true
        @initMotionsensor() if data.motionsensorActive is true
          
        $("#moveValue")[0].value = data.moveValue
        $("#rotateValue")[0].value = data.rotateValue
        $("#mouseRotateValue")[0].value = data.mouseRotateValue
        $("#routeClippingDistance")[0].value = data.routeClippingDistance
        $("#lockZoom")[0].checked = data.lockZoom
        $("#displayCrosshair")[0].checked = data.displayCrosshair
        $("#displayPreviewXY")[0].checked = data.displayPreviewXY
        $("#displayPreviewYZ")[0].checked = data.displayPreviewYZ
        $("#displayPreviewXZ")[0].checked = data.displayPreviewXZ
        $("#moveValue")[0].value = data.moveValue
        $("#mouseInversionX")[0].checked = true if data.mouseInversionX is 1
        $("#mouseInversionY")[0].checked = true if data.mouseInversionY is 1
        $("#mouseInversionX")[0].checked = false if data.mouseInversionX is -1
        $("#mouseInversionY")[0].checked = false if data.mouseInversionY is -1        
        $("#keyboardActive")[0].checked = data.keyboardActive
        $("#mouseActive")[0].checked = data.mouseActive
        $("#gamepadActive")[0].checked = data.gamepadActive
        $("#motionsensorActive")[0].checked = data.motionsensorActive

        #@view.setRouteClippingDistance data.routeClippingDistance
        #@view.setDisplayCrosshair data.displayCrosshair
        #@view.setDisplayPreview PLANE_XY, data.displayPreviewXY
        #@view.setDisplayPreview PLANE_YZ, data.displayPreviewYZ
        #@view.setDisplayPreview PLANE_XZ, data.displayPreviewXZ
    )

    @model.Route.initialize().then(
      (position) =>
        
        @flycam.setGlobalPos(position)
        #View.move([46, 36, -530])
        
        # set initial direction
        #@view.setDirection([0, 0, 1])

        #GeometryFactory.createMesh("crosshair.js", 0, 0, 5)
        #GeometryFactory.createTrianglesplane(512, 0, @model.User.Configuration, @view).done =>
        #  @view.draw()
      
      ->
        alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
    )

  initMouse : ->
    # initializes an Input.Mouse object with the three canvas
    # elements and one pair of callbacks per canvas
    @input.mouses = new Input.Mouse(
      [$("#planexy"), $("#planeyz"), $("#planexz"), $("#skeletonview")]
      [@view.setActivePlaneXY, @view.setActivePlaneYZ, @view.setActivePlaneXZ]
      {"x" : @moveX, "y" : @moveY, "w" : @moveZ, "r" : _.bind(@view.setWaypoint, @view)}
      {"x" : @view.movePrevX, "y" : @view.movePrevY, "w" : @view.zoomPrev, "r" : _.bind(@view.onPreviewClick, @view)}
    )

  initKeyboard : ->
    
    @input.keyboard = new Input.Keyboard(

      #Fullscreen Mode
      "f" : => 
        canvases = @canvases
        requestFullscreen = canvases.webkitRequestFullScreen or canvases.mozRequestFullScreen or canvases.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvases, canvases.ALLOW_KEYBOARD_INPUT)

    
      #ScaleTrianglesPlane
      "l" : => @view.scaleTrianglesPlane -@model.User.Configuration.scaleValue
      "k" : => @view.scaleTrianglesPlane @model.User.Configuration.scaleValue

      #Move
      "w"             : => @moveY(-@model.User.Configuration.moveValue)
      "s"             : => @moveY( @model.User.Configuration.moveValue)
      "a"             : => @moveX(-@model.User.Configuration.moveValue)
      "d"             : => @moveX( @model.User.Configuration.moveValue)
      "space"         : => @moveZ( @model.User.Configuration.moveValue)
      "shift + space" : => @moveZ(-@model.User.Configuration.moveValue)

      #Rotate in distance
      "left"          : => @moveX(-@model.User.Configuration.moveValue)
      "right"         : => @moveX( @model.User.Configuration.moveValue)
      "up"            : => @moveY(-@model.User.Configuration.moveValue)
      "down"          : => @moveY( @model.User.Configuration.moveValue)

      #misc keys
      "n" : => Helper.toggle()
    )
    
    new Input.KeyboardNoLoop(
      #Branches
      "b" : => 
        @model.Route.putBranch(@view.getGlobalPos())
        @view.setWaypoint(@view.getGlobalPos(), 1)
      "h" : => @model.Route.popBranch().done(
        (position) -> 
          @view.setGlobalPos(position)
          @view.setActiveNodePosition(position)
        )

      #Zoom in/out
      "o" : => @view.zoomIn()
      "p" : => @view.zoomOut()
    )

  # for more buttons look at Input.Gamepad
  #initGamepad : ->
  #  @input.gamepad = new Input.Gamepad(
  #      "ButtonA" : -> @view.move [0, 0, @model.User.Configuration.moveValue]
  #      "ButtonB" : -> @view.move [0, 0, -@model.User.Configuration.moveValue]
  #  )

  #initMotionsensor : ->
  #  @input.deviceorientation = new Input.Deviceorientation(
    # TODO implement functionality
    #  "x"  : View.yawDistance
    #  "y" : View.pitchDistance
   # )

  #initDeviceOrientation : ->
  #  @input.deviceorientation = new Input.Deviceorientation(
    # TODO implement functionality
    #  "x"  : View.yawDistance
    #  "y" : View.pitchDistance
  #  )

  input :
    mouses : null
    mouseXY : null
    mouseXZ : null
    mouseYZ : null
    keyboard : null
    gamepad : null
    deviceorientation : null

  render : ->
    @model.Binary.ping(@flycam.getGlobalPos(), @flycam.getIntegerZoomSteps())
    @cameraController.update()
    @sceneController.update()

  move  : (v) =>                 # v: Vector represented as array of length 3
    @flycam.moveActivePlane(v)

  moveX : (x) => @move([x, 0, 0])
  moveY : (y) => @move([0, y, 0])
  moveZ : (z) => @move([0, 0, z])

  #Customize Options
  setMoveValue : (value) =>
    @model.User.Configuration.moveValue = (Number) value

    @model.User.Configuration.push()

  setRotateValue : (value) =>
    @model.User.Configuration.rotateValue = (Number) value 
    @model.User.Configuration.push()   

  setScaleValue : (value) =>
    @model.User.Configuration.scaleValue = (Number) value  
    @model.User.Configuration.push()         

  setMouseRotateValue : (value) =>
    @model.User.Configuration.mouseRotateValue = (Number) value
    @model.User.Configuration.push()      

  setRouteClippingDistance : (value) =>
    console.log "setRouteClippingDistance()"
    @model.User.Configuration.routeClippingDistance = (Number) value
    @view.setRouteClippingDistance((Number) value)
    @model.User.Configuration.push()   

  setLockZoom : (value) =>
    @model.User.Configuration.lockZoom = value
    @model.User.Configuration.push()      

  setDisplayCrosshair : (value) =>
    @model.User.Configuration.displayCrosshair = value
    @view.setDisplayCrosshair value
    @model.User.Configuration.push()    

  setDisplayPreviewXY : (value) =>
    @model.User.Configuration.displayPreviewXY = value
    @view.setDisplayPreview PLANE_XY, value
    @model.User.Configuration.push()      

  setDisplayPreviewYZ : (value) =>
    @model.User.Configuration.displayPreviewYZ = value
    @view.setDisplayPreview PLANE_YZ, value
    @model.User.Configuration.push()      

  setDisplayPreviewXZ : (value) =>
    @model.User.Configuration.displayPreviewXZ = value
    @view.setDisplayPreview PLANE_XZ, value
    @model.User.Configuration.push()      

  setMouseInversionX : (value) =>
    if value is true
      @model.User.Configuration.mouseInversionX = 1
    else
      @model.User.Configuration.mouseInversionX = -1
    @model.User.Configuration.push()         

  setMouseInversionY : (value) =>
    if value is true
      @model.User.Configuration.mouseInversionY = 1
    else
      @model.User.Configuration.mouseInversionY = -1
    @model.User.Configuration.push()         

  setMouseActivity : (value) =>
    @model.User.Configuration.mouseActive = value
    @model.User.Configuration.push()
    if value is false
      @input.mouse.unbind()
      @input.mouse = null
    else
      @initMouse()

  setKeyboardActivity : (value) =>
    @model.User.Configuration.keyboardActive = value 
    @model.User.Configuration.push()
    if value is false
      @input.keyboard.unbind()
      @input.keyboard = null
    else
      @initKeyboard()

  setGamepadActivity : (value) =>
    @model.User.Configuration.gamepadActive = value  
    @model.User.Configuration.push()   
    if value is false
      @input.gamepad.unbind()
      @input.gamepad = null
    else
      @initGamepad()    

  setMotionSensorActivity : (value) =>
    @model.User.Configuration.motionsensorActive = value
    @model.User.Configuration.push()   
    if value is false
      @input.deviceorientation.unbind()
      @input.deviceorientation = null
    else
      @initMotionsensor()
