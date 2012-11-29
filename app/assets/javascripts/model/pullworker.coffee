socket = null

initialize = (url) ->

  socket = new WebSocketImpl(url)
  socket.binaryType = 'arraybuffer'
      
  socket.onopen = ->
    postMessage({ message: 'open' })

  socket.onerror = (err) ->
    postMessage({ message: 'error', error: err })
     
  socket.addEventListener(
    "close" 
    (code, reason) => 

      @socket = null
          
      postMessage({ message: 'close' })
  )

  socket.addEventListener(
    "message"
    (event) =>
      webkitPostMessage({ message: 'data', buffer: event.data })
  )


send = (data) ->
  @socket.send(data)


close = ->

    if @socket
      @socket.close()
      @socket = null


WebSocketImpl = if self.MozWebSocket then self.MozWebSocket else self.WebSocket

self.onmessage = (message) ->

  switch message.data.message

    when 'initialize'
      initialize(message.data.url)

    when 'send'
      send(message.data.buffer)

    when 'close'
      close()
