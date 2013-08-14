### define
libs/request : Request
libs/keyboard : KeyboardJS
libs/toast : Toast
routes : routes
libs/ace/ace : Ace
./level_creator/asset_handler : AssetHandler
./level_creator/data_handler : DataHandler
./level_creator/plugin_renderer : PluginRenderer
###

class LevelCreator

  EDIT_DEBOUNCE_TIME : 1000

  plugins : []
  stack : null
  canvas : null
  data : null

  assetHandler : null
  prepluginRenderer : null
  processing : false

  constructor : ->

    @levelId = $("#level-creator").data("level-id")
    @taskId = $("#level-creator").data("level-task-id")
    @dataSetName = $("#level-creator").data("level-dataset-name")

    @slidesBeforeProblem = parseInt $("#level-creator").data("level-slidesbeforeproblem") 
    @slidesAfterProblem = parseInt $("#level-creator").data("level-slidesafterproblem")

    @dimensions = [
      parseInt( $("#level-creator").data("level-width")  )
      parseInt( $("#level-creator").data("level-height") )
      @slidesBeforeProblem + @slidesAfterProblem
    ]

    @dataHandler = new DataHandler(@dimensions, @levelId, @taskId, @dataSetName)
    @assetHandler = new AssetHandler(@levelId)
    @pluginRenderer = new PluginRenderer(@dimensions, @slidesBeforeProblem, @slidesAfterProblem, @assetHandler, @dataHandler)

    #### code editor

    # editor init
    @editor = Ace.edit("editor")
    @editor.setTheme("ace/theme/twilight")
    @editor.getSession().setMode("ace/mode/coffee")
    @editor.getSession().setNewLineMode("unix")

    @$form = $("#save-form")
    @$saveCodeButton = @$form.find("[type=submit]")

    @editor.on "change", => @debouncedUpdatePreview()

    @$form.submit (event) =>

      event.preventDefault()

      return if @$saveCodeButton.hasClass("disabled")

      code = @editor.getValue()

      @$form.find("[name=code]").val(code)

      $.ajax(
        url : @$form[0].action
        data : @$form.serialize()
        type : "PUT"
      ).then(
        (data) =>
          Toast.success("Saved!")

          saveForm = @$form[0]
          produceButton = $("#produce-form .btn")[0]
          assetsForm = $("#assets-upload")[0]

          saveForm.action = saveForm.action.replace(@levelId, data.newId)
          assetsForm.action = assetsForm.action.replace(@levelId, data.newId)
          produceButton.href = $("#produce-form .btn")[0].href.replace(@levelId, data.newId)
          @assetHandler.levelId = @levelId

          heading = $("h3")
          heading.html("#{data.newName} #{heading.text().match(/#\d+/)[0]}")

          window.history.replaceState(null, "edit-#{data.newId}", window.location.href.replace(@levelId, data.newId))

        ->
          Toast.error(
            "Sorry, we couldn't save your code. Please try again."
            true
          )
      )

    KeyboardJS.on "super+s,ctrl+s", (event) =>
      event.preventDefault()
      event.stopPropagation()
      @$form.submit()

    #### preview

    @$canvas = $("#preview-canvas")
    @canvas = @$canvas[0]
    @context = @canvas.getContext("2d")

    @$slider = $("#preview-slider")
    @$slider.on "change", =>
      @updatePreview()

    #### zooming
    $zoomSlider = $("#zoom-slider")
    $zoomSlider.on "change", =>
      @zoomPreview()

    $("#zoom-reset").click =>
      $zoomSlider.val(1)
      @zoomPreview()

    @canvas.width = @dimensions[0]
    @canvas.height = @dimensions[1]


    #### clear state

    $("#clear-state").click (event) =>

      event.preventDefault()
      @pluginRenderer.state.clear()
      @updatePreview()

    
    #### resource init

    @assetHandler.on "initialized", => 
      @updatePreview()
      Toast.success("Assets loaded.")

    @dataHandler.on "initialized", => 
      @updatePreview()
      Toast.success("Slide data loaded.")

    #### headless init
    
    if window.callPhantom?
      $.when(
        @assetHandler.deferred("initialized")
        @dataHandler.deferred("initialized")
      ).then(
        => @prepareHeadlessRendering()
        (error) -> window.callPhantom( { message : "fatalError", error } )
      )


  debouncedUpdatePreview : ->

    @debouncedUpdatePreview = _.debounce(@updatePreview, @EDIT_DEBOUNCE_TIME)    
    @debouncedUpdatePreview()
    

  updatePreview : ->

    if @processing
      return

    sliderValue = @$slider.val()

    $("#preview-framelabel").html(sliderValue)
    
    imageData = @context.getImageData( 0, 0, @canvas.width, @canvas.height )

    @pluginRenderer.setCode(@editor.getValue())
    
    try

      { frameBuffer } = @pluginRenderer.render(sliderValue)
      imageData.data.set(frameBuffer)
      @context.putImageData(imageData, 0, 0)

      @$slider.prop( max : @pluginRenderer.getLength() )

      $("#preview-error").html("")
      @$saveCodeButton.removeClass("disabled").popover("destroy")

    catch error

      @$saveCodeButton
        .addClass("disabled")
        .popover(
          placement : "right"
          title : "No good code. No save."
          content : error
          trigger : "hover"
        )

      $("#preview-error").html("<i class=\"icon-warning-sign\"></i> #{error}")

    @processing = false


  zoomPreview : ->

    zoomValue = $("#zoom-slider")[0].value

    { width, height } = @canvas

    $canvas = $(@canvas)
    $canvas.css(
      width : width * zoomValue
      height : height * zoomValue
    )


  prepareHeadlessRendering : ->

    @$canvas.css(
      width : @canvas.width
      height : @canvas.height
    ).appendTo("body")

    $("body")
      .css(backgroundColor : "transparent")
      .children().filter(":not(#preview-canvas)").hide()

    window.callPhantom( 
      message : "initialized"
      length : @pluginRenderer.getLength()
      width : @canvas.width
      height : @canvas.height
    )


  headlessRendering : (t) ->

    imageData = @context.getImageData( 0, 0, @canvas.width, @canvas.height )
    imageDataData = imageData.data
    { frameBuffer, frameData } = @pluginRenderer.render(t)
    # HACK Phantom doesn't support Uint8ClampedArray yet
    for i in [0...frameBuffer.length] by 1
      imageDataData[i] = frameBuffer[i]
    @context.putImageData(imageData, 0, 0)

    if frameData?
      window.callPhantom({ message : "rendered", frameData })
    else
      window.callPhantom( message : "rendered" )





