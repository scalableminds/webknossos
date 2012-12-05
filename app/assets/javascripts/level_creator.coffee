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

    @data = null
    @assetHandler = new AssetHandler()

    @model = new Model()

    @editor = Ace.edit("editor")
    @editor.setTheme("ace/theme/twilight")
    @editor.getSession().setMode("ace/mode/coffee")

    @editor.on "change", => console.log(@compile())

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

    $("#dimension-modal").modal(
      show : true
      keyboard : false
      backdrop : "static"
    )

    $("#dimension-modal [type=submit]").on "click", (event) ->
      event.preventDefault() if $(this).hasClass("disabled")

    $("#dimension-modal").on "submit", (event) =>

      event.preventDefault()

      dimensions = [
        parseInt( $("#dim-x").val() )
        parseInt( $("#dim-y").val() )
        parseInt( $("#dim-z").val() )
      ]

      $slider[0].max = dimensions[2] - 1

      @canvas.width = dimensions[0]
      @canvas.height = dimensions[1]

      @requestStack(dimensions).done -> $("#dimension-modal").modal("hide")

      $("#dimension-modal").find("[type=submit]")
        .addClass("disabled")
        .prepend("<i class=\"icon-refresh icon-white rotating\"></i> ")


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

        time : (a, b) ->
          console.log "from #{a} > #{b}"
          (cb) -> cb()

        recolor : (color) ->
          console.log "recoloring #{color}"

        fadeOut : ->
          console.log "fading.."

      return func

    catch err

      return




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



