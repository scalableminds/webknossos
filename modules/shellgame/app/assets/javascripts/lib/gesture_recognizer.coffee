### define
jquery : $
underscore : _
lib/event_mixin : EventMixin
lib/matrix3 : Matrix3
lib/utils : Utils
###

cloneTouch = (touch) ->

  { clientX : touch.clientX, clientY : touch.clientY }


class GestureRecognizer

  constructor : (@eventHost) ->

    _.extend(this, new EventMixin())

    @isActive = false

    @eventHost.on(
      touchstart : @onTouchStart
      touchmove : @onTouchMove
      touchend : @onTouchEnd
    )


  destroy : ->

    @eventHost.off(
      touchstart : @onTouchStart
      touchmove : @onTouchMove
      touchend : @onTouchEnd
    )


  cancel : ->

    @isActive = false


class GestureRecognizer.OneFingerDrag extends GestureRecognizer


  onTouchStart : (event) =>

    touches = event.targetTouches

    if touches.length == 1

      @isActive = true

      @startTouch = @lastTouch = cloneTouch(touches[0])
      @startTime  = @lastTime  = Date.now()

      @lastEventData = @eventData(event)
      @trigger("start", @lastEventData)

    else

      @cancel()

    return


  onTouchMove : (event) =>

    if @isActive

      touch = event.targetTouches[0]

      @lastEventData = @eventData(event)
      @lastTouch = cloneTouch(touch)
      @lastTime  = Date.now()

      @trigger("move", @lastEventData)

    return


  onTouchEnd : (event) =>

    if @isActive

      @trigger("end", @lastEventData)
      @cancel()

    return


  eventData : (event) ->

    touch = event.targetTouches[0]

    delta =
      startX : touch.clientX - @startTouch.clientX
      startY : touch.clientY - @startTouch.clientY
      startTime : Date.now() - @startTime

      lastX : touch.clientX - @lastTouch.clientX
      lastY : touch.clientY - @lastTouch.clientX
      lastTime : Date.now() - @lastTime

    delta.startDistance = Utils.distance(delta.startX, delta.startY)
    delta.lastDistance  = Utils.distance(delta.lastX, delta.lastY)

    velocity =
      overallX : delta.startX / delta.startTime
      overallY : delta.startY / delta.startTime
      overall  : delta.startDistance / delta.startTime

    { delta, velocity, touch, originalEvent : event }


class GestureRecognizer.TwoFingerPinch extends GestureRecognizer


  onTouchStart : (event) =>

    touches = event.targetTouches

    if touches.length == 2

      @isActive = true

      @startMatrix = [
        1, 0, 0
        0, 1, 0
        0, 0, 1
      ]

      [ touch0, touch1 ] = touches

      @startDistance = Utils.distance(
        touch1.clientX - touch0.clientX
        touch1.clientY - touch0.clientY
      )

      @startTouches = [
        cloneTouch(touch0)
        cloneTouch(touch1)
      ]

      @lastEventData = @eventData(event)

      @trigger("start", @lastEventData)

    else

      @cancel()

    return


  onTouchMove : (event) =>

    if @isActive

      @lastEventData = @eventData(event)
      @trigger("move", @lastEventData)

    return


  onTouchEnd : (event) =>

    if @isActive

      @trigger("end", @lastEventData)
      @cancel()

    return


  eventData : (event) ->

    [ touch0, touch1 ] = event.targetTouches

    deltaScale = Utils.distance(
      touch1.clientX - touch0.clientX
      touch1.clientY - touch0.clientY
    ) / @startDistance

    deltaX = touch0.clientX - @startTouches[0].clientX
    deltaY = touch0.clientY - @startTouches[0].clientY

    {
      matrix :
        Matrix3.translate(
          Matrix3.scale(
            Matrix3.translate(
              Matrix3.translate(@startMatrix, deltaX, deltaY)
              - touch0.clientX
              - touch0.clientY
            )
            deltaScale
          )
          touch0.clientX,
          touch0.clientY
        )
      touches : [ touch0, touch1 ]
      originalEvent : event
    }


class GestureRecognizer.Tap extends GestureRecognizer

  MOVEMENT_THRESHOLD : 10

  onTouchStart : (event) =>

    touches = event.targetTouches

    if touches.length == 1

      @isActive = true

      @startTouch = cloneTouch(touches[0])

      @trigger("start",
        touch : @startTouch
        originalEvent : event
      )

    return


  onTouchMove : (event) =>

    if @isActive

      touch = event.targetTouches[0]

      unless @startTouch.clientX - @MOVEMENT_THRESHOLD <= touch.clientX <= @startTouch.clientX + @MOVEMENT_THRESHOLD and
      @startTouch.clientY - @MOVEMENT_THRESHOLD <= touch.clientY <= @startTouch.clientY + @MOVEMENT_THRESHOLD
        @cancel()

    return


  onTouchEnd : (event) =>

    if @isActive

      @trigger("end",
        touch : @startTouch
        originalEvent : event
      )
      @cancel()

    return

GestureRecognizer
