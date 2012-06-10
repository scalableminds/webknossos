### define ###

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
  # `31     = 00000 00000 11111`
  if zd
    if (pointIndex & 31) == 31
      # The point seems to be at the right border.
      bucketIndex++
      pointIndex &= -32
      # Bound checking.
      if bucketIndex % size0 == 0
        output = -1
    else
      pointIndex++
  
  if output != -1
    # `992   = 00000 11111 00000`
    if yd
      if (pointIndex & 992) == 992
        # The point is to at the bottom border.
        bucketIndex += size0
        pointIndex &= -993
        # Bound checking.
        if bucketIndex % size01 == 0
          output = -1
      else
        pointIndex += 32
    
    if output != -1
      # `31744 = 11111 00000 00000`
      if xd
        if (pointIndex & 31744) == 31744
          # The point seems to be at the back border.
          bucketIndex += size01
          pointIndex &= -31745

        else
          pointIndex += 1024
    
      output = if (bucket = cube[bucketIndex])?
        if bucket == true
          -2
        else
          bucket[pointIndex]
      else
        -1

linearMacro = (p0, p1, d) ->
  buffer[j] = if p0 == 0 or p1 == 0
    0
  else
    p0 * (1 - d) + p1 * d
  
bilinearMacro = (p00, p10, p01, p11, d0, d1) ->
  buffer[j] = if p00 == 0 or p10 == 0 or p01 == 0 or p11 == 0
    0
  else
    p00 * (1 - d0) * (1 - d1) + 
    p10 * d0 * (1 - d1) + 
    p01 * (1 - d0) * d1 + 
    p11 * d0 * d1
  
trilinearMacro = (p000, p100, p010, p110, p001, p101, p011, p111, d0, d1, d2) ->
  buffer[j] = if p000 == 0 or p100 == 0 or p010 == 0 or p110 == 0 or p001 == 0 or p101 == 0 or p011 == 0 or p111 == 0
    0
  else
    p000 * (1 - d0) * (1 - d1) * (1 - d2) +
    p100 * d0 * (1 - d1) * (1 - d2) + 
    p010 * (1 - d0) * d1 * (1 - d2) + 
    p110 * d0 * d1 * (1 - d2) +
    p001 * (1 - d0) * (1 - d1) * d2 + 
    p101 * d0 * (1 - d1) * d2 + 
    p011 * (1 - d0) * d1 * d2 + 
    p111 * d0 * d1 * d2

pointMacro = (output, xD, yD, zD) ->
  nextPointMacro(output, xD, yD, zD, cube, bucketIndex0, pointIndex0, size0, size01)
  if output <= 0
    buffer[j] = output
    continue

# This macro is used for collecting the necessary data of one point
# for later interpolation. It aims to be fast, therefore the code is ugly.

# pointIndex = 111111 111111 111111
#                 x      y      z
# return codes:
# -3 : negative coordinates 
# -2 : bucket in loading state
# -1 : bucket fault
collectLoopMacro = (x, y, z, buffer, j, cube, ll0, ll1, ll2, ur0, ur1, ur2, size0, size01) ->

  output0 = output1 = output2 = output3 = output4 = output5 = output6 = output7 = 0

  if x < 0 or y < 0 or z < 0
    buffer[j] = -3
    continue
  
  # Cube bound checking is necessary.
  if x < ll0 or y < ll1 or z < ll2 or x > ur0 or y > ur1 or z > ur2
    buffer[j] = -1 
    continue

  # Bitwise operations are faster than javascript's native rounding functions.
  x0 = x >> 0; xd = x - x0     
  y0 = y >> 0; yd = y - y0
  z0 = z >> 0; zd = z - z0

  bucketIndex0 = 
    ((x0 - ll0) >> 5) * size21 + 
    ((y0 - ll1) >> 5) * size2 + 
    ((z0 - ll2) >> 5)

  pointIndex0 = 
    ((x0 & 31) << 10) + 
    ((y0 & 31) << 5) +
    ((z0 & 31))      
    
  
  pointMacro(output0, false, false, false)

  if xd == 0
    if yd == 0
      unless zd == 0
        # linear z
        pointMacro(output1, false, false, true)

        linearMacro(output0, output1, zd)

    else
      if zd == 0
        # linear y
        pointMacro(output1, false, true, false)

        linearMacro(output0, output1, yd)

      else
        # bilinear y,z
        pointMacro(output1, false, true, false)
        pointMacro(output2, false, false, true)
        pointMacro(output3, false, true, true)

        bilinearMacro(output0, output1, output2, output3, yd, zd)

  else
    if yd == 0
      if zd == 0
        # linear x
        pointMacro(output1, true, false, false)

        linearMacro(output0, output1, xd)

      else
        #bilinear x,z
        pointMacro(output1, true, false, false)
        pointMacro(output2, false, false, true)
        pointMacro(output3, true, false, true)

        bilinearMacro(output0, output1, output2, output3, xd, yd)

    else
      if zd == 0
        # bilinear x,y
        pointMacro(output1, true, false, false)
        pointMacro(output2, false, true, false)
        pointMacro(output3, true, true, false)

        bilinearMacro(output0, output1, output2, output3, xd, yd)

      else
        # trilinear x,y,z
        pointMacro(output1, true, false, false)
        pointMacro(output2, false, true, false)
        pointMacro(output3, true, true, false)
        pointMacro(output4, false, false, true)
        pointMacro(output5, true, false, true)
        pointMacro(output6, false, true, true)
        pointMacro(output7, true, true, true)

        trilinearMacro(output0, output1, output2, output3, output4, output5, output6, output7, xd, yd, zd)


InterpolationCollector =

  bulkCollect : (vertices, buffer, cube, cubeSize, cubeOffset) ->

    size2  = cubeSize[2]
    size21 = cubeSize[2] * cubeSize[1]
    
    lowerBound0 = cubeOffset[0] << 5
    lowerBound1 = cubeOffset[1] << 5
    lowerBound2 = cubeOffset[2] << 5
    upperBound0 = (cubeOffset[0] + cubeSize[0]) << 5
    upperBound1 = (cubeOffset[1] + cubeSize[1]) << 5
    upperBound2 = (cubeOffset[2] + cubeSize[2]) << 5

    i = vertices.length
    j = -1

    while i

      z  = vertices[--i]
      y  = vertices[--i]
      x  = vertices[--i]
      j++

      collectLoopMacro(
        x, y, z,
        buffer, 
        j, 
        cube, 
        lowerBound0, lowerBound1, lowerBound2,
        upperBound0, upperBound1, upperBound2,
        size2, size21)
    
    return