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


M4x4.inverse = (mat) ->
  # cache matrix values
  a00 = mat[0]
  a01 = mat[1]
  a02 = mat[2]
  a03 = mat[3]
  a10 = mat[4]
  a11 = mat[5]
  a12 = mat[6]
  a13 = mat[7]
  a20 = mat[8]
  a21 = mat[9]
  a22 = mat[10]
  a23 = mat[11]
  a30 = mat[12]
  a31 = mat[13]
  a32 = mat[14]
  a33 = mat[15]
  b00 = a00 * a11 - a01 * a10
  b01 = a00 * a12 - a02 * a10
  b02 = a00 * a13 - a03 * a10
  b03 = a01 * a12 - a02 * a11
  b04 = a01 * a13 - a03 * a11
  b05 = a02 * a13 - a03 * a12
  b06 = a20 * a31 - a21 * a30
  b07 = a20 * a32 - a22 * a30
  b08 = a20 * a33 - a23 * a30
  b09 = a21 * a32 - a22 * a31
  b10 = a21 * a33 - a23 * a31
  b11 = a22 * a33 - a23 * a32

  # calculate determinant
  invDet = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06)

  dest = []
  dest[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet
  dest[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet
  dest[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet
  dest[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet
  dest[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet
  dest[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet
  dest[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet
  dest[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet
  dest[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet
  dest[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet
  dest[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet
  dest[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet
  dest[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet
  dest[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet
  dest[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet
  dest[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet

  return dest

M4x4.extractTranslation = (m) ->
  [m[12], m[13], m[14]]

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
  MESSAGE_TIMEOUT : 60000

  FallbackMode : false
   
  constructor : (options) ->
    _.extend(@, options)
    @initializeWebSocket()
  
  initializeWebSocket : ->
    unless @socket
      socket = @socket = new SimpleArrayBufferSocket.WebSocket(@url)
      openDeferred = @openDeferred = $.Deferred()

      socket.binaryType = 'arraybuffer'
      
      socket.onopen = -> openDeferred.resolve()
      
      socket.onerror = (err) ->
        console.error("socket error", err)
     
      socket.onclose = (code, reason) => 
        openDeferred.reject("closed")
        console?.error("socket closed", "#{code}: #{reason}")
        @switchToXHR()
      
      setTimeout(=> 
        openDeferred.reject("timeout")
        if not @socket or @socket.readyState != SimpleArrayBufferSocket.WebSocket.OPEN
          @switchToXHR()
      , @OPEN_TIMEOUT)
    
    @openDeferred.promise()
  
  switchToXHR : ->
    unless SimpleArrayBufferSocket.FallbackMode
      @socket = null 
      SimpleArrayBufferSocket.FallbackMode = true
      console?.log("switching to xhr")

  send : (data) ->

    deferred = $.Deferred()

    resolver = (result) ->
      deferred.resolve(result)

    unless SimpleArrayBufferSocket.FallbackMode
      @sendWithWebSocket(data)
        .done(resolver)
        .fail(=>
          @switchToXHR()
          @sendWithXHR(data).done(resolver)
        )
    else
      @sendWithXHR(data).done(resolver)

    deferred.promise()

  sendWithWebSocket : (data) ->
    
    @initializeWebSocket().pipe =>
      
      deferred = $.Deferred()

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
    
      setTimeout(( => 
        deferred.reject("timeout")
      ), @MESSAGE_TIMEOUT)

      deferred.promise()
  
  sendWithXHR : (data) ->
    
    request(
      data : data.buffer
      url : @fallbackUrl
      responseType : 'arraybuffer'
      (err, buffer) =>
        if err
          deferred.reject(err)
        else
          deferred.resolve(new @responseBufferType(buffer))
    ).pipe (buffer) => new @responseBufferType(buffer)

_window = window ? self
SimpleArrayBufferSocket.WebSocket = if _window.MozWebSocket then _window.MozWebSocket else _window.WebSocket
  
