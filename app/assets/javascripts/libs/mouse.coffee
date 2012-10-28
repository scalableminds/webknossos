### define 
model/user : User
libs/jquery-mousewheel-3.0.6/jquery.mousewheel : JQ_MOUSE_WHEEL
###

class Mouse

  # This is our mouse library.
  # All the mouse handling is passed down to 
  # this lib. Everything is pretty straight forward.
  # There is even support for the new pointerlock 
  # (mouse lock) API for webkit browser. 

  buttonDown : false
  doubleClicked : false
  
  # used for mouse locking in fullscreen mode
  locked : false

  lastPosition : 
    x : null
    y : null

  # stores the callbacks for mouse movement in each dimension
  changedCallbackX : $.noop()
  changedCallbackY : $.noop()
  changedCallbackRightclick : $.noop()
  changedCallbackMouseWheel : $.noop()
  @changedCallbackLeftclick : $.noop()
  activeCallback : $.noop()


  ###
  #@param {Object} target : DOM Element
  # HTML object where the mouse attaches the events
  ###
  constructor : (target, activeCallback) ->
    @target = target
    @shouldBeActive = false

    @activeCallback = activeCallback
    navigator.pointer = navigator.webkitPointer or navigator.pointer or navigator.mozPointer

    $(window).on
      "mousemove" : @mouseMoved
      "mouseup"   : @mouseUp

    $(@target).on 
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "mouseleave" : @mouseLeave
      "mousewheel" : @mouseWheel
      # fullscreen pointer lock
      # Firefox does not yet support Pointer Lock
      "webkitfullscreenchange" : @toogleMouseLock
      # TODO these two need to be revised, once the API spec is finalized
      "webkitpointerlocklost" : @unlockMouse #???
      "webkitpointerlockchange" : @unlockMouse



  ###
  #Binds a function as callback when X-Position was changed
  #@param {Function} callback :
  # gets a modified distance as parameter
  ###
  bindX : (callback) ->
    @changedCallbackX = callback

  ###
  #Binds a function as callback when Y-Position was changed
  #@param {Function} callback :
  # gets a modified distance as parameter
  ###
  bindY : (callback) ->
    @changedCallbackY = callback

  ###
  #Binds a function as callback when canvas was rightclicked
  #@param {Function} callback :
  # gets the relative mouse position as parameter
  ###
  bindR : (callback) ->
    @changedCallbackRightclick = callback

  ###
  #Binds a function as callback when canvas was leftclicked
  #@param {Function} callback :
  # gets the relative mouse position as parameter
  ###
  bindL : (callback) ->
    @changedCallbackLeftclick = callback

  ###
  #Binds a function as callback when mousewheel was changed
  #@param {Function} callback :
  # gets the delta as parameter
  ###

  bindW : (callback) ->
    @changedCallbackMouseWheel = callback

  unbind : ->
    $(@target).off 
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "mouseleave" : @mouseLeave
      "webkitfullscreenchange" : @toogleMouseLock
      "webkitpointerlocklost" : @unlockMouse
      "webkitpointerlockchange" : @unlockMouse  
      "mousewheel" : @mouseWheel 

    $(window).off
      "mousemove" : @mouseMoved
      "mouseup" : @mouseUp

    @changedCallback = null

  mouseMoved : (evt) =>

    # regular mouse management
    unless @locked 
      if @buttonDown
        distX =  (evt.pageX - @lastPosition.x) * User.Configuration.mouseInversionX
        distY =  (evt.pageY - @lastPosition.y) * User.Configuration.mouseInversionY
        @changedCallbackX distX if distX isnt 0
        @changedCallbackY distY if distY isnt 0

      @lastPosition =
        x : evt.pageX
        y : evt.pageY

    # fullscreen API 
    # Mouse lock returns MovementX/Y in addition to the regular properties
    # (these become static)   
    else
      distX = evt.originalEvent.webkitMovementX * User.Configuration.mouseInversionX
      distY = evt.originalEvent.webkitMovementY * User.Configuration.mouseInversionY
      @changedCallbackX distX * User.Configuration.mouseRotateValue if distX isnt 0
      @changedCallbackY distY * User.Configuration.mouseRotateValue if distY isnt 0

  mouseEnter : (evt) =>
    # don't invoke activeCallback, when leftclicking while entering, but remember to do it on mouseUp
    if evt.which != 1 and @activeCallback?
      @activeCallback()
    else
      @shouldBeActive = true

  mouseLeave : =>
    @shouldBeActive = false

  mouseWheel : (evt, delta) =>
    if @changedCallbackMouseWheel?
      @changedCallbackMouseWheel(delta)
      return false      # prevent scrolling the web page
    
  mouseDown : (evt) =>
    # check whether the mouseDown event is a leftclick
    if evt.which == 1
      $(@target).css("cursor", "none")
      @buttonDown = true
      # on leftclick, return mouse position relative to the canvas
      @changedCallbackLeftclick [evt.pageX - $(@target).offset().left, evt.pageY - $(@target).offset().top], 0
    else
      if @changedCallbackRightclick
        @changedCallbackRightclick [evt.pageX - $(@target).offset().left, evt.pageY - $(@target).offset().top], 0

    return false

  mouseUp : =>
    # invoke activeCallback when view was entered while dragging the plane in another view
    if @shouldBeActive == true
        if @activeCallback?
          @activeCallback()
        @shouldBeActive = false
    @buttonDown = false
    $(@target).css("cursor", "auto")

  toogleMouseLock : =>
    unless @locked
      if (navigator.pointer)
        navigator.pointer.lock @target, ( -> console.log "Mouse Lock successful" ), ( -> console.log "Error: Mouse Lock" )
        @locked = true
    else
      @locked = false
      navigator.pointer.unlock()
