### define
../buffer_utils : BufferUtils
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
    r : "0 - 255"
    g : "0 - 255"
    b : "0 - 255"
    a : "0 - 255"
    color : "\"rgba(200, 50, 10, 0.9)\""
    clear : "true, false" # clears rgba before recolor
  EXAMPLES : [
      { description : "recoloring using RGB", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  recolor(r: 0, g: 0, b: 255, a: 170)"
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
        [r, g, b, a] = @parseColor(color)

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

      colorBuffer[i + 0] = r
      colorBuffer[i + 1] = g
      colorBuffer[i + 2] = b
      colorBuffer[i + 3] = a * 255

    BufferUtils.alphaBlendBuffer(rgba, colorBuffer)

    rgba


  parseColor : (colorName) ->
    # http://stackoverflow.com/questions/11068240/what-is-the-most-efficient-way-to-parse-a-css-color-in-javascript

    if m = colorName.match(/^#([0-9a-fA-F]{3})$/i)
      # in three-character format, each value is multiplied by 0x11 to give an
      # even scale from 0x00 to 0xff
      return [
        parseInt(m[1].charAt(0),16)*0x11
        parseInt(m[1].charAt(1),16)*0x11
        parseInt(m[1].charAt(2),16)*0x11
        1
      ]

    if m = colorName.match(/^#([0-9a-fA-F]{4})$/i)
      # in three-character format, each value is multiplied by 0x11 to give an
      # even scale from 0x00 to 0xff
      return [
        parseInt(m[1].charAt(0), 16)*0x11
        parseInt(m[1].charAt(1), 16)*0x11
        parseInt(m[1].charAt(2), 16)*0x11
        parseInt(m[1].charAt(3), 16) / 16
      ]

    if m = colorName.match(/^#([0-9a-fA-F]{6})$/i)
      return [
        parseInt(m[1].substr(0,2),16)
        parseInt(m[1].substr(2,2),16)
        parseInt(m[1].substr(4,2),16)
        1
      ]

    if m = colorName.match(/^#([0-9a-fA-F]{8})$/i)
      return [
        parseInt(m[1].substr(0,2),16)
        parseInt(m[1].substr(2,2),16)
        parseInt(m[1].substr(4,2),16)
        parseInt(m[1].substr(6,2),16)
      ]

    if m = colorName.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
      return [
        parseInt(m[1])
        parseInt(m[2])
        parseInt(m[3])
        1
      ]

    if m = colorName.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\,\s*(\d*\.?\w+)\s*\)$/i)
      return [
        parseInt(m[1])
        parseInt(m[2])
        parseInt(m[3])
        parseFloat(m[4])
      ]

    throw new Error("\"#{colorName}\" is not a valid color.")

