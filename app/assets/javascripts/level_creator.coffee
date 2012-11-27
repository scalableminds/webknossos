### define
libs/request : Request
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  imageData : null

  constructor : ->

    @canvas = $("#preview-canvas")[0].getContext("2d")

    $slider = $("#preview-slider")
    $slider.on "change", ->
      @updatePreview()

    $("#request-button").on "click", =>

      dimensions =
        x : parseInt( $("#dim-x").val() )
        y : parseInt( $("#dim-y").val() )
        numSlides : parseInt( $("#dim-z").val() )

      $slider[0].max = dimensions.numSlides

      @requestStack(dimensions)

    $("#dimension-modal").modal("show")


  requestStack : (dimensions) ->

    Request.send(
      url : "/......."
      method : "GET"
      data : dimensions
      contentType : "application/json"
    )


  updatePreview : ->

    sliderValue = $("#preview-slider")[0].value


    image = imageData.splice(  )

    @canvas.putImageData()




