### define
model : Model
view : View
geometry_factory : GeometryFactory
input : Input
helper : Helper
###

PLANE_XY = 0
PLANE_YZ = 1
PLANE_XZ = 2
VIEW_3D  = 3


Controller = 

  initialize : (@canvases) ->

    # FIXME probably not the best place?!
    # avoid scrolling while pressing space
    $(document).keydown (event) ->
      if event.which == 32 or 37 <= event.which <= 40 then event.preventDefault(); return

    # hide contextmenu, while rightclicking a canvas
    $("#render").bind "contextmenu", (event) ->
      event.preventDefault(); return
  
    Model.User.Configuration.initialize().then(
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

        View.setRouteClippingDistance data.routeClippingDistance
        View.setDisplayCrosshair data.displayCrosshair
        View.setDisplayPreview PLANE_XY, data.displayPreviewXY
        View.setDisplayPreview PLANE_YZ, data.displayPreviewYZ
        View.setDisplayPreview PLANE_XZ, data.displayPreviewXZ
    )

    Model.Route.initialize().then(
      (position) =>
        
        View.setGlobalPos(position)
        #View.move([46, 36, -530])
        
        # set initial direction
        View.setDirection([0, 0, 1])

        GeometryFactory.createMesh("crosshair.js", 0, 0, 5)
        GeometryFactory.createTrianglesplane(512, 0).done ->
          View.draw()
      
      ->
        alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
    )

  initMouse : ->
    # initializes an Input.Mouse object with the three canvas
    # elements and one pair of callbacks per canvas
    @input.mouses = new Input.Mouse(
      [View.renderer[PLANE_XY].domElement, View.renderer[PLANE_YZ].domElement, View.renderer[PLANE_XZ].domElement, View.renderer[VIEW_3D].domElement]
      [View.setActivePlaneXY, View.setActivePlaneYZ, View.setActivePlaneXZ]
      {"x" : View.moveX, "y" : View.moveY, "w" : View.moveZ, "r" : _.bind(View.setWaypoint, View)}
      {"x" : View.movePrevX, "y" : View.movePrevY, "w" : View.zoomPrev, "r" : _.bind(View.onPreviewClick, View), "m" : _.bind(View.showNodeID, View)}
    )
      ##{"x" : View.movePrevX, "y" : View.movePrevY, "w" : View.zoomPrev, "r" : _.bind(View.onPreviewClick, View), "m" : _.bind(View.showNodeID, View)}
    #)

  initKeyboard : ->
    
    @input.keyboard = new Input.Keyboard(

      #Fullscreen Mode
      "f" : => 
        canvases = @canvases
        requestFullscreen = canvases.webkitRequestFullScreen or canvases.mozRequestFullScreen or canvases.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvases, canvases.ALLOW_KEYBOARD_INPUT)

    
      #ScaleTrianglesPlane
      "l" : -> View.scaleTrianglesPlane -Model.User.Configuration.scaleValue
      "k" : -> View.scaleTrianglesPlane Model.User.Configuration.scaleValue

      #Move
      "w" : -> View.moveActivePlane [0, -Model.User.Configuration.moveValue, 0]
      "s" : -> View.moveActivePlane [0, Model.User.Configuration.moveValue, 0]
      "a" : -> View.moveActivePlane [-Model.User.Configuration.moveValue, 0, 0]
      "d" : -> View.moveActivePlane [Model.User.Configuration.moveValue, 0, 0]
      "space" : -> View.moveActivePlane [0, 0, Model.User.Configuration.moveValue]
      "shift + space" : -> View.moveActivePlane [0, 0, -Model.User.Configuration.moveValue]

      #Rotate in distance
      "left"  : -> View.moveActivePlane [-Model.User.Configuration.moveValue, 0, 0]
      "right" : -> View.moveActivePlane [Model.User.Configuration.moveValue, 0, 0]
      "up"    : -> View.moveActivePlane [0, -Model.User.Configuration.moveValue, 0]
      "down"  : -> View.moveActivePlane [0, Model.User.Configuration.moveValue, 0]

      #misc keys
      "n" : -> Helper.toggle()
    )
    
    new Input.KeyboardNoLoop(
      #Branches
      "b" : -> 
        Model.Route.putBranch(View.getGlobalPos())
        View.setWaypoint(View.getGlobalPos(), 1)
      "h" : -> Model.Route.popBranch().done(
        (position) -> 
          View.setGlobalPos(position)
          View.setActiveNodePosition(position)
        )

      #Zoom in/out
      "o" : -> View.zoomIn()
      "p" : -> View.zoomOut()
    )

  # for more buttons look at Input.Gamepad
  initGamepad : ->
    @input.gamepad = new Input.Gamepad(
        "ButtonA" : -> View.move [0, 0, Model.User.Configuration.moveValue]
        "ButtonB" : -> View.move [0, 0, -Model.User.Configuration.moveValue]
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
  setMoveValue : (value) ->
    Model.User.Configuration.moveValue = (Number) value

    Model.User.Configuration.push()

  setRotateValue : (value) ->
    Model.User.Configuration.rotateValue = (Number) value 
    Model.User.Configuration.push()   

  setScaleValue : (value) ->
    Model.User.Configuration.scaleValue = (Number) value  
    Model.User.Configuration.push()         

  setMouseRotateValue : (value) ->
    Model.User.Configuration.mouseRotateValue = (Number) value
    Model.User.Configuration.push()      

  setRouteClippingDistance : (value) ->
    console.log "setRouteClippingDistance()"
    Model.User.Configuration.routeClippingDistance = (Number) value
    View.setRouteClippingDistance((Number) value)
    Model.User.Configuration.push()   

  setLockZoom : (value) ->
    Model.User.Configuration.lockZoom = value
    Model.User.Configuration.push()      

  setDisplayCrosshair : (value) ->
    Model.User.Configuration.displayCrosshair = value
    View.setDisplayCrosshair value
    Model.User.Configuration.push()    

  setDisplayPreviewXY : (value) ->
    Model.User.Configuration.displayPreviewXY = value
    View.setDisplayPreview PLANE_XY, value
    Model.User.Configuration.push()      

  setDisplayPreviewYZ : (value) ->
    Model.User.Configuration.displayPreviewYZ = value
    View.setDisplayPreview PLANE_YZ, value
    Model.User.Configuration.push()      

  setDisplayPreviewXZ : (value) ->
    Model.User.Configuration.displayPreviewXZ = value
    View.setDisplayPreview PLANE_XZ, value
    Model.User.Configuration.push()      

  setMouseInversionX : (value) ->
    if value is true
      Model.User.Configuration.mouseInversionX = 1
    else
      Model.User.Configuration.mouseInversionX = -1
    Model.User.Configuration.push()         

  setMouseInversionY : (value) ->
    if value is true
      Model.User.Configuration.mouseInversionY = 1
    else
      Model.User.Configuration.mouseInversionY = -1
    Model.User.Configuration.push()         

  setMouseActivity : (value) ->
    Model.User.Configuration.mouseActive = value
    Model.User.Configuration.push()
    if value is false
      @input.mouse.unbind()
      @input.mouse = null
    else
      @initMouse()

  setKeyboardActivity : (value) ->
    Model.User.Configuration.keyboardActive = value 
    Model.User.Configuration.push()
    if value is false
      @input.keyboard.unbind()
      @input.keyboard = null
    else
      @initKeyboard()

  setGamepadActivity : (value) ->
    Model.User.Configuration.gamepadActive = value  
    Model.User.Configuration.push()   
    if value is false
      @input.gamepad.unbind()
      @input.gamepad = null
    else
      @initGamepad()    

  setMotionSensorActivity : (value) ->
    Model.User.Configuration.motionsensorActive = value
    Model.User.Configuration.push()   
    if value is false
      @input.deviceorientation.unbind()
      @input.deviceorientation = null
    else
      @initMotionsensor()
