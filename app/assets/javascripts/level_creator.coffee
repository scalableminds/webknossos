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
  preplugin_renderer : null

  constructor : ->

    @levelName = $("#level-creator").data("level-id")

    @dimensions = [
      parseInt( $("#level-creator").data("level-width")  )
      parseInt( $("#level-creator").data("level-height") )
      parseInt( $("#level-creator").data("level-depth")  )
    ]

    @assetHandler = new AssetHandler(@levelName)
    @plugin_renderer = new PluginRenderer(@dimensions, @assetHandler)

    ####

    # editor init
    @editor = Ace.edit("editor")
    @editor.setTheme("ace/theme/twilight")
    @editor.getSession().setMode("ace/mode/coffee")

    $form = $("#editor-container").find("form")
    $saveCodeButton = $form.find("[type=submit]")
    $saveCodeButton.click => @updatePreview()

    @editor.on "change", =>

      @plugin_renderer.setCode(@editor.getValue())

      error = @plugin_renderer.compile()

      if _.isFunction(error)
        $saveCodeButton.removeClass("disabled").popover("destroy")

      else

        $saveCodeButton.addClass("disabled")
        $saveCodeButton.popover(
          placement : "right"
          title : "No good code. No save."
          content : error
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


  updatePreview : ->

    sliderValue = Math.floor(@$slider.val())
    
    imageData = @context.getImageData( 0, 0, @canvas.width, @canvas.height )

    imageData.data.set(@plugin_renderer.render(sliderValue))

    @context.putImageData(imageData, 0, 0)

    @$slider.prop( max : @plugin_renderer.getLength() )


  zoomPreview : ->

    zoomValue = $("#zoom-slider")[0].value

    { width, height } = @canvas

    $canvas = $(@canvas)
    $canvas.css(
      width : width * zoomValue
      height : height * zoomValue
    )



