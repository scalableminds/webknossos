### define
jquery : $
underscore : _
###

class Logger

  SAVE_RETRY_TIMEOUT : 10000
  SAVE_THROTTLE_TIME : 5000

  constructor : (@el) ->

    @startTime = Date.now()
    @sessionId = (new Array(21)).join("x").replace(/[xy]/g, (c) -> (Math.random() * 16 | 0).toString(16))
    @buffer = [ { time : @startTime, event : "init" } ]

    @$el = $(el)

    @save = _.throttle(@save, @SAVE_THROTTLE_TIME)
    @savedLength = 0
    @isSaving = false


  logTouch : (name, touches) ->

    touches = ({ x : a.clientX, y : a.clientY } for a in touches)
    @buffer.push(
      time : Date.now()
      event : name
      touches : touches
    )
    @save()
    

  logSequence : (id) ->

    @buffer.push(
      time : Date.now()
      event : "seq"
      sequence : id
    )
    @save()


  save : ->

    return if @isSaving

    start = @savedLength
    end = @buffer.length

    @isSaving = true

    if window.localStorage
      window.localStorage.setItem("shellgame-#{@sessionId}", @dump())

    $.ajax(
      url : "/log/#{@sessionId}"
      type : "POST"
      data : 
        log : "#{@buffer.slice(start, end).map(@dumpMap).join("\n")}"
    ).then(
      => 
        @savedLength = end
        @save() unless @savedLength == @buffer.length
      => 
        setTimeout(
          => @save()
          @SAVE_RETRY_TIMEOUT
        )
    ).always( 
      =>
        @isSaving = false
    )


  dumpMap : (a) ->

    if a.touches
      "#{a.event} #{a.time} #{a.touches.map( (b) -> "#{b.x},#{b.y}" ).join(" ")}" 
    else if a.sequence
      "#{a.event} #{a.time} #{a.sequence}"
    else
      "#{a.event} #{a.time}"


  dump : ->

    @buffer.map( @dumpMap ).join("\n")


    