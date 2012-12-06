### define
libs/request : Request
routes : routes
libs/ace/ace : Ace
coffee-script : CoffeeScript
view/toast : Toast
model/creator : Model
level_creator/asset_handler : AssetHandler
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  imageData : null
  model : null

  assetHandler : null

  constructor : ->

    @levelName = $("#level-creator").data("level-id")

    @data = null
    @assetHandler = new AssetHandler(@levelName)

    @model = new Model()

    # editor init
    @editor = Ace.edit("editor")
    @editor.setTheme("ace/theme/twilight")
    @editor.getSession().setMode("ace/mode/coffee")

    $form = $("#editor-container").find("form")
    $saveCodeButton = $form.find("[type=submit]")

    @editor.on "change", =>
      console.log(@compile())

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
      $zoomSlider.val(0)
      @zoomPreview()
    )

    dimensions = [
      parseInt( $("#level-creator").data("level-width")  )
      parseInt( $("#level-creator").data("level-height") )
      parseInt( $("#level-creator").data("level-depth")  )
    ]

    $slider[0].max = dimensions[2] - 1

    @canvas.width = dimensions[0]
    @canvas.height = dimensions[1]

    @requestStack(dimensions)


  compile : ->

    try

      functionBody = CoffeeScript.compile(@editor.getValue(), bare : true)
      func = new Function(
        "plugins"
        "with(plugins) { #{functionBody} }"
      )

      plugins =
        time : (t, data, options) ->

          if options.start <= t <= options.end
            (cb) -> cb()
          else
            return

        recolor : (color) ->
          console.log "recoloring #{color}"

        fadeOut : ->
          console.log "fading.."

      return func

    catch err

      return err.toString()




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

    sliderValue = $("#preview-slider")[0].value

    { width, height } = @canvas

    imageDataObject = @context.getImageData(0, 0, width, height)
    imageData = imageDataObject.data

    sourceData = @data

    indexSource = sliderValue * width * height
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

    @context.putImageData(imageDataObject, 0, 0)

  zoomPreview : ->

    zoomValue = $("#zoom-slider")[0].value
    factor = 50

    { width, height } = @canvas
    width  += factor * zoomValue
    height += factor * zoomValue

    $canvas = $(@canvas)
    $canvas.css("width", width)
    $canvas.css("height", height)



