Backbone = require("backbone")
_        = require("lodash")
$        = require("jquery")
app      = require("app")
Request  = require("libs/request")
Toast    = require("libs/toast")

class StateLogger

  PUSH_THROTTLE_TIME : 30000 #30s
  SAVE_RETRY_WAITING_TIME : 5000

  constructor : (@flycam, @version, @tracingId, @tracingType, @allowUpdate) ->

    _.extend(this, Backbone.Events)
    @mutexedPush = _.mutexDeferred(@pushImpl, -1)

    @newDiffs = []

    # Push state to server whenever a user moves
    @listenTo(@flycam, "positionChanged", @push)


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

    return @newDiffs.length == 0


  push : ->

    if @allowUpdate
      @pushThrottled()


  pushThrottled : ->
    # Pushes the buffered tracing to the server. Pushing happens at most
    # every 30 seconds.

    @pushThrottled = _.throttle(@mutexedPush, @PUSH_THROTTLE_TIME)
    @pushThrottled()


  pushNow : ->   # Interface for view & controller

    return @mutexedPush(false).then(
      -> Toast.success("Saved!")
      -> Toast.error("Couldn't save. Please try again.")
    )

  # alias for `pushNow`
  # needed for save delegation by `Model`
  # see `model.coffee`
  save : ->

      return @pushNow()


  pushImpl : (notifyOnFailure) ->

    if not @allowUpdate
      return new $.Deferred().resolve().promise()

    # TODO: remove existing updateTracing
    @concatUpdateTracing()

    diffsCurrentLength = @newDiffs.length
    console.log "Sending data: ", @newDiffs
    $.assert(@newDiffs.length > 0, "Empty update sent to server!", {
      @newDiffs
    })

    deferred = $.Deferred()

    Request.json(
      "/annotations/#{@tracingType}/#{@tracingId}?version=#{(@version + 1)}"
      method : "PUT"
      data : @newDiffs
    ).then(
      (response) =>
        @newDiffs = @newDiffs.slice(diffsCurrentLength)
        @version = response.version
        @pushDoneCallback()
        deferred.resolve()
      (responseObject) =>
        @pushFailCallback(responseObject, notifyOnFailure)
        deferred.resolve()
    )

    deferred.promise()


  pushFailCallback : (responseObject, notifyOnFailure) ->

    $('body').addClass('save-error')

    if responseObject.responseText? && responseObject.responseText != ""
      # restore whatever is send as the response
      try
        response = JSON.parse(responseObject.responseText)
      catch error
        console.error "parsing failed.", response
      if response?.messages?[0]?.error?
        if response.messages[0].error == "annotation.dirtyState"
          $(window).off("beforeunload")
          alert("""
            It seems that you edited the tracing simultaneously in different windows.
            Editing should be done in a single window only.

            In order to restore the current window, a reload is necessary.
          """)
          window.location.reload()

        else
          Toast.message(response.messages)


    setTimeout((=> @pushNow()), @SAVE_RETRY_WAITING_TIME)
    if notifyOnFailure
      @trigger("pushFailed")


  pushDoneCallback : ->

    @trigger("pushDone")
    $('body').removeClass('save-error')


module.exports = StateLogger
