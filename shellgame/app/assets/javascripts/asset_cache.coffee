define [
  "underscore"
  "jquery"
  "kinetic"
  "require.json!../shellgameAssets/filemap"
], (_, $, Kinetic, filemap) ->


  class AssetCache

    ASPECT_RATIO : 480 / 320
    WIDTH : 480
    HEIGHT : 320

    invertedFilemap : do ->

      map = {}
      for own path, list of filemap
        for item, index in list
          map[item] = { path, index }
      map


    constructor : ->

      @requestAudio = _.memoize(@requestAudio)
      @requestImage = _.memoize(@requestImage)
      @requestRawImage = _.memoize(@requestRawImage)
      @drawingCanvas = _.memoize(@drawingCanvas)

      @cache = {}


    requestImage : (rawUrl) ->

      url = "/stacks/#{rawUrl}"
      mapping = @invertedFilemap[url] ? { path : url, index : 0 }

      @requestRawImage(mapping.path).pipe (rawImage) =>
        
        width = rawImage.width
        height = rawImage.width / @ASPECT_RATIO

        @cache[rawUrl] = new Kinetic.Image { 
          crop :
            x : 0
            y : height * mapping.index
            width : width
            height : height
          image : rawImage 
          width : @WIDTH
          height : @HEIGHT
        }


    requestRawImage : (url) ->

      deferred = new $.Deferred()
      image = new Image()

      $(image).on 

        load : =>
          deferred.resolve(image)

        error : ->
          deferred.reject("Image file #{url} not found.")
      
      image.src = url

      deferred.promise()


    requestAudio : (url) ->

      deferred = new $.Deferred()
      audio = new Audio()

      $(audio).on 

        canplaythrough : =>
          
          deferred.resolve(@cache[url] = audio)

        error : ->
          deferred.reject("Audio file #{url} not found.")

      audio.src = url
      audio.load()

      # hacky ios thing
      $(window).one "touchmove", -> audio.load(); return

      deferred.promise()


    get : (url) -> @cache[url]

    drawingCanvas : (width, height) ->

      canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height

      context = canvas.getContext("2d")
      { canvas, context }
