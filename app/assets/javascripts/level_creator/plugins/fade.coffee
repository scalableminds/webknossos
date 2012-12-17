### define 
../buffer_utils : BufferUtils
###


class Fade

  DESCRIPTION : "Fades the input rgba in or out"

  PARAMETER :
    input :
      rgba: "Uint8Array"
      absoluteTime: "int"
    start: "int"
    end: "int"
    mode: "string" # in or out


  constructor : ->


  execute : ({ input , start, end, mode }) ->

    { rgba, absoluteTime } = input

    return unless start <= absoluteTime <= end

    t = (absoluteTime - start) / (end - start)
    
    t = 1 - t if mode == "out"

    newRgba = new Uint8Array(rgba.length)

    BufferUtils.alphaBlendBuffer(newRgba, rgba, t)

    input.rgba = newRgba
