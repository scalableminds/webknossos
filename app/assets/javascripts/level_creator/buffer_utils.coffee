### define
underscore : _
###

BufferUtils =

	copyGrayscaleBufferToRGBABuffer : ( source ) ->

    output = new Uint8Array( source.length * 4 )

    j = 0
    for i in [0...source.length]

        # r,g,b
        output[j++] = source[i]
        output[j++] = source[i]
        output[j++] = source[i]

        # alpha
        output[j++] = 255

    output
	
  
	alphaBlendBuffer : (backgroundBuffer, foregroundBuffer, foregroundAlpha = 1) ->

    for i in [0...backgroundBuffer.length] by 4

      rF = foregroundBuffer[i]
      gF = foregroundBuffer[i + 1]
      bF = foregroundBuffer[i + 2]
      aF = (foregroundBuffer[i + 3] / 255) * foregroundAlpha

      rB = backgroundBuffer[i]
      gB = backgroundBuffer[i + 1]
      bB = backgroundBuffer[i + 2]
      aB = backgroundBuffer[i + 3] / 255


      backgroundBuffer[i    ] = rF * aF + rB * aB * (1 - aF)
      backgroundBuffer[i + 1] = gF * aF + gB * aB * (1 - aF)
      backgroundBuffer[i + 2] = bF * aF + bB * aB * (1 - aF)
      backgroundBuffer[i + 3] = 255 * (aF + aB * (1 - aF))

    return
