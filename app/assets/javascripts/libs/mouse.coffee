### define ###

class Mouse

  # This is our mouse library.
  # All the mouse handling is passed down to 
  # this lib. Everything is pretty straight forward.
  # There is even support for the new pointerlock 
  # (mouse lock) API for webkit browser. 

  rotateValue = 0.004   
  inversion = {
    x : 1
    y : 1
  }

  buttonDown : false
  doubleClicked : false
  
  # used for mouse locking in fullscreen mode
  locked : false

  lastPosition : 
    x : null
    y : null

  changedCallback :  
    x : $.noop()
    y : $.noop() 

  inversion : 
    x : 1
    y : 1


  ###
  #@param {Object} target : DOM Element
  # HTML object where the mouse attaches the events
  ###
  constructor : (@target) ->
  
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
    @changedCallback.x = callback

  ###
  #Binds a function as callback when Y-Position was changed
  #@param {Function} callback :
  # gets a modified distance as parameter
  ###
  bindY : (callback) ->
    @changedCallback.y = callback

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
        distX = -(evt.pageX - lastPosition.x) * inversion.x
        distY =  (evt.pageY - lastPosition.y) * inversion.y
        changedCallback.x distX * rotateValue if distX isnt 0
        changedCallback.y distY * rotateValue if distY isnt 0

      @lastPosition =
        x : evt.pageX
        y : evt.pageY

    # fullscreen API 
    # Mouse lock returns MovementX/Y in addition to the regular properties
    # (these become static)   
    else
      distX = -evt.originalEvent.webkitMovementX * inversion.x
      distY = evt.originalEvent.webkitMovementY * inversion.y
      changedCallback.x distX * rotateValue if distX isnt 0
      changedCallback.y distY * rotateValue if distY isnt 0

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

  setRotateValue : (value) ->
    rotateValue = value

  setInversionX : (value) ->
      if value is true
        inversion.x = -1
      else
        inversion.x = 1   

  setInversionY : (value) ->
      if value is true
        inversion.y = -1
      else
        inversion.y = 1
