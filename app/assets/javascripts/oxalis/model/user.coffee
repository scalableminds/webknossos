### define
../../libs/request : Request
libs/event_mixin : EventMixin
###

class User

  # userdata
  # default values are defined in server
  moveValue : null
  moveValue3d : null
  rotateValue : null
  crosshairSize : null
  scaleValue : null
  mouseRotateValue : null
  routeClippingDistance : null
  routeClippingDistanceArbitrary : null
  dynamicSpaceDirection : null
  displayCrosshair : null
  interpolation : null
  fourBit : null
  briConNames : null
  brightness : null
  contrast : null
  quality : null
  zoom : null
  scale : null
  displayPreviewXY : null
  displayPreviewYZ : null
  displayPreviewXZ : null
  newNodeNewTree : null
  inverseX : null
  inverseY : null
  keyboardDelay : null
  mouseActive : null
  keyboardActive : null
  gamepadActive : null
  motionsensorActive : null
  firstVisToggle : null
  particleSize : null
  sortTreesByName : null


  constructor : (user) ->

    _.extend(this, new EventMixin())
    _.extend(@, user)


  setValue : (name, value) ->

    @[name] = value
    @trigger(name + "Changed", value)
    @push()

  getMouseInversionX : ->

    return if @inverseX then 1 else -1

  getMouseInversionY : ->

    return if @inverseY then 1 else -1


  triggerAll : ->

    for property of this
      @trigger(property + "Changed", @[property]) 


  push : ->

    $.when(@pushImpl())


  pushImpl : ->
    
    deferred = $.Deferred()
      
    Request.send(
      url      : "/user/configuration"
      type     : "POST"
      dataType : "json"
      data   : { 
        moveValue : @moveValue,
        moveValue3d : @moveValue3d,
        rotateValue : @rotateValue,
        crosshairSize : @crosshairSize,
        scaleValue : @scaleValue,
        mouseRotateValue : @mouseRotateValue,
        routeClippingDistance : @routeClippingDistance,
        routeClippingDistanceArbitrary : @routeClippingDistanceArbitrary,
        dynamicSpaceDirection : @dynamicSpaceDirection,
        displayCrosshair : @displayCrosshair,
        interpolation : @interpolation,
        fourBit: @fourBit,
        briConNames : @briConNames,
        brightness: @brightness,
        contrast: @contrast, 
        quality : @quality,
        zoom : @zoom,
        scale : @scale,
        displayPreviewXY : @displayPreviewXY,
        displayPreviewYZ : @displayPreviewYZ,
        displayPreviewXZ : @displayPreviewXZ,
        newNodeNewTree : @newNodeNewTree,
        inverseX : @inverseX,
        inverseY : @inverseY,
        keyboardDelay : @keyboardDelay,
        mouseActive : @mouseActive,
        keyboardActive : @keyboardActive,
        gamepadActive : @gamepadActive,
        motionsensorActive : @motionsensorActive
        firstVisToggle : @firstVisToggle 
        particleSize : @particleSize 
        sortTreesByName : @sortTreesByName }
    ).fail( =>
      
      console.log "could'nt save userdata"

    ).always(-> deferred.resolve())
    
    deferred.promise()    
