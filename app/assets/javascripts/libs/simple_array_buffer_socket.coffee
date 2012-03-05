class SimpleArrayBufferSocket
  
  fallbackMode : false
  
  constructor : (options) ->
    _.extend(@, options)
    @sender = @defaultSender
    @sender.open(@)
  
  switchToFallback : ->
    unless @fallbackMode
      @sender.close()
      @fallbackMode = true
      @sender = @fallbackSender
      @sender.initialize(@)

  send : (data) ->

    deferred = $.Deferred()

    resolver = (result) ->
      deferred.resolve(result)

    @sender.send(data)
      .done(resolver)
      .fail( =>
        unless @fallbackMode
          @switchToFallback()
          @send(data).done(resolver)
        else
          deferred.reject()
      )

    deferred.promise()


class SimpleArrayBufferSocket.WebSocket

  OPEN_TIMEOUT : 5000
  MESSAGE_TIMEOUT : 60000

  constructor : (@url) ->
    _window = window ? self
    @WebSocketImpl = if _window.MozWebSocket then _window.MozWebSocket else _window.WebSocket


  open : ({ @responseBufferType, @requestBufferType }) ->
    @initialize()

  initialize : ->

    unless @socket and @openDeferred

      socket = @socket = new @WebSocketImpl(@url)
      openDeferred = @openDeferred = $.Deferred()

      socket.binaryType = 'arraybuffer'
      
      socket.onopen = -> openDeferred.resolve()
      
      socket.onerror = (err) ->
        console.error("socket error", err)
     
      socket.onclose = (code, reason) => 
        openDeferred.reject("closed")
        console?.error("socket closed", "#{code}: #{reason}")
      
      setTimeout(=> 
        if not @socket or @socket.readyState != @WebSocketImpl.OPEN
          openDeferred.reject("timeout")
      , @OPEN_TIMEOUT)
    
    @openDeferred.promise()

  close : ->
    if @socket
      @socket.close()
      @socket = null
      @openDeferred = null

  send : (data) ->

    @initialize().pipe =>
    
      deferred = $.Deferred()
      { transmitBuffer, socketHandle } = @createPackage(data)

      socketCallback = (event) =>
        buffer = event.data
        handle = new Float32Array(buffer, 0, 1)[0]
        if handle == socketHandle
          @socket.removeEventListener("message", socketCallback, false)
          deferred.resolve(new @responseBufferType(buffer, 4))
      
      @socket.addEventListener("message", socketCallback, false)
      @socket.send(transmitBuffer)
    
      setTimeout(( => 
        deferred.reject("timeout")
      ), @MESSAGE_TIMEOUT)

      deferred.promise()

  createPackage : (data) ->

    padding = Math.max(@requestBufferType.BYTES_PER_ELEMENT, Float32Array.BYTES_PER_ELEMENT)
    
    transmitBuffer  = new ArrayBuffer(padding + data.byteLength)
    handleArray     = new Float32Array(transmitBuffer, 0, 1)
    handleArray[0]  = Math.random()
    socketHandle    = handleArray[0]

    dataArray = new @requestBufferType(transmitBuffer, padding)
    dataArray.set(data)

    { transmitBuffer, socketHandle }


class SimpleArrayBufferSocket.XmlHttpRequest

  constructor : (@url) ->

  open : ({ @responseBufferType, @requestBufferType }) ->

  send : (data) ->
    request(
      data : data.buffer
      url : @url
      responseType : 'arraybuffer'
    ).pipe (buffer) => new @responseBufferType(buffer)

  close : ->

# define SimpleArrayBufferSocket