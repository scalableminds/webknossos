### define
###


class Recolor

  DESCRIPTION : "Recolors the input with a colormap or a single color value"

  PARAMETER :
    input :
      rgba: "Uint8Array"
    colorMapName: "string"
    r : "integer"
    g : "integer"
    b : "integer"
    a : "integer"

  BITMAP_HEADER_SIZE : 54

  assetHandler : null


  constructor : (@assetHandler) ->


  execute : ({ input : { rgba }, colorMapName, r, g, b, a }) ->

    if colorMapName?
      @applyColorMap( rgba, colorMapName )

    if r? and g? and b? and a?
      @applySingleColor( rgba, r, g, b, a)

  applyColorMap : ( rgba, colorMapName ) ->

    colorMap = @assetHandler.getArray(colorMapName, Uint8Array).subarray(@BITMAP_HEADER_SIZE)

    for i in [0...rgba.length] by 4
      r = rgba[i + 0]
      g = rgba[i + 1]
      b = rgba[i + 2]
      luminance = Math.floor((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) * 3
      rgba[i + 0] = colorMap[luminance + 0]
      rgba[i + 1] = colorMap[luminance + 1]
      rgba[i + 2] = colorMap[luminance + 2]

    rgba

  applySingleColor : ( rgba, r, g, b, a)->

    colorBuffer = new Uint8Array( rgba.length )

    for i in [0...rgba.length] by 4

      colorBuffer[i + 0] = r
      colorBuffer[i + 1] = g
      colorBuffer[i + 2] = b
      colorBuffer[i + 3] = a

    @alphaBlendBuffer(rgba, colorBuffer)

    rgba

  alphaBlendBuffer : (backgroundBuffer, foregroundBuffer) ->

    for i in [0...backgroundBuffer.length] by 4

      rF = foregroundBuffer[i]
      gF = foregroundBuffer[i + 1]
      bF = foregroundBuffer[i + 2]
      aF = foregroundBuffer[i + 3] / 255

      rB = backgroundBuffer[i]
      gB = backgroundBuffer[i + 1]
      bB = backgroundBuffer[i + 2]
      aB = backgroundBuffer[i + 3] / 255


      backgroundBuffer[i    ] = rF * aF + rB * aB * (1 - aF)
      backgroundBuffer[i + 1] = gF * aF + gB * aB * (1 - aF)
      backgroundBuffer[i + 2] = bF * aF + bB * aB * (1 - aF)
      backgroundBuffer[i + 3] = 255 * (aF + aB * (1 - aF))

    return
