define [
  "underscore"
  "jquery"
  "./image_sequence"
  "lib/gesture_recognizer"
  "lib/matrix3"
  "lib/utils"
  "lib/event_mixin"
], (_, $, ImageSequence, GestureRecognizer, Matrix3, Utils, EventMixin) ->

  class ScrubbableImageSequence extends ImageSequence

    FRAME_TO_PIXEL_MULTIPLIER : 10
    INERTIA_VELOCITY_THRESHOLD : .1
    INERTIA_VELOCITY_MULTIPLIER : .5
    INERTIA_TICKER_INTERVAL : 1000 / 60
    INERTIA_MAX_VELOCITY : .30 # pixels / ms
    INERTIA_AUTO_VELOCITY : -.17

    constructor : ->

      super
      @setPosition(0)

      @imageGroup = new Kinetic.Group()
      @layer.add(@imageGroup)

      @progressBar = new Kinetic.Rect(
        x : 0
        y : @view.height - 10
        height : 10
        width : 0
        fill : "rgba(255, 255, 0, .8)"
      )
      @layer.add(@progressBar)

      @dragRecognizer = new GestureRecognizer.OneFingerDrag(this)
      @dragRecognizer.on

        "start" : =>

          @endInertia()

        "move" : (event) =>

          @movePositionByPixelDelta(event.delta.lastX)
          @draw()

        "end" : (event) =>

          @startInertia(event.velocity.overallX)


    destroy : ->

      @dragRecognizer.destroy()
      @tapRecognizer.destroy()

      super


    render : ->

      if autoMove = @model.options.autoMove
        @startInertia((if _.isNumber(autoMove) then -autoMove / @FRAME_TO_PIXEL_MULTIPLIER else @INERTIA_AUTO_VELOCITY), true) 


    startInertia : (velocity, skipThreshold = false) ->

      velocity *= @INERTIA_VELOCITY_MULTIPLIER

      velocity = if velocity < 0
        Math.max(velocity, -@INERTIA_MAX_VELOCITY)
      else
        Math.min(velocity, @INERTIA_MAX_VELOCITY)

      @endInertia()

      if skipThreshold or Math.abs(velocity) > @INERTIA_VELOCITY_THRESHOLD
        
        @inertiaTicker = window.setInterval(
          => 
            @movePositionByPixelDelta(@INERTIA_TICKER_INTERVAL * velocity)
            @draw()

            @endInertia() if @position == 0 or @position == @length() - 1

          @INERTIA_TICKER_INTERVAL
        )


    endInertia : ->

      window.clearInterval(@inertiaTicker) if @inertiaTicker


    movePositionByPixelDelta : (delta) ->

      @setPosition(@position - (delta / @FRAME_TO_PIXEL_MULTIPLIER))


    setPosition : (newPosition) ->

      unless newPosition == Utils.clamp(0, newPosition, @length() - 1)
        @endInertia()

      newPosition = Utils.clamp(0, newPosition, @length() - 1)
      @position = newPosition
      @trigger("change:position", newPosition)

      newPosition


    length : -> @images.length

    draw : ->

      @progressBar.setWidth(@position / (@length() - 1) * @view.width)

      flooredPosition = Math.floor(@position)
      delta = @position - flooredPosition

      @imageGroup.removeChildren()

      image0 = @images[flooredPosition]
      image0.setOpacity(1)
      @imageGroup.add(image0)

      if @model.options.enableFrameInterpolation and delta != 0
        image1 = @images[flooredPosition + 1]
        image1.setOpacity(delta)
        @imageGroup.add(image1)

      super
