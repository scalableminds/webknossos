### define
libs/request : Request
routes : routes
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  imageData : null

  constructor : ->

    @canvas = $("#preview-canvas")[0].getContext("2d")

    $slider = $("#preview-slider")
    $slider.on "change", =>
      @updatePreview()

    $("#dimension-modal").modal(
      show : true
      keyboard : false
      backdrop : "static"
    )

    $("#dimension-modal").on "submit", (event) =>

      event.preventDefault()

      dimensions = [
        parseInt( $("#dim-x").val() )
        parseInt( $("#dim-y").val() )
        parseInt( $("#dim-z").val() )
      ]

      $slider[0].max = dimensions[2]

      @requestStack(dimensions).done -> $("#dimension-modal").modal("hide")
      $("#dimension-modal").find("[type=submit]").addClass("disabled").prepend("<i class=\"icon-refresh icon-white rotating\"></i> ")





  requestStack : (dimensions) ->

    Request.send(
      routes.controllers.BinaryData.arbitraryViaAjax(dimensions...)
    )


  updatePreview : ->

    sliderValue = $("#preview-slider")[0].value


    # image = imageData.splice(  )

    # @canvas.putImageData()




