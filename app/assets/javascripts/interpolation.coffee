# This provides interpolation mechanics. It's a lot of code. But it
# should run fast.
Interpolation =
  BLACK : 1
  linear : (p0, p1, d) ->
    if p0 == 0 or p1 == 0
      @BLACK
    else
      p0 * (1 - d) + p1 * d
  
  bilinear : (p00, p10, p01, p11, d0, d1) ->
    if p00 == 0 or p10 == 0 or p01 == 0 or p11 == 0
      @BLACK
    else
      p00 * (1 - d0) * (1 - d1) + 
      p10 * d0 * (1 - d1) + 
      p01 * (1 - d0) * d1 + 
      p11 * d0 * d1
    
  trilinear : (p000, p100, p010, p110, p001, p101, p011, p111, d0, d1, d2) ->
    if p000 == 0 or p100 == 0 or p010 == 0 or p110 == 0 or p001 == 0 or p101 == 0 or p011 == 0 or p111 == 0
      @BLACK
    else
      p000 * (1 - d0) * (1 - d1) * (1 - d2) +
      p100 * d0 * (1 - d1) * (1 - d2) + 
      p010 * (1 - d0) * d1 * (1 - d2) + 
      p110 * d0 * d1 * (1 - d2) +
      p001 * (1 - d0) * (1 - d1) * d2 + 
      p101 * d0 * (1 - d1) * d2 + 
      p011 * (1 - d0) * d1 * d2 + 
      p111 * d0 * d1 * d2

  # Use this function to have your point interpolated. We'll figure
  # out whether linear, bilinear or trilinear interpolation is best.
  # But, you need to give us the `get` callback so we can find points
  # in your data structure. Keep in mind that the `get` function
  # probably loses its scope (hint: use `_.bind`)
  interpolate : (x, y, z, get)->
    
    # Bitwise operations are faster than javascript's native rounding functions.
    x0 = x >> 0; x1 = x0 + 1; xd = x - x0     
    y0 = y >> 0; y1 = y0 + 1; yd = y - y0
    z0 = z >> 0; z1 = z0 + 1; zd = z - z0

    # return get(x0, y0, z0)

    if xd == 0
      if yd == 0
        if zd == 0
          get(x, y, z)
        else
          #linear z
          Interpolation.linear(get(x, y, z0), get(x, y, z1), zd)
      else
        if zd == 0
          #linear y
          Interpolation.linear(get(x, y0, z), get(x, y1, z), yd)
        else
          #bilinear y,z
          Interpolation.bilinear(
            get(x, y0, z0), 
            get(x, y1, z0), 
            get(x, y0, z1), 
            get(x, y1, z1), 
            yd, zd)
    else
      if yd == 0
        if zd == 0
          #linear x
          Interpolation.linear(get(x0, y, z), get(x1, y, z), xd)
        else
          #bilinear x,z
          Interpolation.bilinear(
            get(x0, y, z0), 
            get(x1, y, z0), 
            get(x0, y, z1), 
            get(x1, y, z1), 
            xd, zd)
      else
        if zd == 0
          #bilinear x,y
          Interpolation.bilinear(
            get(x0, y0, z), 
            get(x1, y0, z), 
            get(x0, y1, z), 
            get(x1, y1, z), 
            xd, yd)
        else
          #trilinear x,y,z
          Interpolation.trilinear(
            get(x0, y0, z0),
            get(x1, y0, z0),
            get(x0, y1, z0),
            get(x1, y1, z0),
            get(x0, y0, z1),
            get(x1, y0, z1),
            get(x0, y1, z1),
            get(x1, y1, z1),
            xd, yd, zd
          )

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