### define
./keyboard : KeyboardJS
./gamepad : GamepadJS
./event_mixin : EventMixin
./jquery-mousewheel-3.0.6/jquery.mousewheel : JQ_MOUSE_WHEEL
oxalis/constants : constants
###

Input = {}
# This is the main Input implementation.
# Although all keys, buttons and sensor are mapped in 
# the controller, this is were the magic happens.
# So far we provide the following input methods:
# * Mouse
# * Keyboard
# * Gamepad
# * MotionSensor / Gyroscope

# Each input method is contained in its own module. We tried to
# provide similar public interfaces for the input methods. 
# In most cases the heavy lifting is done by librarys in the background.


# This keyboard hook directly passes a keycombo and callback
# to the underlying KeyboadJS library to do its dirty work.
# Pressing a button will only fire an event once.
class Input.KeyboardNoLoop

  constructor : (initialBindings) ->

    @bindings = []

    for own key, callback of initialBindings
      @attach(key, callback)


  attach : (key, callback) ->

    binding = KeyboardJS.on(key, 
      (event) => 
        callback(event) unless $(":focus").length
        return
    )
    @bindings.push(binding)


  unbind : ->

    binding.clear() for binding in @bindings
    return


# This module is "main" keyboard handler. 
# It is able to handle key-presses and will continously 
# fire the attached callback.
class Input.Keyboard

  DELAY : 1000 / constants.FPS

  constructor : (initialBindings, @delay = 0) ->

    @keyCallbackMap = {}
    @keyPressedCount = 0
    @bindings = []

    for own key, callback of initialBindings
      @attach(key, callback)


  attach : (key, callback) ->

    binding = KeyboardJS.on(
      key
      (event) =>
        # When first pressed, insert the callback into
        # keyCallbackMap and start the buttonLoop.
        # Then, ignore any other events fired from the operating
        # system, because we're using our own loop.
        # When control key is pressed, everything is ignored, because
        # if there is any browser action attached to this (as with Ctrl + S)
        # KeyboardJS does not receive the up event.
        
        returnValue = undefined

        unless @keyCallbackMap[key]? or $(":focus").length
          
          callback(1, true)
          # reset lastTime
          callback._lastTime   = null
          callback._delayed    = true
          @keyCallbackMap[key] = callback

          @keyPressedCount++
          @buttonLoop() if @keyPressedCount == 1
          
        if @delay >= 0
          setTimeout( (=>
            callback._delayed = false
            ), @delay )

        return returnValue

      =>
        
        if @keyCallbackMap[key]?
          @keyPressedCount--
          delete @keyCallbackMap[key]

        return
    )
    @bindings.push(binding)


  # In order to continously fire callbacks we have to loop
  # through all the buttons that a marked as "pressed".
  buttonLoop : ->

    if @keyPressedCount > 0
      for own key, callback of @keyCallbackMap
        if not callback._delayed

          curTime  = (new Date()).getTime()
          # If no lastTime, assume that desired FPS is met
          lastTime = callback._lastTime || (curTime - 1000 / constants.FPS)
          elapsed  = curTime - lastTime
          callback._lastTime = curTime

          callback(elapsed / 1000 * constants.FPS, false)

      setTimeout( (=> @buttonLoop()), @DELAY ) 


  unbind : ->

    binding.clear() for binding in @bindings
    return


