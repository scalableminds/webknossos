### define
jquery : $
bootstrap : Bootstrap
###

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

Toast =

  message : (type, message, sticky = false) ->

    if _.isArray(type) and not message?
      messages = type
      for message in messages
        if message.success?
          @success(message.success)
        if message.error?
          @error(message.error)

    else if _.isArray(message)
      messages = messages
      @message(type, message, sticky) for message in messages

    else
      $messageElement = $("<div>", class : "alert alert-#{type} fade in").html(message)
      $messageElement.prepend($("<button>", type : "button", class : "close", "data-dismiss" : "alert").html("&times;"))
      if sticky
        $messageElement.alert()
      else
        $messageElement.alertWithTimeout()
      $("#alert-container").append($messageElement)

      if type == "danger"
        @highlight($messageElement)

    return


  info : (message, sticky) ->

    @message("info", message, sticky)


  success : (message, sticky) ->

    if message?
      @message("success", message, sticky)
    else
      @message("success", "Success :-)", sticky)


  error : (message, sticky = true) ->

    if message?
      @message("danger", message, sticky)
    else
      @message("danger", "Error :-/", sticky)


  highlight : (target) ->

    for i in [0..5]
      target.animate({right: "+=10px"}, 30).animate({right: "-=10px"}, 30)
    setTimeout(
      => @highlight(target)
      5000
    )


