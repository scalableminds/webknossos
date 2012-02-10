# Applies a transformation matrix on an array of points.
M4x4.transformPointsAffine = (m, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12]
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13]
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14]

  r
# Applies a transformation matrix on an array of points.
M4x4.transformPoints = (m, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12]
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13]
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14]
    w        = m[3] * v0 + m[7] * v1 + m[11] * v2 + m[15]

    if w != 1.0
      r[0] /= w
      r[1] /= w
      r[2] /= w

  r



# Applies a transformation matrix on an array of points.
M4x4.transformPointsAffineWithTranslation = (m, translationVector, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  [tx, ty, tz] = translationVector

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12] + tx
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13] + ty
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14] + tz

  r

M4x4.makeRotate2 = (direction, r = new MJS_FLOAT_ARRAY_TYPE(16)) ->

  # orthogonal vector to (0,1,0) and rotation vector
  axis = V3.normalize([direction[2], 0, -direction[0]])

  # dot product of (0,1,0) and rotation
  dotProd = direction[1]
  
  # transformation of dot product for cosA
  cosA = dotProd / V3.length(direction)
  sinA = Math.sqrt(1 - cosA * cosA)

  [axis_x, axix_y, axis_z] = axis
  
  # calculate rotation matrix
  r[0]  = axis_x * axis_x * (1 - cosA) + cosA 
  r[1]  = axis_z * sinA
  r[2]  = axis_x * axis_z * (1 - cosA)
  r[3]  = 0
  r[4]  = -axis_z * sinA
  r[5]  = cosA
  r[6]  = axis_x * sinA
  r[7]  = 0
  r[8]  = axis_x * axis_z * (1 - cosA)
  r[9]  = -axis_x * sinA
  r[10] = axis_z * axis_z * (1 - cosA) + cosA
  r[11] = 0
  r[12] = 0
  r[13] = 0
  r[14] = 0
  r[15] = 0
  
  r

# Moves an array of vertices. It also supports rotation, just provide
# a vector representing the direction you're looking. The vertices
# are considered to be at position `[0,0,0]` with the direction `[0,1,0]`.
M4x4.moveVertices = (vertices, translationVector, directionVector) ->

  output = new Float32Array(vertices.length)
  directionVector = V3.normalize(directionVector)

  # `[0,1,0]` is the axis of the template, so there is no need for rotating
  # We can do translation on our own, because it's not too complex..and 
  # probably faster.
  if directionVector[0] == 0 and directionVector[1] == 1 and directionVector[2] == 0

    [px, py, pz] = translationVector
    
    for i in [0...vertices.length] by 3
      output[i]     = px + vertices[i]
      output[i + 1] = py + vertices[i + 1]
      output[i + 2] = pz + vertices[i + 2]
    output
  
  else
    
    mat = M4x4.makeRotate2(directionVector)
    
    M4x4.transformPointsAffineWithTranslation(mat, translationVector, vertices, output)

# `_.throttle2` makes a function only be executed once in a given
# time span -- no matter how often you it. We don't recomment to use 
# any input parameters, because you cannot know which are used and 
# which are dropped. In contrast to `_.throttle`, the function
# at the beginning of the time span.
_.throttle2 = (func, wait, resume = true) ->
  timeout = more = false

  ->
    context = @
    args = arguments
    if timeout == false
      _.defer -> func.apply(context, args)
      timeout = setTimeout (
        -> 
          timeout = false
          func.apply(context, args) if more
          more = false
        ), wait
    else
      more = resume and true

# `_.once2` makes sure a function is executed only once. It works only
# with asynchronous functions. The function cannot have any input 
# parameters. If one pass of the function failes, it can be executed 
# again.
_.once2 = (func) ->
  initialized = false
  watingCallbacks = null

  done = (err) ->
    callbacks = watingCallbacks
    watingCallbacks = null

    callback = (args...) ->
      cb(args...) for cb in callbacks
      return

    if err
      callback err
      return
    else
      initialized = true
      return callback
  
  (callback) ->
    context = @

    unless initialized
      if watingCallbacks?
        watingCallbacks.push callback
      else
        watingCallbacks = [callback]
        func.apply(context, [done])
    else
      callback null


_.mutex = (func, timeout = 20000) ->

  busy = false
  i = 0

  (args...) ->
    unless busy
      
      i++
      current = i
      busy = true

      done = ->
        busy = false if i == current
      
      func.apply(this, args.concat(done))

      setTimeout(done, timeout)

_.mutexDeferred = (func, timeout = 20000) ->

  deferred = null

  (args...) ->

    unless deferred
      
      deferred = func.apply(this, args)
      setTimeout((-> deferred = null), timeout) unless timeout < 0
      deferred.always -> deferred = null
      deferred

    else
      $.Deferred().reject("mutex").promise()

_.removeElement = (array, element) ->
  if (index = array.indexOf(element)) != -1
    array.splice(index, 1)