# The mouse module.
# Events: over, out, leftClick, rightClick, leftDownMove
class Input.Mouse

  class MouseButton


    constructor : (@name, @which, @mouse, @id) ->
      @down  = false
      @drag  = false
      @moved = false


    handleMouseDown : (event) ->

      if event.which == @which
        $(":focus").blur() # see OX-159

        @down  = true
        @moved = false
        @mouse.trigger(@name + "MouseDown", @mouse.lastPosition, event.shiftKey, event.altKey)


    handleMouseUp : (event) ->

      if event.which == @which and @down
        @mouse.trigger(@name + "MouseUp")
        if not @moved
          @mouse.trigger(@name + "Click", @mouse.lastPosition, event.shiftKey, event.altKey, @id)
        @down = false


    handleMouseMove : (event, delta) ->

      if @down
        @moved = true
        @mouse.trigger(@name + "DownMove", delta, @mouse.position, event.ctrlKey)


  constructor : (@$target, initialBindings, @id) ->

    _.extend(this, new EventMixin())

    @leftMouseButton  = new MouseButton( "left",  1, this, @id )
    @rightMouseButton = new MouseButton( "right", 3, this, @id )
    @isMouseOver = false
    @lastPosition = null

    $(window).on
      "mousemove" : @mouseMove
      "mouseup"   : @mouseUp

    @$target.on 
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "mouseleave" : @mouseLeave
      "mousewheel" : @mouseWheel

    @on(initialBindings)
    @attach = @on
      

  unbind : ->

    $(window).off
      "mousemove" : @mouseMove
      "mouseup" : @mouseUp

    @$target.off 
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "mouseleave" : @mouseLeave
      "mousewheel" : @mouseWheel 


  isHit : (event) ->

    { pageX, pageY } = event
    { left, top } = @$target.offset()

    left <= pageX <= left + @$target.width() and
    top <= pageY <= top + @$target.height()

  handle : (eventName, args...) ->

    for button in [ @leftMouseButton, @rightMouseButton ]
      button["handle" + eventName].apply( button, args )

  mouseDown : (event) =>

    event.preventDefault()

    @lastPosition = 
      x : event.pageX - @$target.offset().left
      y : event.pageY - @$target.offset().top

    @handle("MouseDown", event)


  mouseUp : (event) =>

    if @isMouseOver
      @mouseLeave(which : 0) unless @isHit(event)
    else
      @mouseEnter(which : 0) if @isHit(event)

    @handle( "MouseUp", event )


  mouseMove : (event) =>

    @position =
      x : event.pageX - @$target.offset().left
      y : event.pageY - @$target.offset().top
    
    if @lastPosition?

      delta = 
        x : (@position.x - @lastPosition.x)
        y : (@position.y - @lastPosition.y)

    if delta?.x != 0 or delta?.y != 0

      @handle( "MouseMove", event, delta )

      @lastPosition = @position

    return


  mouseEnter : (event) =>

    if event.which == 0
      @isMouseOver = true
      @trigger("over")
    return


  mouseLeave : (event) =>

    if event.which == 0
      @isMouseOver = false
      @trigger("out")
    return


  mouseWheel : (event, delta) =>

    event.preventDefault()
    if event.shiftKey
      @trigger("scroll", delta, "shift")
    else if event.altKey
      @trigger("scroll", delta, "alt")
    else
      @trigger("scroll", delta, null)

    return

    
# This module completly handles the device orientation / 
# tilting sensor (gyroscope).
# Similarily to the keyboard it relies on looping over
# all the "pressed" buttons. i.e. Once a certain threshold
# for the sensor is met this axis is marked as "pressed" (fire).
class Input.Deviceorientation

  THRESHOLD = 10
  SLOWDOWN_FACTOR = 500
  
  keyPressedCallbacks : {}
  keyBindings : {}
  keyPressedCount : 0

  delay : 1000 / 30

  constructor : (bindings) ->

    for own key, callback of bindings
      @attach(key, callback)

    $(window).on(
      "deviceorientation", 
      @eventHandler = ({originalEvent : event}) => 
        
        { gamma, beta } = event
        if gamma < -THRESHOLD or gamma > THRESHOLD
          @fire("x", -gamma)
        else
          @unfire("x")

        if beta < -THRESHOLD or beta > THRESHOLD
          @fire("y", beta)
        else
          @unfire("y")
    )


  attach : (key, callback) ->

    @keyBindings[key] = callback


  unbind : ->

    $(window).off(
      "deviceorientation", 
      @eventHandler
      @unfire("x")
      @unfire("y")
    )


  fire : (key, dist) ->

    unless @keyPressedCallbacks[key]?
      @keyPressedCount++ 
      @keyPressedCallbacks[key] = 
        callback : @keyBindings[key]
        distance : (dist - THRESHOLD) / SLOWDOWN_FACTOR
      @buttonLoop() if @keyPressedCount == 1


  unfire : (key) ->

    if @keyPressedCallbacks[key]
      @keyPressedCount--
      delete @keyPressedCallbacks[key]
    return

  buttonLoop : ->

    if @keyPressedCount > 0
      for own key, { callback, distance } of @keyPressedCallbacks
        callback?(distance)

      setTimeout( (=> @buttonLoop()), @delay ) 


