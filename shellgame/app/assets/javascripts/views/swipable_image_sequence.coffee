define [
  "jquery"
  "underscore"
  "./image_sequence"
  "lib/gesture_recognizer"
  "lib/utils"
], ($, _, ImageSequence, GestureRecognizer, Utils) ->

  class SwipableImageSequence extends ImageSequence

    SWIPE_MIN_VELOCITY : .6
    SWIPE_MIN_DISTANCE_MULTIPLIER : .5
    SWIPE_END_FRICTION : .5
    IMAGE_GUTTER : 10

    className : "swipable-image-stack"

    constructor : ->

      super

      @position = 0

      @imageGroup = new Kinetic.Group()
      for image, i in @images
        image.setX(i * (@view.width + @IMAGE_GUTTER))
        @imageGroup.add(image)

      @layer.add(@imageGroup)

      @drag = new GestureRecognizer.OneFingerDrag(this)
      @drag.on

        move : (event) =>
          
          if deltaX = event.delta.startX

            if (deltaX > 0 and @position == 0) or (deltaX < 0 and @position == @length() - 1 and not @model.next)
              deltaX *= @SWIPE_END_FRICTION

            @imageGroup.setX(-@position * (@view.width + @IMAGE_GUTTER) + deltaX)
            @draw()


        end : (event) =>

          @imageGroup.transitionTo(
            x : -@position * (@view.width + @IMAGE_GUTTER)
            duration : .2
          )
          if Math.abs(event.velocity.overallX) > @SWIPE_MIN_VELOCITY or Math.abs(event.delta.startX) > @SWIPE_MIN_DISTANCE_MULTIPLIER * @width
            if event.delta.startX < 0
              if @position == @length() - 1
                @goNext()
              else
                @setPosition(@position + 1)
            else
              @setPosition(@position - 1)



    setPosition : (newPosition) ->

      newPosition = Utils.clamp(0, Math.floor(newPosition), @length() - 1)

      unless newPosition == @position

        @position = newPosition
        @imageGroup.transitionTo(
          x : -newPosition * (@view.width + @IMAGE_GUTTER)
          duration : .2
        )
        @trigger("change:position", @position)


    length : -> @images.length

    destroy : ->

      @drag.destroy()
      super

