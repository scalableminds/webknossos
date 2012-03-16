define ->

  # This provides interpolation mechanics. It's a lot of code. But it
  # should run fast.

  # Finding points adjacent to the already found one.
  # We make use of the bucket structure and index arithmetik to optimize
  # lookup time.
  # Either returns a color value between 0 and 1 or an error code:
  #
  # *    `-2`: bucket fault (but loading)
  # *    `-1`: bucket fault
  nextPointMacro = (output, xd, yd, zd, cube, bucketIndex0, pointIndex0, size0, size01) ->

    bucketIndex = bucketIndex0
    pointIndex  = pointIndex0
    
    # We use bitmasks to handle x, y and z coordinates.
    # `63     = 000000 000000 111111`
    if zd
      if (pointIndex & 63) == 63
        # The point seems to be at the right border.
        bucketIndex++
        pointIndex &= -64
        # Bound checking.
        if bucketIndex % size0 == 0
          output = -1
      else
        pointIndex++
    
    if output != -1
      # `4032   = 000000 111111 000000`
      if yd
        if (pointIndex & 4032) == 4032
          # The point is to at the bottom border.
          bucketIndex += size0
          pointIndex &= -4033
          # Bound checking.
          if bucketIndex % size01 == 0
            output = -1
        else
          pointIndex += 64
      
      if output != -1
        # `258048 = 111111 000000 000000`
        if xd
          if (pointIndex & 258048) == 258048
            # The point seems to be at the back border.
            bucketIndex += size01
            pointIndex &= -258049

          else
            pointIndex += 4096
      
        output = if (bucket = cube[bucketIndex])?
          if bucket == true
            -2
          else
            bucket[pointIndex] / 256
        else
          -1

  pointMacro = (output, xD, yD, zD) ->
    nextPointMacro(output, xD, yD, zD, cube, bucketIndex0, pointIndex0, size0, size01)
    if output <= 0
      buffer0[j4] = output
      continue

  # This macro is used for collecting the necessary data of one point
  # for later interpolation. It aims to be fast, therefore the code is ugly.

  # pointIndex = 111111 111111 111111
  #                 x      y      z
  # return codes:
  # -2 : negative coordinates or bucket in loading state
  # -1 : bucket fault
  collectLoopMacro = (x, y, z, buffer0, buffer1, bufferDelta, j4, j3, cube, ll0, ll1, ll2, ur0, ur1, ur2, size0, size01) ->

    output0 = output1 = output2 = output3 = output4 = output5 = output6 = output7 = 0

    if x < 0 or y < 0 or z < 0
      buffer0[j4] = -2
      continue
    
    # Cube bound checking is necessary.
    if x < ll0 or y < ll1 or z < ll2 or x > ur0 or y > ur1 or z > ur2
      buffer0[j4] = -1 
      continue

    # Bitwise operations are faster than javascript's native rounding functions.
    x0 = x >> 0; xd = x - x0     
    y0 = y >> 0; yd = y - y0
    z0 = z >> 0; zd = z - z0

    bucketIndex0 = 
      ((x0 - ll0) >> 6) * size21 + 
      ((y0 - ll1) >> 6) * size2 + 
      ((z0 - ll2) >> 6)

    pointIndex0 = 
      ((x0 & 63) << 12) + 
      ((y0 & 63) << 6) +
      ((z0 & 63))      
      
    
    pointMacro(output0, false, false, false)

    if xd == 0
      if yd == 0
        unless zd == 0
          # linear z
          pointMacro(output1, false, false, true)

          bufferDelta[j3] = zd

      else
        if zd == 0
          # linear y
          pointMacro(output1, false, true, false)

          bufferDelta[j3] = yd

        else
          # bilinear y,z
          pointMacro(output1, false, true, false)
          pointMacro(output2, false, false, true)
          pointMacro(output3, false, true, true)

          bufferDelta[j3]     = yd
          bufferDelta[j3 + 1] = zd

    else
      if yd == 0
        if zd == 0
          # linear x
          pointMacro(output1, true, false, false)

          bufferDelta[j3] = xd

        else
          #bilinear x,z
          pointMacro(output1, true, false, false)
          pointMacro(output2, false, false, true)
          pointMacro(output3, true, false, true)

          bufferDelta[j3]     = xd
          bufferDelta[j3 + 1] = zd

      else
        if zd == 0
          # bilinear x,y
          pointMacro(output1, true, false, false)
          pointMacro(output2, false, true, false)
          pointMacro(output3, true, true, false)

          bufferDelta[j3]     = xd
          bufferDelta[j3 + 1] = yd

        else
          # trilinear x,y,z
          pointMacro(output1, true, false, false)
          pointMacro(output2, false, true, false)
          pointMacro(output3, true, true, false)
          pointMacro(output4, false, false, true)
          pointMacro(output5, true, false, true)
          pointMacro(output6, false, true, true)
          pointMacro(output7, true, true, true)

          bufferDelta[j3]     = xd
          bufferDelta[j3 + 1] = yd
          bufferDelta[j3 + 2] = zd

    buffer0[j4]     = output0
    buffer0[j4 + 1] = output1 || 0
    buffer0[j4 + 2] = output2 || 0
    buffer0[j4 + 3] = output3 || 0
    buffer1[j4]     = output4 || 0
    buffer1[j4 + 1] = output5 || 0
    buffer1[j4 + 2] = output6 || 0
    buffer1[j4 + 3] = output7 || 0


  InterpolationCollector =

    bulkCollect : (vertices, buffer0, buffer1, bufferDelta, cube, cubeSize, cubeOffset) ->

      size2  = cubeSize[2]
      size21 = cubeSize[2] * cubeSize[1]
      
      lowerBound0 = cubeOffset[0] << 6
      lowerBound1 = cubeOffset[1] << 6
      lowerBound2 = cubeOffset[2] << 6
      upperBound0 = (cubeOffset[0] + cubeSize[0]) << 6
      upperBound1 = (cubeOffset[1] + cubeSize[1]) << 6
      upperBound2 = (cubeOffset[2] + cubeSize[2]) << 6

      i = 0
      j4 = -4
      j3 = -3
      length = vertices.length

      while i < length

        x   = vertices[i++]
        y   = vertices[i++]
        z   = vertices[i++]
        j3 += 3
        j4 += 4

        collectLoopMacro(
          x, y, z,
          buffer0, buffer1, bufferDelta, 
          j4, j3, 
          cube, 
          lowerBound0, lowerBound1, lowerBound2,
          upperBound0, upperBound1, upperBound2,
          size2, size21)
      
      return

  InterpolationCollector
