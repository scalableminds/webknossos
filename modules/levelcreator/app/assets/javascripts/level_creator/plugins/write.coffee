### define 
../buffer_utils : BufferUtils
###


class Write

  PUBLIC : true
  COMMAND : "write()"
  FRIENDLY_NAME : "Write"  
  DESCRIPTION : "Writes text on a given position"
  PARAMETER :
    input :
      rgba: "Uint8Array"
      dimensions : '[]'
    color : "\"rgba(0, 0, 255, 0.9)\""
    text : "string"
    x : "Number"
    y : "Number"
    style : "\"normal\", \"italic\", \"oblique\""
    weigth : "\"normal\", \"bold\", \"bolder\", \"lighter\""
    size : "Number"
    family : "\"Arial\", \"Verdana\", \"serif\", \"Courier New\""
    align : "\"left\", \"center\", \"right\" "
  EXAMPLES : [
      { description : "Writes blue text", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  write(x: 30, y: 100, text : \"Hallo Developer\", color : \"rgba(255, 255, 255, 0.9)\", size: 20, weigth: \"bold\")"
        ]
      }
    ]    


  constructor : () ->

    @cloud = new Image()
    @cloud.src = "/assets/images/cloud32.png"   
    @cloud.onload = => @ready = true


  execute : ({ input : { rgba, dimensions }, color, text, x, y, family, size, weigth, style, align}) ->

    width = dimensions[0]
    height = dimensions[1]

    canvas = $("<canvas>")[0]
    canvas.width = width
    canvas.height = height    

    context = canvas.getContext("2d")
    context.fillStyle = color
    context.textAlign = align || "left"
    fontText = "#{size || 20}px"
    fontText += " #{family || 'Verdana'}"
    fontText += " #{weigth}" if weigth? and weigth isnt "normal"
    fontText += " #{style}" if style? and style isnt "normal"
    context.font = fontText
    context.fillText(text, x, y)

    canvasData = context.getImageData(0, 0, width, height).data
    BufferUtils.alphaBlendBuffer(rgba, canvasData)

    rgba
