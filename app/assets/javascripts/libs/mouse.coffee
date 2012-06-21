### define 
model/user : User
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


  ###
  #@param {Object} target : DOM Element
  # HTML object where the mouse attaches the events
  ###
  constructor : (@target) ->
    # @User = User
  
    navigator.pointer = navigator.webkitPointer or navigator.pointer or navigator.mozPointer

    $(target).on 
      "mousemove" : @mouseMoved
      "mousedown" : @mouseDown
      "mouseup"   : @mouseUp

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

  unbind : ->
    $(@target).off 
      "mousemove" : @mouseMoved
      "mouseup" : @mouseUp
      "mousedown" : @mouseDown
      "webkitfullscreenchange" : @toogleMouseLock
      "webkitpointerlocklost" : @unlockMouse
      "webkitpointerlockchange" : @unlockMouse    

  mouseMoved : (evt) =>
    
    { lastPosition, changedCallback } = @

    # regular mouse management
    unless @locked 
      if @buttonDown
        distX =  (evt.pageX - lastPosition.x) * User.Configuration.mouseInversionX
        distY =  (evt.pageY - lastPosition.y) * User.Configuration.mouseInversionY
        @changedCallbackX distX * User.Configuration.mouseRotateValue if distX isnt 0
        @changedCallbackY distY * User.Configuration.mouseRotateValue if distY isnt 0

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

  mouseDown : =>
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
