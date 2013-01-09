### define ###


class Fade

  DESCRIPTION : "Fades the input rgba in or out"

  PARAMETER :
    input :
      rgba: "Uint8Array"
      absoluteTime: "int"
    start: "int"
    end: "int"
    mode: "string" # in or out


  constructor : () ->


  execute : ({ input : { rgba, absoluteTime }, start, end, mode }) ->

    unless start <= absoluteTime <= end
      return rgba

    p = (absoluteTime - start) / (end - start)
    p1 = 1 - p      

    if mode is "in"
      startAlpha = 0
      for i in [0...rgba.length/4]
        endAlpha = rgba[i * 4 + 3]
        rgba[i * 4 + 3] = (startAlpha * p1) + (endAlpha * p)
    else
      endAlpha = 0
      for i in [0...rgba.length/4]
        startAlpha = rgba[i * 4 + 3]
        rgba[i * 4 + 3] = (startAlpha * p1) + (endAlpha * p)
