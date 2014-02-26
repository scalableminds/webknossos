### define
underscore : _
jquery : $
libs/request : Request
libs/event_mixin : EventMixin
three : THREE
###

class StateLogger

  PUSH_THROTTLE_TIME : 30000 #30s

  constructor : (@flycam, @version, @tracingId, @tracingType, @allowUpdate) ->

    _.extend(this, new EventMixin())

    @committedDiffs = []
    @newDiffs = []
    @committedCurrentState = true

    @failedPushCount = 0


  pushDiff : (action, value, push = true) ->

    @newDiffs.push({
      action : action
      value : value
    })
    # In order to assure that certain actions are atomic,
    # it is sometimes necessary not to push.
    if push
      @push()


  concatUpdateTracing : ->

    throw new Error("concatUpdateTracing has to be overwritten by subclass!")


  #### SERVER COMMUNICATION

  stateSaved : ->

    return @committedCurrentState and @committedDiffs.length == 0


  push : ->

    if @allowUpdate
      @committedCurrentState = false
      @pushThrottled()


  pushThrottled : ->
    # Pushes the buffered tracing to the server. Pushing happens at most 
    # every 30 seconds.

    saveFkt = => @pushImpl(true)
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), @PUSH_THROTTLE_TIME)
    @pushThrottled()


  pushNow : ->   # Interface for view & controller 

    return @pushImpl(false)


  pushImpl : (notifyOnFailure) ->
    
    # do not allow multiple pushes, before result is there (breaks versioning)
    # still, return the deferred of the pending push, so that it will be informed about success
    if @pushDeferred?
      return @pushDeferred

    @pushDeferred = new $.Deferred()

    # reject and null pushDeferred if the server didn't answer after 10 seconds
    setTimeout(((version) =>
      if @pushDeferred and version == @version
        @pushDeferred.reject()
        @pushDeferred = null
        console.error "Server did take too long to answer"),
      10000, @version)

    @committedDiffs = @committedDiffs.concat(@newDiffs)
    @newDiffs = []
    @committedCurrentState = true
    data = @concatUpdateTracing(@committedDiffs)
    console.log "Sending data: ", data

    Request.send(
      url : "/annotations/#{@tracingType}/#{@tracingId}?version=#{(@version + 1)}"
      method : "PUT"
      data : data
      contentType : "application/json"
    )
    .fail (responseObject) =>
      
      @failedPushCount++

      if responseObject.responseText? && responseObject.responseText != ""
        # restore whatever is send as the response
        try
          response = JSON.parse(responseObject.responseText)
        catch error
          console.error "parsing failed."
        if response?.messages?[0]?.error?
          if response.messages[0].error == "tracing.dirtyState"
            $(window).on(
              "beforeunload"
              =>return null)
            alert("Sorry, but the current state is inconsistent. A reload is necessary.")
            window.location.reload()
      
      @push()
      if notifyOnFailure
        @trigger("pushFailed", @failedPushCount >= 3 )
      if @pushDeferred
        @pushDeferred.reject()
        @pushDeferred = null

    .done (response) =>
      
      @failedPushCount = 0
      
      @version = response.version
      @committedDiffs = []
      if @pushDeferred
        @pushDeferred.resolve()
        @pushDeferred = null
