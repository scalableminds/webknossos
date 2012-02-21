# This provides interpolation mechanics. It's a lot of code. But it
# should run fast.

InterpolationCollector =
  # Finding points adjacent to the already found one.
  # We make use of the bucket structure and index arithmetik to optimize
  # lookup time.
  # Either returns a color value between 1 and 2 or an error code:
  #
  # *    `-1`: block fault
  # *    `0`: point fault (provided by the data structure)
  nextPoint : (xd, yd, zd, cube, bucketIndex0, pointIndex0, size0, size01) ->

    bucketIndex = bucketIndex0
    pointIndex  = pointIndex0
    
    # We use bitmasks to handle x, y and z coordinates.
    # `63     = 000000 000000 111111`
    if xd
      if (pointIndex & 63) == 63
        # The point seems to be at the right border.
        bucketIndex++
        pointIndex &= -64
        # Bound checking.
        return -1 if bucketIndex % size0 == 0
      else
        pointIndex++
    
    # `4032   = 000000 111111 000000`
    if yd
      if (pointIndex & 4032) == 4032
        # The point is to at the bottom border.
        bucketIndex += size0
        pointIndex &= -4033
        # Bound checking.
        return -1 if bucketIndex % size01 == 0
      else
        pointIndex += 64
    
    # `258048 = 111111 000000 000000`
    if zd
      if (pointIndex & 258048) == 258048
        # The point seems to be at the back border.
        bucketIndex += size01
        pointIndex &= -258049
      else
        pointIndex += 4096
    
    if (bucket = cube[bucketIndex])?
      bucket[pointIndex]
    else
      -1

  # This function is used for looking up points in the data structure
  # for later interpolation. It aims to be fast, therefore the code is ugly.

  # pointIndex = 111111 111111 111111
  #                 z      y      x
  # return codes:
  # -2 : negative coordinates
  # -1 : bucket fault
  # 0  : point fault
  collect : (x, y, z, buffer0, buffer1, bufferDelta, j4, j3, cube, ll0, ll1, ll2, ur0, ur1, ur2, size0, size01) ->

    return buffer0[j4] = -2 if x < 0 or y < 0 or z < 0
    
    # Bound checking is necessary.
    return buffer0[j4] = -1 if x < ll0 or y < ll1 or z < ll2 or x > ur0 or y > ur1 or z > ur2

    # Bitwise operations are faster than javascript's native rounding functions.
    x0 = x >> 0; xd = x - x0     
    y0 = y >> 0; yd = y - y0
    z0 = z >> 0; zd = z - z0

    bucketIndex0 = 
      ((x0 - ll0) >> 6) + 
      ((y0 - ll1) >> 6) * size0 + 
      ((z0 - ll2) >> 6) * size01
    
    pointIndex0 = 
      ((x0 & 63)) +
      ((y0 & 63) << 6) +
      ((z0 & 63) << 12)
    
    output0 = @nextPoint(false, false, false, cube, bucketIndex0, pointIndex0, size0, size01)
    return buffer0[j4] = output0 if output0 <= 0

    if xd == 0
      if yd == 0
        unless zd == 0
          # linear z
          output1 = @nextPoint(false, false, true, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0
          bufferDelta[j3] = zd

      else
        if zd == 0
          # linear y
          output1 = @nextPoint(false, true, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0
          bufferDelta[j3] = yd

        else
          # bilinear y,z
          output1 = @nextPoint(false, true, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0

          output2 = @nextPoint(false, false, true, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output2 if output2 <= 0

          output3 = @nextPoint(false, true, true,  cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output3 if output3 <= 0

          bufferDelta[j3]     = yd
          bufferDelta[j3 + 1] = zd

    else
      if yd == 0
        if zd == 0
          # linear x
          output1 = @nextPoint(true, false, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0
          bufferDelta[j3] = xd

        else
          #bilinear x,z
          output1 = @nextPoint(true, false, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0

          output2 = @nextPoint(false, false, true, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output2 if output2 <= 0

          output3 = @nextPoint(true, false, true,  cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output3 if output3 <= 

          bufferDelta[j3]     = xd
          bufferDelta[j3 + 1] = zd

      else
        if zd == 0
          # bilinear x,y
          output1 = @nextPoint(true, false, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0

          output2 = @nextPoint(false, true, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output2 if output2 <= 0

          output3 = @nextPoint(true, true, false,  cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output3 if output3 <= 0

          bufferDelta[j3]     = xd
          bufferDelta[j3 + 1] = yd

        else
          # trilinear x,y,z
          output1 = @nextPoint(true, false, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output1 if output1 <= 0

          output2 = @nextPoint(false, true, false, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output2 if output2 <= 0

          output3 = @nextPoint(true, true, false,  cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output3 if output3 <= 0

          output4 = @nextPoint(false, false, true, cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output4 if output4 <= 0

          output5 = @nextPoint(true, false, true,  cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output5 if output5 <= 0

          output6 = @nextPoint(false, true, true,  cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output6 if output6 <= 0

          output7 = @nextPoint(true, true, true,   cube, bucketIndex0, pointIndex0, size0, size01)
          return buffer0[j4] = output7 if output7 <= 0

          bufferDelta[j3]     = xd
          bufferDelta[j3 + 1] = yd
          bufferDelta[j3 + 2] = zd

    buffer0[j4]     = output0
    buffer0[j4 + 1] = output1 || 0
    buffer0[j4 + 2] = output2 || 0
    buffer0[j4 + 3] = output3 || 0
    buffer1[j4]      = output4 || 0
    buffer1[j4 + 1]  = output5 || 0
    buffer1[j4 + 2]  = output6 || 0
    buffer1[j4 + 3]  = output7 || 0

  bulkCollect : (vertices, bufferFront, bufferBack, bufferDelta, cube, ll0, ll1, ll2, ur0, ur1, ur2, size0, size01) ->

    i = j3 = j4 = 0
    length = vertices.length

    while i < length

      x = vertices[i++]
      y = vertices[i++]
      z = vertices[i++]

      @collect(
        x, y, z, 
        bufferFront, bufferBack, bufferDelta, 
        j4, j3, 
        cube, 
        ll0, ll1, ll2,
        ur0, ur1, ur2,
        size0, size01)

      j3 += 3
      j4 += 4
      
    return
    

  nextPointMacro : (output, xd, yd, zd, cube, bucketIndex0, pointIndex0, size0, size01) ->

    bucketIndex = bucketIndex0
    pointIndex  = pointIndex0
    
    # We use bitmasks to handle x, y and z coordinates.
    # `63     = 000000 000000 111111`
    if xd
      if (pointIndex & 63) == 63
        # The point seems to be at the right border.
        bucketIndex++
        pointIndex &= -64
        # Bound checking.
        output = -1 if bucketIndex % size0 == 0
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
          output = -1 if bucketIndex % size01 == 0
        else
          pointIndex += 64
      
      if output != -1
        # `258048 = 111111 000000 000000`
        if zd
          if (pointIndex & 258048) == 258048
            # The point seems to be at the back border.
            bucketIndex += size01
            pointIndex &= -258049
          else
            pointIndex += 4096
      
        output = if (bucket = cube[bucketIndex])?
          bucket[pointIndex]
        else
          -1

  pointMacro : (output, xD, yD, zD) ->
    nextPointMacro(output, xD, yD, zD, cube, bucketIndex0, pointIndex0, size0, size01)
    return buffer0[j4] = output if output <= 0
  
  collectMacro : (x, y, z, buffer0, buffer1, bufferDelta, j4, j3, cube, ll0, ll1, ll2, ur0, ur1, ur2, size0, size01) ->

    if x < 0 or y < 0 or z < 0
      buffer0[j4] = -2
      return
    
    # Bound checking is necessary.
    if x < ll0 or y < ll1 or z < ll2 or x > ur0 or y > ur1 or z > ur2
      buffer0[j4] = -1 
      return

    # Bitwise operations are faster than javascript's native rounding functions.
    x0 = x >> 0; xd = x - x0     
    y0 = y >> 0; yd = y - y0
    z0 = z >> 0; zd = z - z0

    bucketIndex0 = 
      ((x0 - ll0) >> 6) + 
      ((y0 - ll1) >> 6) * size0 + 
      ((z0 - ll2) >> 6) * size01
    
    pointIndex0 = 
      ((x0 & 63)) +
      ((y0 & 63) << 6) +
      ((z0 & 63) << 12)
    
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
    buffer1[j4]      = output4 || 0
    buffer1[j4 + 1]  = output5 || 0
    buffer1[j4 + 2]  = output6 || 0
    buffer1[j4 + 3]  = output7 || 0
    return 
