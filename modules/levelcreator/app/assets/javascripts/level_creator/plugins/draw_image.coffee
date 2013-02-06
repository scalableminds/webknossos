### define 
../buffer_utils : BufferUtils
###


class Cloudify

  PUBLIC : true
  COMMAND : "drawImage()"
  FRIENDLY_NAME : "Draw Image"  
  DESCRIPTION : "Draws a image at a absolute position"
  PARAMETER :
    input :
      rgba: "Uint8Array"
      dimensions : '[]'
    name : "string"
    x : "Number"
    y : "Number"
  EXAMPLES : [
      { description : "Draw a image of a smiley", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  drawImage(name: \"smile.jpg\", x: 20, y: 20)"
        ]
      }
    ]    


  assetHandler : null


  constructor : (@assetHandler) ->


  execute : ({ input : { rgba, dimensions }, name, x, y}) ->

    { assetHandler } = @

    width = dimensions[0]
    height = dimensions[1]

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")
    image = assetHandler.getImage(name)
    
    context.drawImage(image, x || 0, y || 0)

    canvasData = context.getImageData(0, 0, width, height).data
    BufferUtils.alphaBlendBuffer(rgba, canvasData)

    rgba
