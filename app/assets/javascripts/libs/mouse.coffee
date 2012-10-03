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
  changedCallbackR : $.noop()
  changedCallbackMW : $.noop()
  changedCallbackM : $.noop()
  activeCallback : $.noop()


  ###
  #@param {Object} target : DOM Element
  # HTML object where the mouse attaches the events
  ###
  constructor : (target, activeCallback) ->
    # @User = User
    @target = target

    @activeCallback = activeCallback
    navigator.pointer = navigator.webkitPointer or navigator.pointer or navigator.mozPointer

    $(@target).on 
      "mousemove" : @mouseMoved
      "mousedown" : @mouseDown
      "mouseup"   : @mouseUp
      "mouseenter" : @mouseEnter
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
    @changedCallbackR = callback

  bindW : (callback) ->
    @changedCallbackMW = callback

  bindM : (callback) ->
    @changedCallbackM = callback

  unbind : ->
    $(@target).off 
      "mousemove" : @mouseMoved
      "mouseup" : @mouseUp
      "mousedown" : @mouseDown
      "mouseenter" : @mouseEnter
      "webkitfullscreenchange" : @toogleMouseLock
      "webkitpointerlocklost" : @unlockMouse
      "webkitpointerlockchange" : @unlockMouse  
      "mousewheel" : @mouseWheel  

  mouseMoved : (evt) =>
    
    { lastPosition, changedCallback } = @

    # mouse moved in preview to show tooltip
    if @changedCallbackM?
      @changedCallbackM [evt.pageX - $(@target).offset().left, evt.pageY - $(@target).offset().top]

    # regular mouse management
    unless @locked 
      if @buttonDown
        distX =  (evt.pageX - lastPosition.x) * User.Configuration.mouseInversionX
        distY =  (evt.pageY - lastPosition.y) * User.Configuration.mouseInversionY
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

  mouseEnter : =>
    if @activeCallback?
      @activeCallback()

  mouseWheel : (evt, delta) =>
    if @changedCallbackMW?
      @changedCallbackMW(delta)
      return false      # prevent scrolling the web page
    
  mouseDown : (evt) =>
    # check whether the mouseDown event is a rightclick
    if evt.which == 3
      # on rightclick, return mouse position relative to the canvas
      @changedCallbackR [evt.pageX - $(@target).offset().left, evt.pageY - $(@target).offset().top], 0
    else
      $(@target).css("cursor", "none")
      @buttonDown = true

  mouseUp : =>
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
