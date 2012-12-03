### define
libs/request : Request
routes : routes
libs/ace/ace : Ace
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  imageData : null

  constructor : ->

    @data = null

    editor = Ace.edit("editor")
    editor.setTheme("ace/theme/twilight")
    editor.getSession().setMode("ace/mode/coffee")

    @canvas = $("#preview-canvas")[0]
    @context = @canvas.getContext("2d")

    $slider = $("#preview-slider")
    $slider.on "change", =>
      @updatePreview()

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



