### define
###


class Blur

  PUBLIC : true
  COMAMND : "blur"
  FRIENDLY_NAME : "Blur"
  DESCRIPTION : "Blurs the input image with gussian blur."
  PARAMETER :
    input :
      rgba: "Uint8Array"
    radius: "0.0 - 10.0"
  EXAMPLES : [
      { description : "blurs the whole slide", lines :
        [ "time(start: 0, end : 10) ->"
          "  importSlides(start:0, end: 10)"
          "  blur(radius : 2)"
        ]
      }
    ]


  kernel : null
  kernelSize : 0
  kernelSum : 0

  constructor : ->
    @radius = 2
    @makeKernel(@radius)

  execute : ({ input : { rgba, dimensions }, radius }) ->

    width = dimensions[0]
    height = dimensions[1]

    if @radius isnt radius and typeof radius isnt "undefined"
      @radius = radius
      @makeKernel(radius)

    kernel = @kernel
    kernelSize = @kernelSize

    for y in [0...height] by 1
      for x in [0...width] by 1

        r = 0
        g = 0
        b = 0
        a = 0

        for j in [1 - kernelSize...kernelSize] by 1
          if y + j < 0 or y + j >= height
            continue

          for i in [1 - kernelSize...kernelSize] by 1
            if x + i < 0 or x + i >= width
              continue

            r += rgba[4 * ((y + j) * width + (x + i)) + 0] * kernel[Math.abs(j)][Math.abs(i)]
            g += rgba[4 * ((y + j) * width + (x + i)) + 1] * kernel[Math.abs(j)][Math.abs(i)]
            b += rgba[4 * ((y + j) * width + (x + i)) + 2] * kernel[Math.abs(j)][Math.abs(i)]
            a += rgba[4 * ((y + j) * width + (x + i)) + 3] * kernel[Math.abs(j)][Math.abs(i)]

        rgba[4 * (y * width + x) + 0] = r / @kernelSum;
        rgba[4 * (y * width + x) + 1] = g / @kernelSum;
        rgba[4 * (y * width + x) + 2] = b / @kernelSum;
        rgba[4 * (y * width + x) + 3] = a / @kernelSum;

    rgba


  makeKernel : (radius) ->

    sigma = radius
    ss = sigma * sigma
    factor = 2 * Math.PI * ss
    kernel = []
    kernel.push([])

    for i in [0...7] by 1
      g = Math.exp(-(i * i) / (2 * ss)) / factor
      if g < 0.001
        break
      kernel[0].push(g)

    kernelSize = i
    for j in [1...kernelSize] by 1
      kernel.push([])

      for i in [0...kernelSize] by 1
        g = Math.exp(-(i * i + j * j) / (2 * ss)) / factor
        kernel[j].push(g)

    kernelSum = 0
    for j in [1 - kernelSize...kernelSize] by 1
      for i in [1 - kernelSize...kernelSize] by 1
        kernelSum += kernel[Math.abs(j)][Math.abs(i)]

    @kernel = kernel
    @kernelSize = kernelSize
    @kernelSum = kernelSum
