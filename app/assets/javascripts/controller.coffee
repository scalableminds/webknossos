### define
model : Model
view : View
geometry_factory : GeometryFactory
input : Input
helper : Helper
###


Controller = 

  initialize : (@canvases) ->
  
    Model.User.Configuration.initialize().then(
      (data) =>
        @initMouse() if data.mouseActive is true
        @initKeyboard() if data.keyboardActive is true
        @initGamepad() if data.gamepadActive is true
        @initMotionsensor() if data.motionsensorActive is true
          
        $("#moveValue")[0].value = data.moveValue
        $("#rotateValue")[0].value = data.rotateValue
        $("#mouseRotateValue")[0].value = data.mouseRotateValue
        $("#moveValue")[0].value = data.moveValue

        $("#mouseInversionX")[0].checked = true if data.mouseInversionX is 1
        $("#mouseInversionY")[0].checked = true if data.mouseInversionY is 1
        $("#mouseInversionX")[0].checked = false if data.mouseInversionX is -1
        $("#mouseInversionY")[0].checked = false if data.mouseInversionY is -1        
        $("#keyboardActive")[0].checked = data.keyboardActive
        $("#mouseActive")[0].checked = data.mouseActive
        $("#gamepadActive")[0].checked = data.gamepadActive
        $("#motionsensorActive")[0].checked = data.motionsensorActive
    )

    Model.Route.initialize().then(
      (matrix) =>
          
        View.setMatrix(matrix)
        #View.setGlobalPos(2046, 1036, 471)       #So Georg will see data...
        View.move([46, 36, -530])
        # set initial direction
        View.setDirection([0, 0, 1])

        GeometryFactory.createMesh("crosshair.js", 0, 0, 5)
        GeometryFactory.createTrianglesplane(128, 0).done ->
          View.draw()
      
      ->
        alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
    )

  initMouse : ->
    # initializes an Input.Mouse object with the three canvas
    # elements and one pair of callbacks per canvas
    @input.mouses = new Input.Mouse(
      View.rendererxy.domElement
      View.rendereryz.domElement
      View.rendererxz.domElement
      {"x" : View.moveX, "y" : View.moveY}
      {"x" : View.moveZ, "y" : View.moveY}
      {"x" : View.moveX, "y" : View.moveZ}
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
      "l" : -> View.scaleTrianglesPlane -Model.User.Configuration.scaleValue
      "k" : -> View.scaleTrianglesPlane Model.User.Configuration.scaleValue

      #Move
      "w" : -> View.move [0, Model.User.Configuration.moveValue, 0]
      "s" : -> View.move [0, -Model.User.Configuration.moveValue, 0]
      "a" : -> View.move [Model.User.Configuration.moveValue, 0, 0]
      "d" : -> View.move [-Model.User.Configuration.moveValue, 0, 0]
      "space" : -> View.move [0, 0, Model.User.Configuration.moveValue]
      "shift + space" : -> View.move [0, 0, -Model.User.Configuration.moveValue]

      #Rotate in distance
      "left"  : -> View.yawDistance Model.User.Configuration.rotateValue
      "right" : -> View.yawDistance -Model.User.Configuration.rotateValue
      "up"    : -> View.pitchDistance -Model.User.Configuration.rotateValue
      "down"  : -> View.pitchDistance Model.User.Configuration.rotateValue
      
      #Rotate at centre
      "shift + left"  : -> View.yaw Model.User.Configuration.rotateValue
      "shift + right" : -> View.yaw -Model.User.Configuration.rotateValue
      "shift + up"    : -> View.pitch -Model.User.Configuration.rotateValue
      "shift + down"  : -> View.pitch Model.User.Configuration.rotateValue

      #misc keys
      "n" : -> Helper.toggle()
    )
    
    new Input.KeyboardNoLoop(
      #Branches
      "b" : -> Model.Route.putBranch(View.getMatrix())
      "h" : -> Model.Route.popBranch().done((matrix) -> View.setMatrix(matrix))

      #Zoom in/out
      "o" : -> View.zoomIn()
      "p" : -> View.zoomOut()
    )

  # for more buttons look at Input.Gamepad
  initGamepad : ->
    @input.gamepad = new Input.Gamepad(
        "ButtonA" : -> View.move [0, 0, Model.User.Configuration.moveValue]
        "ButtonB" : -> View.move [0, 0, -Model.User.Configuration.moveValue]
        "LeftStickX" : View.yawDistance
        "LeftStickY" : View.pitchDistance


    )

  initMotionsensor : ->
    @input.deviceorientation = new Input.Deviceorientation(
      "x"  : View.yawDistance
      "y" : View.pitchDistance
    )

  initDeviceOrientation : ->
    @input.deviceorientation = new Input.Deviceorientation(
      "x"  : View.yawDistance
      "y" : View.pitchDistance
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
