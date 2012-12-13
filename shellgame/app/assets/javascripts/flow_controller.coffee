### define 
jquery : $
underscore : _
views : Views
kinetic : Kinetic
./playlist_adapter : PlaylistAdapter
./views/sequence_proxy : SequenceProxy
./debug/logger : Logger
./debug/diagnostics : Diagnostics
lib/event_mixin : EventMixin
lib/gesture_recognizer : GestureRecognizer
game_state : GameState
level : Level
###

class FlowController

  PRELOAD_DEPTH : 5

  constructor : (@el, playlist) ->

    @gameState = new GameState()
    @level = new Level(1)

    _.extend(this, new EventMixin())

    @logger = new Logger(@el)
    @diagnostics = new Diagnostics(@el)

    { @playlist, @graph, @cache } = new PlaylistAdapter(playlist).adapt()

    @$el = $(@el)
    @cache = {}

    pixelRatio = 1
    @stage = new Kinetic.Stage(
      container : @el
      width : @$el.width() * pixelRatio
      height : @$el.height() * pixelRatio
    )

    @setupEvents()

    @on "touch", (type, touches) =>
      @logger.logTouch("t#{type}", touches)
      @diagnostics.logTouch("t#{type}", touches)

    new (GestureRecognizer.TwoFingerPinch)(this).on "move", ({ matrix }) ->
      window.location.reload() if matrix[0] < .2
      return


    @setActive(@graph)


  setupEvents : ->

    propagateEvent = (event) =>

      data =
        targetTouches : []

      offset = @$el.offset()

      for touch in event.originalEvent.targetTouches
        data.targetTouches.push(
          clientX : touch.clientX - offset.left
          clientY : touch.clientY - offset.top
        )

      @trigger(event.type, data)
      @trigger("touch", event.type, data.targetTouches)
      @active?.trigger(event.type, data)
      return

    fallbackEvent = (type) =>
      (event) =>
        unless window.ontouchmove
          data = 
            targetTouches : []

          offset = @$el.offset()

          if event.clientX
            data.targetTouches.push(
              clientX : event.clientX - offset.left
              clientY : event.clientY - offset.top
            )
          
          @trigger("touch", type, data.targetTouches)
          @active?.trigger(type, data)


    @$el
      .on("touchmove", (event) -> event.preventDefault(); return)
      .on(
        touchstart : propagateEvent
        touchmove : propagateEvent
        touchend : propagateEvent
        mousedown : fallbackEvent("touchstart")
        mousemove : fallbackEvent("touchmove")
        mouseup : fallbackEvent("touchend")

      )


  setActive : (model) ->

    if @active?
      @active.layer.remove()
      delete @cache[@active.model.id] 

    view = @getView(model)
    view.render()
    @preload(model)
    @logger.logSequence(model.id)
    @diagnostics.logSequence(model.id)
    @active = view



  preload : (model, depth = @PRELOAD_DEPTH) ->

    view = @getView(model)
    if --depth
      for [ next ] in view.possibleNexts()
        @preload(next, depth)
    return



  getView : (model) ->

    return cachedView if (cachedView = @cache[model.id])?

    console.log "loading", model.id
    view = new SequenceProxy({ width : @stage.getWidth(), height : @stage.getHeight(), @stage }, model)
    view.load()
    view.on "next", @next
    view.on "change:position", (position) =>
      @diagnostics.logFrameNumber(position) if view == @active
    @cache[model.id] = view


  next : (model, position) =>

    @setActive(model)
    @active.setPosition(position) if position?



