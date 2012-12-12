### define
###


class Blur

  DESCRIPTION : "Blurs the input image with gussian blur."

  PARAMETER :
    input :
      rgba: "Uint8Array"
    radius: "integer"

  KERNEL = [ 1, 2, 1, 2, 4, 2, 1, 2, 1 ]


  execute : ({ input : { rgba, dimensions }, radius }) ->

    @dimensions = dimensions
    @rgba = rgba

    for i in [0...rgba.length] by 4
      r = 0
      g = 0
      b = 0

      kernelCount = 0;

      #Apply kernel
      for y in [-1..1]
        for x in [-1..1]
          neighbor =
            r : @getPixel(i + 0, x, y)
            g : @getPixel(i + 1, x, y)
            b : @getPixel(i + 2, x, y)

          r += KERNEL[kernelCount] * neighbor.r
          g += KERNEL[kernelCount] * neighbor.g
          b += KERNEL[kernelCount] * neighbor.b
          kernelCount++

      r /= 16
      g /= 16
      b /= 16

      rgba[i + 0] = r
      rgba[i + 1] = g
      rgba[i + 2] = b

    rgba


  getPixel : (_index, x, y) ->

    width = @dimensions[0]
    height = @dimensions[1]

    x *= 4

    index = _index + width * 4 * y + x

    #clamp
    if index < 0
      return 0

    if index > height * width * 4
      return 0

    @rgba[ index ]
