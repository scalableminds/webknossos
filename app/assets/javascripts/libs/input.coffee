Backbone       = require("backbone")
constants      = require("oxalis/constants")
KeyboardJS     = require("keyboardjs")


Input = {}
# This is the main Input implementation.
# Although all keys, buttons and sensor are mapped in
# the controller, this is were the magic happens.
# So far we provide the following input methods:
# * Mouse
# * Keyboard
# * MotionSensor / Gyroscope

# Each input method is contained in its own module. We tried to
# provide similar public interfaces for the input methods.
# In most cases the heavy lifting is done by librarys in the background.


# Workaround: KeyboardJS fires event for "C" even if you press
# "Ctrl + C".
shouldIgnore = (event, key) ->
  bindingHasCtrl  = key.toLowerCase().indexOf("ctrl") != -1
  bindingHasShift = key.toLowerCase().indexOf("shift") != -1
  eventHasCtrl  = event.ctrlKey or event.metaKey
  eventHasShift = event.shiftKey
  return (eventHasCtrl and not bindingHasCtrl) or
    (eventHasShift and not bindingHasShift)


# This keyboard hook directly passes a keycombo and callback
# to the underlying KeyboadJS library to do its dirty work.
# Pressing a button will only fire an event once.
class Input.KeyboardNoLoop

  constructor : (initialBindings) ->

    @bindings = []
    @isStarted = true

    for own key, callback of initialBindings
      @attach(key, callback)


  attach : (key, callback) ->

    binding = [key,
      (event) =>
        return if not @isStarted
        return if $(":focus").length
        return if shouldIgnore(event, key)
        callback(event)
        return
    ]

    KeyboardJS.bind(binding...)

    @bindings.push(binding)


  destroy : ->

    @isStarted = false
    KeyboardJS.unbind(binding...) for binding in @bindings
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
    @isStarted = true

    for own key, callback of initialBindings
      @attach(key, callback)


  attach : (key, callback) ->

    binding = [key,
      (event) =>
        # When first pressed, insert the callback into
        # keyCallbackMap and start the buttonLoop.
        # Then, ignore any other events fired from the operating
        # system, because we're using our own loop.
        # When control key is pressed, everything is ignored, because
        # if there is any browser action attached to this (as with Ctrl + S)
        # KeyboardJS does not receive the up event.

        returnValue = undefined

        return if not @isStarted
        return if @keyCallbackMap[key]?
        return if $(":focus").length
        return if shouldIgnore(event, key)

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

        return if not @isStarted
        if @keyCallbackMap[key]?
          @keyPressedCount--
          delete @keyCallbackMap[key]

        return
    ]

    KeyboardJS.bind(binding...)

    @bindings.push(binding)


  # In order to continously fire callbacks we have to loop
  # through all the buttons that a marked as "pressed".
  buttonLoop : ->

    return if not @isStarted
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


  destroy : ->

    @isStarted = false
    KeyboardJS.unbind(binding...) for binding in @bindings
    return


# The mouse module.
# Events: over, out, leftClick, rightClick, leftDownMove
class Input.Mouse

  class MouseButton

    MOVE_DELTA_THRESHOLD : 30

    constructor : (@name, @which, @mouse, @id) ->
      @down  = false
      @drag  = false
      @moveDelta = 0


    handleMouseDown : (event) ->

      if event.which == @which
        $(":focus").blur() # see OX-159

        @down = true
        @moveDelta = 0
        @mouse.trigger(@name + "MouseDown", @mouse.lastPosition, @id, event)


    handleMouseUp : (event) ->

      if event.which == @which and @down
        @mouse.trigger(@name + "MouseUp", event)
        if @moveDelta <= @MOVE_DELTA_THRESHOLD
          @mouse.trigger(@name + "Click", @mouse.lastPosition, @id, event)
        @down = false


    handleMouseMove : (event, delta) ->

      if @down
        @moveDelta += Math.abs( delta.x ) + Math.abs( delta.y )
        @mouse.trigger(@name + "DownMove", delta, @mouse.position, @id, event)


  constructor : (@$target, initialBindings, @id) ->

    _.extend(this, Backbone.Events)

    @leftMouseButton  = new MouseButton( "left",  1, this, @id )
    @rightMouseButton = new MouseButton( "right", 3, this, @id )
    @isMouseOver = false
    @lastPosition = null

    $(document).on({
      "mousemove" : @mouseMove
      "mouseup"   : @mouseUp
    })

    @$target.on({
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "mouseleave" : @mouseLeave
      "wheel" : @mouseWheel
    })

    @on(initialBindings)
    @attach = @on


  destroy : ->

    $(document).off({
      "mousemove" : @mouseMove
      "mouseup" : @mouseUp
    })

    @$target.off({
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "mouseleave" : @mouseLeave
      "wheel" : @mouseWheel
    })


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

    @lastPosition = {
      x : event.pageX - @$target.offset().left
      y : event.pageY - @$target.offset().top
    }

    @handle("MouseDown", event)


  mouseUp : (event) =>

    if @isMouseOver
      @mouseLeave(which : 0) unless @isHit(event)
    else
      @mouseEnter(which : 0) if @isHit(event)

    @handle("MouseUp", event)


  mouseMove : (event) =>

    @position = {
      x : event.pageX - @$target.offset().left
      y : event.pageY - @$target.offset().top
    }

    if @lastPosition?

      delta = {
        x : (@position.x - @lastPosition.x)
        y : (@position.y - @lastPosition.y)
      }

    if delta?.x != 0 or delta?.y != 0

      @handle( "MouseMove", event, delta )

      @lastPosition = @position

    return


  mouseEnter : (event) =>

    if not @isButtonPressed(event)
      @isMouseOver = true
      @trigger("over")
    return


  mouseLeave : (event) =>

    if not @isButtonPressed(event)
      @isMouseOver = false
      @trigger("out")
    return


  isButtonPressed : (event) ->

    # Workaround for Firefox: event.which is not set properly

    if (b = event.originalEvent?.buttons)?
      return b != 0
    return event.which != 0


  mouseWheel : (event) =>

    event.preventDefault()
    delta = -event.originalEvent.deltaY
    if event.shiftKey
      @trigger("scroll", delta, "shift")
    else if event.altKey
      @trigger("scroll", delta, "alt")
    else if event.ctrlKey
      @trigger("scroll", delta, "ctrl")
    else
      @trigger("scroll", delta, null)

    return


module.exports = Input
