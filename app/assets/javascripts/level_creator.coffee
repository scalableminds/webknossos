### define
libs/request : Request
libs/keyboard : KeyboardJS
libs/toast : Toast
routes : routes
libs/ace/ace : Ace
coffee-script : CoffeeScript
./level_creator/asset_handler : AssetHandler
./level_creator/plugins : Plugins
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  data : null
  model : null

  assetHandler : null

  constructor : ->

    @levelName = $("#level-creator").data("level-id")

    @data = null
    @assetHandler = new AssetHandler(@levelName)

    # editor init
    @editor = Ace.edit("editor")
    @editor.setTheme("ace/theme/twilight")
    @editor.getSession().setMode("ace/mode/coffee")

    $form = $("#editor-container").find("form")
    $saveCodeButton = $form.find("[type=submit]")
    $saveCodeButton.click( => @execute())

    @editor.on "change", =>

      code = @compile()
      if code instanceof Function
        $saveCodeButton.removeClass("disabled").popover("destroy")

      else

        $saveCodeButton.addClass("disabled")
        $saveCodeButton.popover(
          placement : "right"
          title : "No good code. No save."
          content : code
          trigger : "hover"
        )

    @editor._emit("change") # init

    $form.submit (event) =>

      event.preventDefault()

      return if $saveCodeButton.hasClass("disabled")

      code = @editor.getValue()

      $form.find("[name=code]").val(code)

      $.ajax(
        url : $form[0].action
        data : $form.serialize()
        type : "POST"
      ).then(
        ->
          Toast.success("Saved!")
        ->
          Toast.error(
            """Sorry, we couldn't save your code. Please double check your syntax.<br/>
            Otherwise, please copy your code changes and reload this page."""
            true
          )
      )

    KeyboardJS.on "super+s,ctrl+s", (event) =>
      event.preventDefault()
      event.stopPropagation()
      $saveCodeButton.click()

    ####

    @canvas = $("#preview-canvas")[0]
    @context = @canvas.getContext("2d")

    $slider = $("#preview-slider")
    $slider.on "change", =>
      @updatePreview()

    # zooming
    $zoomSlider = $("#zoom-slider")
    $zoomSlider.on "change", =>
      @zoomPreview()

    $("#zoom-reset").click( =>
      $zoomSlider.val(1)
      @zoomPreview()
    )

    @dimensions = [
      parseInt( $("#level-creator").data("level-width")  )
      parseInt( $("#level-creator").data("level-height") )
      parseInt( $("#level-creator").data("level-depth")  )
    ]

    $slider[0].max = @dimensions[2] - 1

    @canvas.width = @dimensions[0]
    @canvas.height = @dimensions[1]

    @requestStack(@dimensions)

    ####

    @plugins = new Plugins()


  compile : ->

    try

      functionBody = CoffeeScript.compile(@editor.getValue(), bare : true)
      func = new Function(
        "plugins"
        "with(plugins) { #{functionBody} }"
      )

      return func

    catch err

      return err.toString()


  currentLength : ->

    func = @compile()

    length = 0

    _plugins =

      time : (options) ->

        length = Math.max(options.end, length)
        (cb) -> cb()

    for key of @plugins

      _plugins[key.toLowerCase()] = ->

    func(_plugins)

    length


  execute : ->

    unless @data
      return

    func = @compile()

    startFrame = 0
    endFrame = 0

    slider = $("#preview-slider")[0]
    sliderValue = Math.floor(slider.value)

    inputDataObject = @copyArrayBufferToImageBuffer(new Uint8Array(@data),0)
    inputData = inputDataObject.data
    _plugins =


      time : (options) =>

        startFrame = options.start
        endFrame = options.end

        console.log sliderValue

        if startFrame <= sliderValue <= endFrame
          (cb) -> cb()
        else
          ->

      importSlides : (options) =>

        index = ( sliderValue ) * 250  *  150
        inputData = @interpolateFrame(inputData, index, true )

    for key, plugin of @plugins

      _plugins[key.toLowerCase()] = (options) ->

        _.extend( options, input : { rgba : inputData } )
        inputData = plugin.execute(options)

    func(_plugins)

    inputDataObject.data.set(inputData)
    @inputData = inputDataObject
    @updateOutput()


  requestStack : (dimensions) ->

    Request.send(
      _.extend(
        routes.controllers.BinaryData.arbitraryViaAjax(dimensions...),
        dataType : "arraybuffer"
      )
    ).done (buffer) =>
      @data = new Uint8Array(buffer)
      @updatePreview()


  updatePreview : ->

    return unless @data

    slider = $("#preview-slider")[0]
    sliderValue = Math.floor(slider.value)

    imageData = @copyArrayBufferToImageBuffer(@data, sliderValue)
    @context.putImageData(imageData, 0, 0)

  updateOutput : ->
    canvas = $("#output-canvas")[0]
    context = canvas.getContext("2d")
    context.putImageData(@inputData, 0, 0)

  copyArrayBufferToImageBuffer : ( arrayBuffer, frameIndex ) ->
    sourceData = arrayBuffer
    { width, height } = @canvas

    imageDataObject = @context.getImageData(0, 0, width, height)
    imageData = imageDataObject.data

    indexSource = frameIndex * width * height
    indexTarget = 0

    for x in [0...width]
      for y in [0...height]

        # r,g,b
        imageData[indexTarget++] = sourceData[indexSource]
        imageData[indexTarget++] = sourceData[indexSource]
        imageData[indexTarget++] = sourceData[indexSource]

        # alpha
        imageData[indexTarget++] = 255
        indexSource++
    imageDataObject

  interpolateFrame : (@sourceData, index, interpolation) ->

    outputData = new Uint8Array(sourceData)
    t = index - Math.floor(index)

    upperIndex = Math.floor(index) + 1
    lowerIndex = Math.floor(index)
    indexTarget = index

    { width, height } = @canvas

    for x in [0...width]
      for y in [0...height]

        data = lowerData = sourceData[lowerIndex]

        if interpolation
          upperData = sourceData[upperIndex]
          data = lowerData + t * (upperData - lowerData)

        # rgb values
        outputData[indexTarget++] = data
        outputData[indexTarget++] = data
        outputData[indexTarget++] = data

        upperIndex++
        lowerIndex++

    outputData



  zoomPreview : ->

    zoomValue = $("#zoom-slider")[0].value

    { width, height } = @canvas

    $canvas = $(@canvas)
    $canvas.css(
      width : width * zoomValue
      height : height * zoomValue
    )



