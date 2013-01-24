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

      aOut = 1 / (aF + aB * (1 - aF))

      if aOut == 0
        backgroundBuffer[j] = 0 for j in [i...(i + 4)] by 1

      else
        backgroundBuffer[i    ] = (rF * aF + rB * aB * (1 - aF)) * aOut
        backgroundBuffer[i + 1] = (gF * aF + gB * aB * (1 - aF)) * aOut
        backgroundBuffer[i + 2] = (bF * aF + bB * aB * (1 - aF)) * aOut
        backgroundBuffer[i + 3] = 255 * (aF + aB * (1 - aF))


    backgroundBuffer


  fillBuffer : (buffer, values) ->

    for i in [0...buffer.length] by values.length
      for j in [0...values.length] by 1

        buffer[i + j] = values[j]

    buffer


