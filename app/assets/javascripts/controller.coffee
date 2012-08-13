### define
model : Model
view : View
geometry_factory : GeometryFactory
input : Input
helper : Helper
libs/flycam2 : Flycam
###

PLANE_XY         : 0
PLANE_YZ         : 1
PLANE_XZ         : 2
VIEW_3D          : 3
WIDTH            : 384
TEXTURE_WIDTH    : 512


class Controller

  constructor : ->


    # create Model, View and Flycam
    @model = new Model()
    @view  = new View(@model)
    @flycam = new Flycam2D(WIDTH)

    # create Meshes and add to View
    @mainPlanes = new Array(3)
    for i in [PLANE_XY, PLANE_YZ, PLANE_XZ]
      @mainPlanes[i] = new Plane(WIDTH, TEXTURE_WIDTH, @flycam, i, @model)
      @mainPlanes[i].rotation.x = 90 /180*Math.PI
      @view.addGeometry(i, mainPlanes[i])
    @skeletonView = new SkeletonView(Game.dataset.upperBoundary, @flycam, @model, @mainPlanes)
    svMeshes      = @skeletonView.getMeshes()
    @view.addGeometry(VIEW_3D, svMeshes)

    # initialize Skeleton View Camera Controller
    @svCameraController = new SvCameraController(@view.getSvCamera, @flycam, Game.dataset.upperBoundary, @skeletonView)

    # FIXME probably not the best place?!
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      if event.which == 32 or 37 <= event.which <= 40 then event.preventDefault(); return

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault(); return

    @canvases = $("#render")[0]
  
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

        @view.setRouteClippingDistance data.routeClippingDistance
        @view.setDisplayCrosshair data.displayCrosshair
        @view.setDisplayPreview PLANE_XY, data.displayPreviewXY
        @view.setDisplayPreview PLANE_YZ, data.displayPreviewYZ
        @view.setDisplayPreview PLANE_XZ, data.displayPreviewXZ
    )

    @model.Route.initialize().then(
      (position) =>
        
        @view.setGlobalPos(position)
        #View.move([46, 36, -530])
        
        # set initial direction
        @view.setDirection([0, 0, 1])

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
      [@view.renderer[PLANE_XY].domElement, @view.renderer[PLANE_YZ].domElement, @view.renderer[PLANE_XZ].domElement, @view.renderer[VIEW_3D].domElement]
      [@view.setActivePlaneXY, @view.setActivePlaneYZ, @view.setActivePlaneXZ]
      {"x" : @view.moveX, "y" : @view.moveY, "w" : @view.moveZ, "r" : _.bind(@view.setWaypoint, @view)}
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
      "w" : => @view.moveActivePlane [0, -@model.User.Configuration.moveValue, 0]
      "s" : => @view.moveActivePlane [0, @model.User.Configuration.moveValue, 0]
      "a" : => @view.moveActivePlane [-@model.User.Configuration.moveValue, 0, 0]
      "d" : => @view.moveActivePlane [@model.User.Configuration.moveValue, 0, 0]
      "space" : => @view.moveActivePlane [0, 0, @model.User.Configuration.moveValue]
      "shift + space" : => @view.moveActivePlane [0, 0, -@model.User.Configuration.moveValue]

      #Rotate in distance
      "left"  : => @view.moveActivePlane [-@model.User.Configuration.moveValue, 0, 0]
      "right" : => @view.moveActivePlane [@model.User.Configuration.moveValue, 0, 0]
      "up"    : => @view.moveActivePlane [0, -@model.User.Configuration.moveValue, 0]
      "down"  : => @view.moveActivePlane [0, @model.User.Configuration.moveValue, 0]

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
  initGamepad : ->
    @input.gamepad = new Input.Gamepad(
        "ButtonA" : -> @view.move [0, 0, @model.User.Configuration.moveValue]
        "ButtonB" : -> @view.move [0, 0, -@model.User.Configuration.moveValue]
    )

  initMotionsensor : ->
    @input.deviceorientation = new Input.Deviceorientation(
    # TODO implement functionality
    #  "x"  : View.yawDistance
    #  "y" : View.pitchDistance
    )

  initDeviceOrientation : ->
    @input.deviceorientation = new Input.Deviceorientation(
    # TODO implement functionality
    #  "x"  : View.yawDistance
    #  "y" : View.pitchDistance
    )

  input :
    mouses : null
    mouseXY : null
    mouseXZ : null
    mouseYZ : null
    keyboard : null
    gamepad : null
    deviceorientation : null

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
