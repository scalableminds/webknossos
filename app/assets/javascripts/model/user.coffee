### define
libs/request : request
###

# This takes care of the userdate. 
User = {}

# Debounce for POST User.Configuration
DEBOUNCE_TIME = 3000

User.Configuration = 

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
  displayPreviewXY : null
  displayPreviewYZ : null
  displayPreviewXZ : null
  nodesAsSpheres : null
  mouseInversionX : null
  mouseInversionY : null
  mouseActive : null
  keyboardActive : null
  gamepadActive : null
  motionsensorActive : null


  initialize : ->
    unless @configDeferred
      @push =  _.debounce @pushImpl, DEBOUNCE_TIME      
      @configDeferred = $.Deferred()

      @configDeferred.fail =>
        @configDeferred = null

      request(url : '/user/configuration').then( 
        
        (data) =>
          try
            data = JSON.parse data
            { @moveValue, 
              @rotateValue, 
              @scaleValue, 
              @mouseRotateValue, 
              @routeClippingDistance, 
              @lockZoom,
              @displayCrosshair,
              @interpolation,
              @displayPreviewXY,
              @displayPreviewYZ,
              @displayPreviewXZ,
              @nodesAsSpheres,
              @mouseInversionX,
              @mouseInversionY,
              @mouseActive, 
              @keyboardActive,
              @gamepadActive,
              @motionsensorActive } = data

          catch ex
            @configDeferred.reject(ex)
          
          @configDeferred.resolve(data)

        (err) =>
          @configDeferred.reject(err)
      )
    
      @configDeferred.promise()

  push : null

  pushImpl : ->
    deferred = $.Deferred()
      
    request(
      url    : "/user/configuration"
      method : 'POST'
      contentType : "application/json"
      data   : { 
        moveValue : @moveValue,
        rotateValue : @rotateValue,
        scaleValue : @scaleValue,
        mouseRotateValue : @mouseRotateValue,
        routeClippingDistance : @routeClippingDistance,
        lockZoom : @lockZoom,
        displayCrosshair : @displayCrosshair,
        interpolation : @interpolation,
        displayPreviewXY : @displayPreviewXY,
        displayPreviewYZ : @displayPreviewYZ,
        displayPreviewXZ : @displayPreviewXZ,
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

User