# Last but not least, the gamepad module.
# The current gamepad API for the browser forces us
# to constantly poll the Gamepad object to evaluate 
# the state of a button. 
# In order to abstract the gamepad from different vendors,
# operation systems and browsers we rely on the GamepadJS lib.
# All "thumb sticks" return values -1...1 whereas all other buttons
# return 0 or 1.

class Input.Gamepad

  # http://robhawkes.github.com/gamepad-demo/
  # https://github.com/jbuck/input.js/
  # http://www.gamepadjs.com/
  
  DEADZONE : 0.35
  SLOWDOWN_FACTOR : 20

  gamepad : null
  delay :  1000 / 30
  buttonCallbackMap : {}
  buttonNameMap :
    "ButtonA" : "faceButton0"
    "ButtonB" : "faceButton1"
    "ButtonX" : "faceButton2"
    "ButtonY" : "faceButton3"
    "ButtonStart"  : "start"
    "ButtonSelect" : "select"

    "ButtonLeftTrigger"  : " leftShoulder0"
    "ButtonRightTrigger" : "rightShoulder0"
    "ButtonLeftShoulder" : "leftShoulder1"
    "ButtonRightShoulder": "rightShoulder1"

    "ButtonUp"    : "dpadUp"
    "ButtonDown"  : "dpadDown"
    "ButtonLeft"  : "dpadLeft"
    "ButtonRight" : "dpadRight"

    "ButtonLeftStick"  : "leftStickButton"
    "ButtonRightStick" : "rightStickButton"
    "LeftStickX" : "leftStickX"
    "LeftStickY" : "leftStickY"
    "RightStickX": "rightStickX"
    "RightStickY": "rightStickY"


  constructor : (bindings) ->

    if GamepadJS.supported

      for own key, callback of bindings
        @attach( @buttonNameMap[key] , callback )
      _.defer => @gamepadLoop()

    else
     console.log "Your browser does not support gamepads!"


  attach : (button, callback)  ->

      @buttonCallbackMap[button] = callback


  unbind : ->

    @buttonCallbackMap = null


  gamepadLoop : ->
    # actively poll the state of gameoad object as returned
    # by the GamepadJS library.

    #stops the loop caused by unbind
    return unless @buttonCallbackMap

    _pad = GamepadJS.getStates()
    @gamepad = _pad[0]

    if @gamepad?
      for button, callback of @buttonCallbackMap
        unless @gamepad[button] == 0
          # axes
          if button in ["leftStickX", "rightStickX"]
            value = @gamepad[button]
            callback -@filterDeadzone(value)

          else if button in ["leftStickY", "rightStickY"] 
            value = @gamepad[button]
            callback @filterDeadzone(value)
          #buttons
          else
            callback()


    setTimeout( (=> @gamepadLoop()), @delay)


  # FIXME 
  # as far as I know the gamepad.js lib already provides values for deadzones
  filterDeadzone : (value) ->

      if Math.abs(value) > @DEADZONE then value / @SLOWDOWN_FACTOR else 0


Input
