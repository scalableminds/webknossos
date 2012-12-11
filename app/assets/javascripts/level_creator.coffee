### define
libs/request : Request
libs/keyboard : KeyboardJS
libs/toast : Toast
routes : routes
libs/ace/ace : Ace
./level_creator/asset_handler : AssetHandler
./level_creator/plugin_renderer : PluginRenderer
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  data : null
  model : null

  assetHandler : null
  prepluginRenderer : null

  constructor : ->

    @levelName = $("#level-creator").data("level-id")

    @dimensions = [
      parseInt( $("#level-creator").data("level-width")  )
      parseInt( $("#level-creator").data("level-height") )
      parseInt( $("#level-creator").data("level-depth")  )
    ]

    @assetHandler = new AssetHandler(@levelName)
    @pluginRenderer = new PluginRenderer(@dimensions, @assetHandler)

    ####

    # editor init
    @editor = Ace.edit("editor")
    @editor.setTheme("ace/theme/twilight")
    @editor.getSession().setMode("ace/mode/coffee")

    @$form = $("#editor-container form")
    @$saveCodeButton = @$form.find("[type=submit]")
    @$saveCodeButton.click => @updatePreview()

    @editor.on "change", => @updatePreview()

    @$form.submit (event) =>

      event.preventDefault()

      return if @$saveCodeButton.hasClass("disabled")

      code = @editor.getValue()

      @$form.find("[name=code]").val(code)

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
      @$form.submit()

    ####

    @$canvas = $("#preview-canvas")
    @canvas = @$canvas[0]
    @context = @canvas.getContext("2d")

    @$slider = $("#preview-slider")
    @$slider.on "change", =>
      @updatePreview()

    # zooming
    $zoomSlider = $("#zoom-slider")
    $zoomSlider.on "change", =>
      @zoomPreview()

    $("#zoom-reset").click =>
      $zoomSlider.val(1)
      @zoomPreview()

    @canvas.width = @dimensions[0]
    @canvas.height = @dimensions[1]

    ####

    @assetHandler.on "initialized", => @updatePreview()
    @pluginRenderer.on "initialized", => @updatePreview()

    if window.callPhantom?
      @assetHandler.on "initialized", =>
        @prepareHeadlessRendering()
      

  updatePreview : ->

    sliderValue = Math.floor(@$slider.val())
    
    imageData = @context.getImageData( 0, 0, @canvas.width, @canvas.height )

    @pluginRenderer.setCode(@editor.getValue())
    
    try

      frameBuffer = @pluginRenderer.render(sliderValue)
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
      position : "fixed"
      top : 0
      left : 0
      width : @canvas.width
      height : @canvas.height
      zIndex : 2000
    )

    window.callPhantom( 
      message : "initialized"
      length : @pluginRenderer.getLength()
      width : @canvas.width
      height : @canvas.height
    )


  headlessRenderung : (t) ->

    window.callPhantom( message : "rendered" )





