define [
  "underscore"
  "jquery"
  "kinetic"
  "lib/event_mixin"
  "views"
  "./loading_view"
  "./error_view"
], (_, $, Kinetic, EventMixin, Views, LoadingView, ErrorView) ->

  class SequenceProxy

    constructor : (@view, @model) ->

      EventMixin.extend(this)

      @layer = new Kinetic.Layer()

      @layer.canvas.element.setAttribute("data-view", @model.id)

      @real = null
      @activeView = null

      @isLoading = false
      @isLoaded = false
      @isRendered = false

      @position = 0


    load : ->

      return if @isLoading or @isLoaded
      @isLoading = true

      @activeView = new LoadingView(@view, @layer)

      Views[@model.controller].load(@view, @model, @layer).then(
        
        (controller) =>

          @real = controller
          @real.passthrough(this, [ "touchstart", "touchmove", "touchend"])
          @passthrough(@real, [ "next", "change:position" ])

          @activeView.destroy()
          @activeView = null

          controller.setPosition(@position)
          controller.draw()

          controller.render() if @isRendered

          @isLoaded = true
          return

        (message) =>
          @activeView.destroy()
          @activeView = new ErrorView(@view, @layer, message)
          return

        (progress) =>
          @activeView?.setProgress?(progress)
          return

      ).always => @isLoading = false

      return


    possibleNexts : ->

      Views[@model.controller].possibleNexts(@model)


    setPosition : (pos) ->

      if @isLoaded
        @real.setPosition(pos)
        @real.draw()
      else
        @position = pos


    render : -> 

      @isRendered = true
      @view.stage.add(@layer)
      @real?.render()
      return
      
