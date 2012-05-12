### define
model : Model
view : View
geometry_factory : GeometryFactory
input : Input
helper : Helper
###


Controller = 

  initialize : (@canvas) ->
  
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

        GeometryFactory.createMesh("crosshair.js", 0, 0, 5)
        GeometryFactory.createTrianglesplane(128, 0).done ->
          View.draw()
      
      ->
        alert("Ooops. We couldn't communicate with our mother ship. Please try to reload this page.")
    )

  initMouse : ->
    @input.mouse = new Input.Mouse(
      @canvas
      "x" : View.yawDistance
      "y" : View.pitchDistance
    )

  initKeyboard : ->
    
    @input.keyboard = new Input.Keyboard(

      #Fullscreen Mode
      "f" : => 
        canvas = @canvas
        requestFullscreen = canvas.webkitRequestFullScreen or canvas.mozRequestFullScreen or canvas.RequestFullScreen
        if requestFullscreen
          requestFullscreen.call(canvas, canvas.ALLOW_KEYBOARD_INPUT)

    
      #ScaleTrianglesPlane
      "l" : -> View.scaleTrianglesPlane -scaleValue
      "k" : -> View.scaleTrianglesPlane scaleValue

      #Move
      "w" : -> View.move [0, User.Configuration.moveValue, 0]
      "s" : -> View.move [0, -User.Configuration.moveValue, 0]
      "a" : -> View.move [User.Configuration.moveValue, 0, 0]
      "d" : -> View.move [-User.Configuration.moveValue, 0, 0]
      "space" : -> View.move [0, 0, User.Configuration.moveValue]
      "shift + space" : -> View.move [0, 0, -User.Configuration.moveValue]

      #Rotate in distance
      "left"  : -> View.yawDistance User.Configuration.rotateValue
      "right" : -> View.yawDistance -User.Configuration.rotateValue
      "up"    : -> View.pitchDistance -User.Configuration.rotateValue
      "down"  : -> View.pitchDistance User.Configuration.rotateValue
      
      #Rotate at centre
      "shift + left"  : -> View.yaw User.Configuration.rotateValue
      "shift + right" : -> View.yaw -User.Configuration.rotateValue
      "shift + up"    : -> View.pitch -User.Configuration.rotateValue
      "shift + down"  : -> View.pitch User.Configuration.rotateValue

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
        "ButtonA" : -> View.move [0, 0, User.Configuration.moveValue]
        "ButtonB" : -> View.move [0, 0, -User.Configuration.moveValue]
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
    mouse : null
    keyboard : null
    gamepad : null
    deviceorientation : null

  #Customize Options
  setMoveValue : (value) ->
    User.Configuration.moveValue = (Number) value
    User.Configuration.push()   

  setRotateValue : (value) ->
    User.Configuration.rotateValue = (Number) value 
    User.Configuration.push()   

  setScaleValue : (value) ->
    User.Configuration.scaleValue = (Number) value  
    User.Configuration.push()         

  setMouseRotateValue : (value) ->
    User.Configuration.mouseRotateValue = (Number) value
    User.Configuration.push()         

  setMouseInversionX : (value) ->
    if value is true
      User.Configuration.mouseInversionX = 1
    else
      User.Configuration.mouseInversionX = -1
    User.Configuration.push()         

  setMouseInversionY : (value) ->
    if value is true
      User.Configuration.mouseInversionY = 1
    else
      User.Configuration.mouseInversionY = -1
    User.Configuration.push()         


  setMouseActivity : (value) ->
    User.Configuration.mouseActive = value
    User.Configuration.push()       
    if value is false
      @input.mouse.unbind()
      @input.mouse = null
    else
      @initMouse()

  setKeyboardActivity : (value) ->
    User.Configuration.keyboardActive = value 
    User.Configuration.push()   
    if value is false
      @input.keyboard.unbind()
      @input.keyboard = null
    else
      @initKeyboard()

  setGamepadActivity : (value) ->
    User.Configuration.gamepadActive = value  
    User.Configuration.push()   
    if value is false
      @input.gamepad.unbind()
      @input.gamepad = null
    else
      @initGamepad()    

  setMotionSensorActivity : (value) ->
    User.Configuration.motionsensorActive = value
    User.Configuration.push()   
    if value is false
      @input.deviceorientation.unbind()
      @input.deviceorientation = null
    else
      @initMotionsensor()         


