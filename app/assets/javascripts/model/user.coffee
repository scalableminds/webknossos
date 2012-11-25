### define
../libs/request : Request
###

class User

  # userdata
  # default values are defined in server
  moveValue : null
  rotateValue : null
  scaleValue : null
  mouseRotateValue : null
  routeClippingDistance : null
  lockZoom : null
  displayCrosshair : null
  interpolation : null
  minZoomStep : null
  zoomXY : null
  zoomYZ : null
  zoomXZ : null
  displayPreviewXY : null
  displayPreviewYZ : null
  displayPreviewXZ : null
  newNodeNewTree : null
  nodesAsSpheres : null
  mouseInversionX : null
  mouseInversionY : null
  mouseActive : null
  keyboardActive : null
  gamepadActive : null
  motionsensorActive : null


  constructor : (user) ->

    _.extend(@, user)


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
        rotateValue : @rotateValue,
        scaleValue : @scaleValue,
        mouseRotateValue : @mouseRotateValue,
        routeClippingDistance : @routeClippingDistance,
        lockZoom : @lockZoom,
        displayCrosshair : @displayCrosshair,
        interpolation : @interpolation,
        minZoomStep : @minZoomStep,
        zoomXY : @zoomXY,
        zoomYZ : @zoomYZ,
        zoomXZ : @zoomXZ,
        displayPreviewXY : @displayPreviewXY,
        displayPreviewYZ : @displayPreviewYZ,
        displayPreviewXZ : @displayPreviewXZ,
        newNodeNewTree : @newNodeNewTree,
        nodesAsSpheres : @nodesAsSpheres,
        mouseInversionX : @mouseInversionX,
        mouseInversionY : @mouseInversionY,
        mouseActive : @mouseActive,
        keyboardActive : @keyboardActive,
        gamepadActive : @gamepadActive,
        motionsensorActive : @motionsensorActive }
    ).fail( =>
      
      console.log "could'nt save userdata"

    ).always(-> deferred.resolve())
    
    deferred.promise()    
