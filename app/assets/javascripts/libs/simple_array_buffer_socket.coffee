define ["libs/request"], (request) ->
  
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
            console?.error("socket closed", "#{code}: #{reason}")
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
      
        deferred = $.Deferred()
        { transmitBuffer, socketHandle } = @createPackage(data)
        socket = @socket

        detachHandlers = ->
          socket.removeEventListener("message", socketMessageCallback, false)
          socket.removeEventListener("close", socketCloseCallback, false)
            
        socketMessageCallback = (event) =>
          buffer = event.data
          handle = new Float32Array(buffer, 0, 1)[0]
          if handle == socketHandle
            detachHandlers()
            deferred.resolve(new @responseBufferType(buffer, 4))

        socketCloseCallback = (event) ->
          detachHandlers()
          deferred.reject("socket closed")
        
        socket.addEventListener("message", socketMessageCallback, false)
        socket.addEventListener("close", socketCloseCallback, false)
        socket.send(transmitBuffer)
      
        setTimeout(
          -> 
            detachHandlers()
            deferred.reject("timeout")
          @MESSAGE_TIMEOUT
        )

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

  SimpleArrayBufferSocket
