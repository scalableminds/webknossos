### define
underscore : _
jquery : $
kinetic : Kinetic
asset_cache : AssetCache
./sequence : Sequence
lib/gesture_recognizer : GestureRecognizer
lib/utils : Utils
###

frameRangeTest = ([ a, b ], position, length) ->

  a += length if a < 0
  b += length if b < 0

  a <= position <= b or b <= position <= a


class ImageSequence extends Sequence

  assetCache : new AssetCache()

  constructor : ->

    super

    @images = @model.images.map (a) => @assetCache.get(a)

    @tapRecognizer = new GestureRecognizer.Tap(this)
    @tapRecognizer.on "end", (event) =>

      { clientX, clientY } = event.touch

      if @model.actions

        selectedAction = null
        defaultAction = null

        for action in @model.actions

          if action.frameRange and not frameRangeTest(action.frameRange, @position, @length())
            continue

          if target = action.target

            { x, y, radius } = target
            if radius * radius > Utils.distanceSquared(x - clientX, y - clientY)
              selectedAction = action
              break

          else
            defaultAction = action

        selectedAction = defaultAction if defaultAction and not selectedAction
        
        if selectedAction
          if selectedAction.audio
            audio = @assetCache.get(selectedAction.audio)
            audio.src = audio.src # hacky ios thing
            audio.play()

          if selectedAction.next
            @goNext(selectedAction.next)


  goNext : (next) ->

    next = @model.next unless next?
    
    if _.isObject(next[0])
      @trigger("next", next[0], next[1])

    else
      switch next[0]
        when ":next-frame" then @setPosition(@position + 1)
        when ":prev-frame" then @setPosition(@position - 1)

    return


  @load : (view, model, layer) ->

    Utils.whenWithProgress(
      @loadImages(model, view)
      @loadAudio(model)
    ).pipe( (assets) => new @(view, model, layer, assets) )


  @loadAudio : (model) ->

    return [] unless model.actions
    for action in model.actions when action.audio
      @prototype.assetCache.requestAudio(action.audio)


  @loadImages : (model) ->

    return [] unless model.images
    for imageUrl in model.images
      @prototype.assetCache.requestImage(imageUrl)

