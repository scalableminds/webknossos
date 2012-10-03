### define
libs/request : Request
libs/event_mixin : EventMixin
###


class JsonSocket
  
  senderPointer : 0
  senders : []
  
  constructor : (options) ->

    _.extend(this, options)
    _.extend(this, new EventMixin())

    senderDataCallback = (args...) =>
      @trigger( "data", args... )

    for sender in @senders
      sender.on "data", senderDataCallback

    @sender = @senders[0]
    @sender.open()


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


class JsonSocket.WebSocket

  OPEN_TIMEOUT : 500

  openDeferred : null

  constructor : (@url) ->

    _.extend(this, new EventMixin())


  open : ->

    unless @socket and @openDeferred

      socket = @socket = new @WebSocketImpl(@url)
      openDeferred = @openDeferred = $.Deferred()
      
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

      socket.addEventListener(
        "message"
        (event) => 
          data = null
          try
            data = JSON.parse(event.data)
          catch error
            console.error("JsonSocket.WebSocket: #{error}")

          @trigger("data", data) if data?
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


  send : (data) ->

    @open().pipe => 

      @socket.send(JSON.stringify(data))
      return


  _window = window ? self
  @prototype.WebSocketImpl = if _window.MozWebSocket then _window.MozWebSocket else _window.WebSocket


class JsonSocket.Comet

  iframeElement : null
  globalCallbackName : ""

  constructor : (@url) ->

    _.extend(this, new EventMixin())
    @globalCallbackName = "callback_#{Math.round(Math.random() * 10000)}"


  open : ->

    window[@globalCallbackName] = (data) =>
      @trigger("data", data)

    @iframeElement = $("<iframe>", src : "#{@url}&callback=#{@globalCallbackName}").hide()
    $("body").append(@iframeElement)


  send : (data) ->

    Request.send({ data, @url, type : "POST" })


  close : ->

    @iframeElement.remove()
    @iframeElement = null
    delete window[@globalCallbackName]


JsonSocket