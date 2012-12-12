define [
  "underscore"
  "jquery"
  "kinetic"
], (_, $, Kinetic) ->

  class LoadingView

    constructor : (@view, @layer) ->

      @progress = 0

      @filling = new Kinetic.Rect(
        fill : "#0c0"
        height : 10
        width : 0
        x : 20
        y : @view.height / 2 - 5
      )
      @layer.add(@filling)

      @border = new Kinetic.Rect(
        stroke : "#444"
        strokeWidth : 4
        cornerRadius : 5
        height : 10
        width : @view.width - 40
        x : 20
        y : @view.height / 2 - 5
      )
      @layer.add(@border)


    setProgress : (newProgress) ->

      if newProgress != @progress and 0 <= newProgress <= 1

        @progress = newProgress

        @filling.setWidth(@progress * (@view.width - 40))
        @layer.draw()


    destroy : ->

      @border.remove()
      @filling.remove()