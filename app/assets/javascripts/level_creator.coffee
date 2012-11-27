### define
libs/request : Request
###

class LevelCreator

  plugins : []
  stack : null
  canvas : null
  imageData : null

  constructor : ->

    @canvas = $("#previewCanvas").getContext("2d")
    $("#previewSlider").on "change", ->
      @updatePreview()

    $("requestButton").on "click", ->
      @requestStack()

  requestStack : ->

    dimensions =
      x : parseInt( $("#dimX").val() )
      y : parseInt( $("#dimY").val() )
      numSlides : parseInt( $("#dimZ").val() )

    Request.send(
      url : "/......."
      method : "GET"
      data : dimensions
      contentType : "application/json"
    )


  registerPlugin : ( plugin ) ->

    plugins.add plugin

  updatePreview : ->

    @canvas




