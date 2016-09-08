$         = require("jquery")
Bootstrap = require("bootstrap")

$.fn.alertWithTimeout = (timeout = 3000) ->

  this.each ->

    $this = $(this)
    $this.alert()
    timerId = -1

    $this.hover(
      ->
        clearTimeout(timerId)
      ->
        timerId = setTimeout(
          -> $this.alert("close")
          timeout
        )
    )
    $(window).one "mousemove", -> $this.mouseout()


getToasts = (type, message) ->

  return $(".alert-#{type}[data-id='#{message}']")


shouldDisplayToast = (type, message, sticky) ->

  # Don't show duplicate sticky toasts
  return not sticky or getToasts(type, message).length == 0


Toast =

  message : (type, message, sticky = false) ->

    if _.isArray(type) and not message?
      messages = type
      for message in messages
        if message.success?
          return @success(message.success)
        if message.error?
          return @error(message.error)

    else if _.isArray(message)
      messages = message
      return (@message(type, message, sticky) for message in messages)

    else if shouldDisplayToast(type, message, sticky)
      $messageElement = $("<div>", class : "alert alert-#{type} fade in", "data-id" : message).html(message)
      $closeButton = $("<button>", type : "button", class : "close", "data-dismiss" : "alert").html("&times;")
      $messageElement.prepend($closeButton)
      if sticky
        $messageElement.alert()
      else
        timeout = if type == "danger" then 6000 else 3000
        $messageElement.alertWithTimeout(timeout)
      $("#alert-container").append($messageElement)

      if type == "danger"
        @highlight($messageElement)

      return {remove : -> $closeButton.click()}


  info : (message, sticky) ->

    return @message("info", message, sticky)


  warning : (message, sticky) ->

    return @message("warning", message, sticky)


  success : (message = "Success :-)", sticky) ->

    return @message("success", message, sticky)


  error : (message = "Error :-/", sticky) ->

    return @message("danger", message, sticky)


  highlight : (target) ->

    interval = setInterval(
      ->
        for i in [0..5]
          target.animate({right : "+=10px"}, 30).animate({right : "-=10px"}, 30)
        return
      5000
    )
    # clearInterval when the toast is removed
    target.on("closed.bs.alert", -> clearInterval(interval))


  delete : (type, message) ->

    getToasts(type, message).alert("close")


module.exports = Toast
