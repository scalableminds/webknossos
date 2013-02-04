### define
../buffer_utils : BufferUtils
../color_utils : ColorUtils
###


class Recolor

  PUBLIC : true
  COMMAND : "recolor()"
  FRIENDLY_NAME : "Recolor"
  DESCRIPTION : "Recolors the input with a colormap or a single color value"
  PARAMETER :
    input :
      rgba: "Uint8Array"
    colorMapName: "string"
    color : "\"rgba(200, 50, 10, 0.9)\" or \"#0f00ff42\""
    #clear : "true, false" # clears rgba before recolor
  EXAMPLES : [
      { description : "recoloring using RGB", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  recolor(r: 0, g: 0, b: 255, a: 0.3)"
        ]
      }
      { description : "recoloring using a colorMap", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  recolor(colorMapName: \"blue.bmp\")"
        ]
      }      
    ]


  assetHandler : null


  constructor : (@assetHandler) ->


  execute : ({ input : { rgba }, colorMapName, r, g, b, a, color, clear }) ->

    if clear
      for i in [0...rgba.length]
        rgba[i] = 0

    if colorMapName?
      @applyColorMap( rgba, colorMapName )

    else 
      if color?
        [r, g, b, a] = ColorUtils.parseColor(color)

      if r? or g? or b?
        @applySingleColor( rgba, r, g, b, a )


  applyColorMap : ( rgba, colorMapName ) ->

    colorMap = @assetHandler.getPixelArray(colorMapName)

    for i in [0...rgba.length] by 4
      r = rgba[i + 0]
      g = rgba[i + 1]
      b = rgba[i + 2]
      a = rgba[i + 3]
      luminance = Math.floor((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) * 4
      rgba[i + 0] = colorMap[luminance + 0]
      rgba[i + 1] = colorMap[luminance + 1]
      rgba[i + 2] = colorMap[luminance + 2]
      rgba[i + 3] = colorMap[luminance + 3]

    rgba


  applySingleColor : ( rgba, r = 255, g = 255, b = 255, a = 1 ) ->

    colorBuffer = new Uint8Array( rgba.length )

    for i in [0...rgba.length] by 4

      if rgba[i + 3] is 0 
        continue

      colorBuffer[i + 0] = r
      colorBuffer[i + 1] = g
      colorBuffer[i + 2] = b
      colorBuffer[i + 3] = a * 255

    BufferUtils.alphaBlendBuffer(rgba, colorBuffer)

    rgba


