### define
###


class Recolor

  DESCRIPTION : "Recolors the input with a colormap"

  PARAMETER : 
    input : 
      rgba: "Uint8Array"
    colorMapName: "string"

  assetHandler : null


  constructor : (@assetHandler) ->


  execute : ({ input : { rgba }, colorMapName }) ->

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
