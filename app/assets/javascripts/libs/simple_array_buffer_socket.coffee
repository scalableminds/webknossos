### define
libs/request : Request
###

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
      @sender.open(@)


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
  MESSAGE_TIMEOUT : 20000

  pendingRequests : []

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
     
      socket.addEventListener(
        "close" 
        (code, reason) => 

          @socket = null
          
          request.reject("socket closed") for request in @pendingRequests
          @pendingRequests.length = 0
          
          console?.error("socket closed", "#{code}: #{reason}")

        false
      )

      socket.addEventListener(
        "message"
        (event) =>
          
          buffer = event.data
          handle = new Float32Array(buffer, 0, 1)[0]
          
          for request in @pendingRequests when request.handle == handle
            
            _.removeElement(@pendingRequests, request)

            if buffer.byteLength > 4
              request.resolve(new @responseBufferType(buffer, 4))
            else
              request.resolve([])
            
            break
        false
      )
      
      setTimeout(
        => 
          if not @socket or @socket.readyState != @WebSocketImpl.OPEN
            openDeferred.reject("timeout")
        @OPEN_TIMEOUT
      )
    
    @openDeferred.promise()


  close : ->
    if @socket
      @socket.close()
      @socket = null
      @openDeferred = null


  send : (data) ->

    @initialize().pipe =>
    
      { transmitBuffer, socketHandle } = @createPackage(data)

      deferred = $.Deferred()
      deferred.handle = socketHandle
      
      @pendingRequests.push(deferred)
      @socket.send(transmitBuffer.buffer)
    
      setTimeout(
        => 
          _.removeElement(@pendingRequests, deferred)
          deferred.reject("timeout")
        @MESSAGE_TIMEOUT
      )

      deferred.promise()


  createPackage : (data) ->

    transmitBuffer    = new @requestBufferType(1 + data.length)
    transmitBuffer[0] = Math.random()
    transmitBuffer.set(data, 1)
    socketHandle      = transmitBuffer[0]

    { transmitBuffer, socketHandle }


class SimpleArrayBufferSocket.XmlHttpRequest

  constructor : (@url) ->

  open : ({ @responseBufferType, @requestBufferType }) ->

  send : (data) ->
    data = new @requestBufferType(data) if _.isArray(data)
    Request(
      data : data.buffer
      url : @url
      responseType : 'arraybuffer'
    ).pipe (buffer) => 
    
      if buffer
        new @responseBufferType(buffer)
      else
        []

  close : ->

SimpleArrayBufferSocket
