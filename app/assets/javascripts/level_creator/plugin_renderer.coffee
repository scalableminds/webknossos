### define
underscore : _
coffee-script : CoffeeScript
routes : Routes
libs/event_mixin : EventMixin
./plugins : Plugins
./buffer_utils : BufferUtils
###

class PluginRenderer

  constructor : (@dimensions, @assetHandler, @dataHandler) ->

    [ @width, @height, @depth ] = dimensions

    @plugins = new Plugins(@assetHandler)



  setCode : (code) ->

    @code = code


  testCompile : ->

    _.isFunction(@compile())


  compile : (code) ->

    functionBody = CoffeeScript.compile(@code, bare : true)
    func = new Function(
      "plugins"
      "with(plugins) { #{functionBody} }"
    )


  getLength : ->

    func = @compile()

    length = 0

    _plugins =

      time : (options) ->

        length = Math.max(options.end, length)
        (cb) -> cb()

      importSlides : ->

    (_plugins[key] = ->) for key of @plugins

    func(_plugins)

    length


  render : (t) ->

    pixelCount = @width * @height
    frameBuffer = new Uint8Array( 4 * pixelCount )
    return frameBuffer unless @dataHandler.deferred("initialized").state() == "resolved"

    func = @compile()

    startFrame = 0
    endFrame = 0

    inputData = null

    _plugins =

      time : (options) =>

        _.defaults(options, alpha : 1)
        startFrame = options.start
        endFrame = options.end


        if startFrame <= t <= endFrame
          (callback) =>
            inputData =
              rgba : new Uint8Array( 4 * pixelCount )
              segmentation : new Uint8Array( pixelCount )
              dimensions : @dimensions
              relativeTime : (t - startFrame) / (endFrame - startFrame)
              absoluteTime : t
            callback()
            BufferUtils.alphaBlendBuffer(frameBuffer, inputData.rgba, options.alpha)
            inputData = null
        else
          ->

      importSlides : (options) =>

        _.defaults(options, scale : "auto")

        if options.scale == "auto"
          options.scale = (options.end - options.start) / (endFrame - startFrame)

        slideOffset = (t - startFrame) * options.scale + options.start
        _.extend(inputData,
          rgba : @dataHandler.getRGBASlide( slideOffset )
          # segmentation : @dataHandler.getSegmentationSlide( slideOffset )
          dimensions : @dimensions
        )

        # @plugins.segmentImporter(input : inputData)


    for key, plugin of @plugins
      do (plugin) ->

        _plugins[key] = (options) ->
          options = {} unless options? #if plugin has no options

          _.extend( options, input : inputData )
          plugin.execute(options)

    func(_plugins)

    frameBuffer


