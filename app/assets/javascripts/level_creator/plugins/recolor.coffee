### define
###


class Recolor

  DESCRIPTION : "Recolors the input with a colormap"

  PARAMETER : 
    input : 
      rgba: "Uint8Array"
    colorMapName: "string"

  BITMAP_HEADER_SIZE : 54

  assetHandler : null


  constructor : (@assetHandler) ->


  execute : ({ input : { rgba }, colorMapName }) ->

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
