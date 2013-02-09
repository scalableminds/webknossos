### define
../buffer_utils : BufferUtils
../color_utils : ColorUtils
###


class ColorAll

  PUBLIC : true
  COMMAND : "colorAll()"
  FRIENDLY_NAME : "Color All"
  DESCRIPTION : "Colores the whole picture with one color"
  PARAMETER :
    input :
      rgba: "Uint8Array"
    colorMapName: "string"
    color : "\"rgba(200, 50, 10, 0.9)\" or \"#0f00ff42\""

  EXAMPLES : [
      { description : "Clears the whole layer", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  colorAll(color: \"rgba(0, 0, 0, 0.0)\")"
        ]
      }
      { description : "Make a blue background", lines :
        [ "time(start: 0, end : 10) ->"
          "  colorAll(color: \"rgba(0, 0, 255, 1)\")"
        ]
      }      
    ]


  constructor : () ->


  execute : ({ input : { rgba }, color}) ->

    if color?
        [r, g, b, a] = ColorUtils.parseColor(color)
    else
        [r, g, b, a] = [0, 0, 0, 1]

    for i in [0...rgba.length] by 4
      rgba[i + 0] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = a * 255

    rgba