$.whenWithProgress = (args...) ->
    length = args.length
    pValues = new Array( length )
    firstParam = args[0]
    count = length
    pCount = length
    deferred = if length <= 1 && firstParam && jQuery.isFunction( firstParam.promise ) 
        firstParam
      else 
        jQuery.Deferred()
    promise = deferred.promise()
    
    resolveFunc = ( i ) ->
      ( value ) ->
        args[ i ] = if arguments.length > 1 then sliceDeferred.call( arguments, 0 ) else value
        if !( --count ) 
          deferred.resolveWith( deferred, args )
        else
          deferred.notifyWith( deferred, args )

    progressFunc = ( i ) ->
      ( value ) ->
        pValues[ i ] = if arguments.length > 1 then sliceDeferred.call( arguments, 0 ) else value
        deferred.notifyWith( promise, pValues )

    if length > 1
      for i in [0...length] 
        if args[ i ] && args[ i ].promise && jQuery.isFunction( args[ i ].promise )
          args[ i ].promise().then( resolveFunc(i), deferred.reject, progressFunc(i) )
        else
          --count
      unless count 
        deferred.resolveWith( deferred, args )
    else if deferred != firstParam
      deferred.resolveWith( deferred, if length then [ firstParam ] else [] )
    promise

class SimpleWorkerPool

  constructor : (@url, @workerLimit = 3) ->
    @queue = []
    @workers = []

  send : (data) ->

    for _worker in @workers when not _worker.busy
      worker = _worker
      break
    
    if not worker and @workers.length < @workerLimit
      worker = @spawnWorker()
    
    if worker
      worker.send(data)
    else
      @queuePush(data)
      

  spawnWorker : ->

    worker = new SimpleWorker(@url)
    worker.busy = false
    
    workerReset = =>
      worker.busy = false
      @queueShift(worker)

    worker.worker.onerror = (err) -> 
      console?.error(err)
      workerReset()

    worker.worker.addEventListener("message", workerReset, false)

    @workers.push(worker)

    worker
  
  queueShift : (worker) ->

    if @queue.length > 0 and not worker.busy
      { data, deferred } = @queue.shift()
      worker.send(data)
        .done (data) -> deferred.resolve(data)
        .fail (err) -> deferred.reject(err)
    
  queuePush : (data) ->

    deferred = $.Deferred()
    @queue.push { data, deferred }

class SimpleWorker

  constructor : (url) ->
    @worker = new Worker(url)

    @worker.onerror = (err) -> 
      console?.error(err)
  
  send : (data) ->  
    
    deferred = $.Deferred()

    workerHandle = data.workerHandle = Math.random()

    workerMessageCallback = (event) =>
      
      if (result = event.data).workerHandle == workerHandle
        @worker.removeEventListener("message", workerMessageCallback, false)
        if err = result.err
          deferred.reject(err)
        else 
          deferred.resolve(result)

    @worker.addEventListener("message", workerMessageCallback, false)
    @worker.postMessage(data)

    deferred.promise()

class SimpleArrayBufferSocket
  
  OPEN_TIMEOUT : 5000
  MESSAGE_TIMEOUT : 120000

  WebSocket : if (window ? self)['MozWebSocket'] then MozWebSocket else WebSocket
  FallbackMode : false
   
  constructor : (options) ->
    _.extend(@, options)
    @initializeWebSocket()
  
  initializeWebSocket : ->
    unless @socket
      socket = @socket = new @WebSocket(@url)
      openDeferred = @openDeferred = $.Deferred()

      switchToFallback = =>
        unless @fallbackMode
          @socket = null 
          @fallbackMode = true
          alert("Switching to ajax fallback mode.")

      socket.binaryType = 'arraybuffer'
      
      socket.onopen = -> openDeferred.resolve()
      
      socket.onerror = (err) ->
        console.error("socket error", err)
     
      socket.onclose = (code, reason) => 
        openDeferred.reject("closed")
        console?.error("socket closed", "#{code}: #{reason}")
        switchToFallback()
      
      setTimeout(=> 
        openDeferred.reject("timeout")
        if not @socket or @socket.readyState != @WebSocket.OPEN
          switchToFallback()
      , @OPEN_TIMEOUT)
    
    @openDeferred.promise()
  
  send : (data) ->

    deferred = $.Deferred()
    
    unless @fallbackMode

      @initializeWebSocket().done( =>

        padding = Math.max(@requestBufferType.BYTES_PER_ELEMENT, Float32Array.BYTES_PER_ELEMENT)
        
        transmitBuffer  = new ArrayBuffer(padding + data.byteLength)
        handleArray     = new Float32Array(transmitBuffer, 0, 1)
        handleArray[0]  = Math.random()
        socketHandle    = handleArray[0]

        dataArray = new @requestBufferType(transmitBuffer, padding)
        dataArray.set(data)

        socketCallback = (event) =>
          buffer = event.data
          handle = new Float32Array(buffer, 0, 1)[0]
          if handle == socketHandle
            @socket.removeEventListener("message", socketCallback, false)
            deferred.resolve(new @responseBufferType(buffer, 4))
        
        @socket.addEventListener("message", socketCallback, false)
        @socket.send(transmitBuffer)
        console?.log("socket-request", transmitBuffer)
      
        setTimeout((=> deferred.reject("timeout")), @MESSAGE_TIMEOUT)
      ).fail => @sendUsingFallback(data, deferred)
    
    else
      @sendUsingFallback(data, deferred)

    deferred.promise()
  
  sendUsingFallback : (data, deferred = $.Deferred()) ->
    
    request(
      data : data.buffer
      url : @fallbackUrl
      responseType : 'arraybuffer'
      (err, buffer) =>
        if err
          deferred.reject(err)
        else
          deferred.resolve(new @responseBufferType(buffer))
    )
    deferred.promise()

