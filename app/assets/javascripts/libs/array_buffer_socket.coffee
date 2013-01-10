### define
libs/request : Request
###

class ArrayBufferSocket

  senderPointer : 0
  senders : []
  requestBufferType : Float32Array
  responseBufferType : Float32Array
  
  constructor : (options) ->

    _.extend(this, options)
    @sender = @senders[0]
    @sender.open(this)
  

  switchToNextSender : ->

    if @senderPointer + 1 < @senders.length
      @senderPointer++
      @sender.close()
      @sender = @senders[@senderPointer]
      @sender.open(this)


  send : (data, retryCount = 0) ->

    currentSenderPointer = @senderPointer
    @sender.send(data).pipe(
      null
      =>
        if currentSenderPointer != @senderPointer
          @send(data, retryCount + 1)
        else if retryCount < @senders.length
          @switchToNextSender()
          @send(data, retryCount + 1)
        else
          null
    )


class ArrayBufferSocket.WebSocket

  # Constants
  OPEN_TIMEOUT : 500
  MESSAGE_TIMEOUT : 10000


  constructor : (@url) ->

    @pendingRequests = new Array(256)
    @nextHandle = 0

  open : ({ @responseBufferType, @requestBufferType }) ->
    
    @initialize()


  initialize : ->

    unless @socket and @openDeferred

      unless @WebSocketImpl?
        return openDeferred.reject("No WebSocekt support").promise()

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
          
          request.reject("socket closed") for request in @pendingRequests when request?
          @pendingRequests.length = 0
          
          console?.error("socket closed", "#{code}: #{reason}")

        false
      )

      socket.addEventListener(
        "message"
        (event) =>

          buffer = event.data
          handle = new Uint8Array(buffer, buffer.byteLength - 1, 1)[0]
          
          request = @pendingRequests[handle]
            
          @pendingRequests[handle] = undefined

          if buffer.byteLength > 1
            request.resolve(new @responseBufferType(buffer, 0, (buffer.byteLength - 1) / @responseBufferType.BYTES_PER_ELEMENT))
          else
            request.reject()

          return
          
        false
      )
      
      setTimeout(
        => 
          if not @socket or @socket.readyState != @WebSocketImpl.OPEN
            openDeferred.reject("timeout")
        @OPEN_TIMEOUT
      )
    
    @openDeferred.promise()


  send : (data) ->

    @initialize().pipe =>
    
      { transmitBuffer, socketHandle } = @createPackage(data)

      deferred = $.Deferred()
      deferred.handle = socketHandle
      
      @pendingRequests[socketHandle] = deferred
      @socket.send(transmitBuffer)
    
      setTimeout(
        => 
          _.removeElement(@pendingRequests, deferred) if deferred.state() == "pending"
          deferred.reject("timeout")
        @MESSAGE_TIMEOUT
      )

      deferred.promise()


  close : ->

    if @socket
      @socket.close()
      @socket = null
      @openDeferred = null


  createPackage : (data) ->

    dataLength = if data.byteLength?
      data.byteLength
    else
      data.length * @requestBufferType.BYTES_PER_ELEMENT

    transmitBuffer = new ArrayBuffer(dataLength + 1)

    payloadBuffer = new @requestBufferType(transmitBuffer, 0, data.length)
    payloadBuffer.set(data)
    
    handleBuffer = new Uint8Array(transmitBuffer, dataLength, 1)
    socketHandle = handleBuffer[0] = @nextHandle

    @nextHandle = (@nextHandle + 1) % 256

    { transmitBuffer, socketHandle }


  _window = window ? self
  @prototype.WebSocketImpl = if _window.MozWebSocket then _window.MozWebSocket else _window.WebSocket


class ArrayBufferSocket.WebWorker

  # Constants
  OPEN_TIMEOUT : 500
  MESSAGE_TIMEOUT : 10000

  pendingRequests : []

  constructor : (@url) ->


  open : ({ @responseBufferType, @requestBufferType }) ->
    
    @initialize()


  initialize : ->

    unless @worker and @openDeferred

      unless @WebSocketImpl?
        return openDeferred.reject("No WebSocekt support").promise()

      openDeferred = @openDeferred = $.Deferred()

      @worker = new Worker('./assets/javascripts/model/pullworker.js')
      @worker.addEventListener(
        "message"
        (event) =>

          switch event.data.message
            
            when 'open'
              openDeferred.resolve()
            
            when 'error'
              console.error("socket error", event.error)
            
            when 'close'
              @worker = null
              request.reject("socket closed") for request in @pendingRequests
              @pendingRequests.length = 0
              console.error("socket closed", "#{event.data.closeCode}: #{event.data.closeReason}")
            
            when 'data'
              buffer = event.data.buffer
              handle = new Float32Array(buffer, 0, 1)[0]

              for request in @pendingRequests when request.handle == handle
   
                _.removeElement(@pendingRequests, request)
 
                if buffer.byteLength > 4
                  request.resolve(new @responseBufferType(buffer, 4))
                else
                  request.reject()

                break              
      )

      @worker.postMessage({ message: 'initialize', url: @url })

      setTimeout(
        => 
          if not @worker
            openDeferred.reject("timeout")
        @OPEN_TIMEOUT
      )
    
    @openDeferred.promise()


  send : (data) ->

    @initialize().pipe =>
    
      { transmitBuffer, socketHandle } = @createPackage(data)

      deferred = $.Deferred()
      deferred.handle = socketHandle

      @pendingRequests.push(deferred)
      @worker.webkitPostMessage({ message: 'send', buffer: transmitBuffer.buffer })

      setTimeout(
        => 
          _.removeElement(@pendingRequests, deferred) if deferred.state() == "pending"
          deferred.reject("timeout")
        @MESSAGE_TIMEOUT
      )

      deferred.promise()


  close : ->

    if @worker
      @worker.postMessage({ message: 'close' })
      @worker = null
      @openDeferred = null


  createPackage : (data) ->

    transmitBuffer    = new @requestBufferType(1 + data.length)
    transmitBuffer[0] = Math.random()
    transmitBuffer.set(data, 1)
    socketHandle      = transmitBuffer[0]

    { transmitBuffer, socketHandle }

  _window = window ? self
  @prototype.WebSocketImpl = if _window.MozWebSocket then _window.MozWebSocket else _window.WebSocket


class ArrayBufferSocket.XmlHttpRequest

  MESSAGE_TIMEOUT : 10000

  constructor : (@url) ->

  open : ({ @responseBufferType, @requestBufferType }) ->

  send : (data) ->

    data = new @requestBufferType(data) if _.isArray(data)
    Request.send(
      data : data
      url : @url
      dataType : 'arraybuffer'
      timeout : @MESSAGE_TIMEOUT
    ).pipe (buffer) =>

      if buffer
        new @responseBufferType(buffer)
      else
        []


  close : ->

ArrayBufferSocket