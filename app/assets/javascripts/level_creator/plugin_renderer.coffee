### define
underscore : _
coffee-script : CoffeeScript
libs/request : Request
routes : Routes
./plugins : Plugins
./preprocessor : Preprocessor
###

class PluginRenderer

  constructor : (dimensions, @assetHandler) ->

    [ @width, @height, @depth ] = dimensions

    @plugins = new Plugins(@assetHandler)
    @preprocessor = new Preprocessor(@assetHandler)

    @func = null

    @requestStack(dimensions)


  requestStack : (dimensions) ->

    Request.send(
      _.extend(
        Routes.controllers.BinaryData.arbitraryViaAjax(dimensions...)
        dataType : "arraybuffer"
      )
    ).done (buffer) =>
      @data = { rgba : new Uint8Array(buffer) }


  setCode : (code) ->

    @code = code


  testCompile : ->

    _.isFunction(@compile())


  compile : (code) ->

    try

      functionBody = CoffeeScript.compile(@code, bare : true)
      func = new Function(
        "plugins"
        "with(plugins) { #{functionBody} }"
      )

      return func

    catch err

      return err.toString()


  getLength : ->

    func = @compile()

    length = 0

    _plugins =

      time : (options) ->

        length = Math.max(options.end, length)
        (cb) -> cb()

      importSlides : ->

    for key of @plugins

      _plugins[key] = ->

    func(_plugins)

    length


  render : (t) ->

    unless @data
      return new Uint8Array( @width * @height * 4 )

    func = @compile()

    startFrame = 0
    endFrame = 0

    frameBuffer = new Uint8Array( @width * @height * 4 )
    inputData = null

    _plugins =

      time : (options) =>

        startFrame = options.start
        endFrame = options.end

        if startFrame <= t <= endFrame
          (cb) =>
            cb()
            @alphaBlendBuffer(frameBuffer, inputData.rgba)
            inputData = null
        else
          ->

      importSlides : (options) =>

        _.defaults(options, scale : 1)

        inputData = 
          rgba : @getRGBASlide( (t - startFrame) * options.scale + options.start )


    for key, plugin of @plugins

      _plugins[key] = (options) ->

        _.extend( options, input : inputData )
        plugin.execute(options)

    func(_plugins)

    frameBuffer


  getGrayscaleSlide : (t) ->

    delta = t - Math.floor(t)

    slideLength = @width * @height

    lowerData = new Uint8Array(
      @data.rgba.subarray(Math.floor(t) * slideLength, Math.floor(t + 1) * slideLength)
    )

    return lowerData if delta == 0

    upperData = @data.rgba.subarray(Math.floor(t + 1) * slideLength, Math.floor(t + 2) * slideLength)

    for i in [0...slideLength] by 1
      lowerData[i] = lowerData[i] + delta * (upperData[i] - lowerData[i])

    lowerData


  getRGBASlide : (t) ->

    @copyGrayscaleBufferToRGBABuffer( @getGrayscaleSlide(t) )


  alphaBlendBuffer : (backgroundBuffer, foregroundBuffer) ->

    for i in [0...backgroundBuffer.length] by 4
      alphaForeground = foregroundBuffer[i + 3] / 255
      alphaBackground = backgroundBuffer[i + 3] / 255

      backgroundBuffer[i    ] = foregroundBuffer[i    ] * alphaForeground + backgroundBuffer[i    ] * alphaBackground * (1 - alphaForeground)
      backgroundBuffer[i + 1] = foregroundBuffer[i + 1] * alphaForeground + backgroundBuffer[i + 1] * alphaBackground * (1 - alphaForeground)
      backgroundBuffer[i + 2] = foregroundBuffer[i + 2] * alphaForeground + backgroundBuffer[i + 2] * alphaBackground * (1 - alphaForeground)
      backgroundBuffer[i + 3] = 255 * (alphaForeground + alphaBackground * (1 - alphaForeground))

    return


  copyGrayscaleBufferToRGBABuffer : ( source ) ->

    output = new Uint8Array( source.length * 4 )

    j = 0
    for i in [0...source.length]

        # r,g,b
        output[j++] = source[i]
        output[j++] = source[i]
        output[j++] = source[i]

        # alpha
        output[j++] = 255

    output
