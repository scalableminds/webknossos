### define
libs/request : Request
underscore : _
###

class ArrayBufferSocket

  senderPointer : 0
  senders : []
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


class ArrayBufferSocket.XmlHttpRequest

  MESSAGE_TIMEOUT : 10000

  constructor : (@url, @getParams, @type = "GET", @encoding = null) ->

  open : ({ @responseBufferType }) ->

  send : (data) ->

    # Build GET query string
    urlSuffix = ""
    prefix    = "?"
    for param of @getParams
      urlSuffix += prefix + param + "=" + @getParams[param]
      prefix     = "&"

    #data = new @requestBufferType(data) if _.isArray(data)
    Request.send(
      data : data
      url : @url + urlSuffix
      dataType : 'arraybuffer'
      timeout : @MESSAGE_TIMEOUT
      type : @type
      contentEncoding : @encoding
    ).then (buffer) =>

      if buffer
        new @responseBufferType(buffer)
      else
        []


  close : ->

ArrayBufferSocket
