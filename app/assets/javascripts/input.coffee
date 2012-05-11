### define
libs/keyboard.0.2.2.min : KeyboardJS
libs/mouse : MouseLib
libs/gamepad : GamepadJS
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

  constructor : (bindings) ->
    for own key, callback of bindings
      @attach(key, callback)

  attach : (key, callback) ->

    KeyboardJS.bind.key(key, callback)


# This module is "main" keyboard handler. 
# It is able to handle key-presses and will continously 
# fire the attached callback.
class Input.Keyboard

  delay : 1000 / 30
  keyCallbackMap : {}
  keyPressedCount : 0

  constructor : (bindings) ->
    for own key, callback of bindings
      @attach(key, callback)

  attach : (key, callback) ->

    KeyboardJS.bind.key(
      key
      =>
        unless @keyCallbackMap[key]?
          @keyPressedCount++ 
          @keyCallbackMap[key] = callback
          @buttonLoop() if @keyPressedCount == 1

        return
      =>
        @keyPressedCount--
        delete @keyCallbackMap[key]
        return
    )

  # In order to continously fire callbacks we have to loop
  # through all the buttons that a marked as "pressed".
  buttonLoop : ->
    if @keyPressedCount > 0
      for own key, callback of @keyCallbackMap
        callback()

      setTimeout( (=> @buttonLoop()), @delay ) 

  unbind : ->
    KeyboardJS.unbind.key "all"


# The mouse module.
# This one basically just provides the public interface
# for mouse handling. Nothing fancy here.
class Input.Mouse
  
  mouse : null

  constructor : (objectToTrack, bindings) ->
    @mouse = new MouseLib objectToTrack

    for own axis, callback of bindings
      @attach(axis, callback)

  attach : (axis, callback) ->
    @mouse.bindX callback if axis is "x"
    @mouse.bindY callback if axis is "y"

  setInversionX : (value) ->
    @mouse.setInversionX value if @mouse?

  setInversionY : (value) ->
    @mouse.setInversionY value if @mouse?

  setRotateValue : (value) ->
    @mouse.setRotateValue value if @mouse?

  unbind : ->
    @mouse.unbind()

    
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

  # actively poll the state of gameoad object as returned
  # by the GamepadJS library.
  gamepadLoop : ->
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