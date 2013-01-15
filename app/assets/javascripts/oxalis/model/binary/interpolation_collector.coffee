### define ###

# This provides interpolation mechanics. It's a lot of code. But it
# should run fast.


# See model/binary/cube to find out how this works
pointIndexMacro = (pointIndex, x, y, z, zoomStep) ->

  coordMask = 31 << zoomStep

  pointIndex = 
    (
      ((z & coordMask) << (10 - zoomStep)) +
      ((y & coordMask) << (5 - zoomStep)) +
      ((x & coordMask) >> (zoomStep))
    ) >> 0

# Finding points adjacent to the already found one.
# We make use of the bucket structure and index arithmetic to optimize
# lookup time.
# Returns a color value between 0 and 255.
#
# pointIndex = 111111 111111 111111
#                 x      y      z
#
# Implicit parameters:
# *   cube
# *   basePointIndex
# *   baseBucketIndex
# *   sizeZ
# *   sizeZY
subPointMacro = (output, xd, yd, zd) ->

  bucketIndex = baseBucketIndex

  sub_x = x0
  sub_y = y0
  sub_z = z0
  
  # We use bitmasks to handle x, y and z coordinates.
  # `31     = 00000 00000 11111`
  if zd
    sub_z++
    if (basePointIndex & 31744) == 31744
      # The point seems to be at the right border.
      bucketIndex++
      # Bound checking.
      continue if bucketIndex % sizeZ == 0
  
  # `992   = 00000 11111 00000`
  if yd
    sub_y++
    if (basePointIndex & 992) == 992
      # The point is to at the bottom border.
      bucketIndex += sizeZ
      # Bound checking.
      continue if bucketIndex % sizeZY == 0
    
  # `31744 = 11111 00000 00000`
  if xd
    sub_x++
    if (basePointIndex & 31) == 31
      # The point seems to be at the back border.
      bucketIndex += sizeZY

  
  if bucketIndex == lastBucketIndex

    pointIndexMacro(pointIndex, sub_x, sub_y, sub_z, lastBucketZoomStep)
    
    output = lastBucket[pointIndex]

  else if bucketIndex < cube.length and (bucket = cube[bucketIndex])? and not bucket.isPlaceholder

    bucketZoomStep = bucket.zoomStep || 0
    pointIndexMacro(pointIndex, sub_x, sub_y, sub_z, bucketZoomStep)

    lastBucket = bucket
    lastBucketIndex = bucketIndex
    lastBucketZoomStep = bucketZoomStep

    output = bucket[pointIndex]

  else
    continue

# Trilinear interpolation (Point is in a cube)
trilinearMacro = (p000, p100, p010, p110, p001, p101, p011, p111, d0, d1, d2) ->
  p000 * (1 - d0) * (1 - d1) * (1 - d2) +
  p100 * d0 * (1 - d1) * (1 - d2) + 
  p010 * (1 - d0) * d1 * (1 - d2) + 
  p110 * d0 * d1 * (1 - d2) +
  p001 * (1 - d0) * (1 - d1) * d2 + 
  p101 * d0 * (1 - d1) * d2 + 
  p011 * (1 - d0) * d1 * d2 + 
  p111 * d0 * d1 * d2


# This macro is used for collecting and interpolating the data.
# It aims to be fast, therefore the code is ugly.
collectLoopMacro = (x, y, z, buffer, j, cube, min_x, min_y, min_z, max_x, max_y, max_z, sizeZ, sizeZY) ->

  output0 = output1 = output2 = output3 = output4 = output5 = output6 = output7 = 0

  # Cube bound checking is necessary.
  if x < min_x or y < min_y or z < min_z or x > max_x or y > max_y or z > max_z
    continue

  # Bitwise operations provide fast rounding of numbers.
  x0 = x >> 0; xd = x - x0     
  y0 = y >> 0; yd = y - y0
  z0 = z >> 0; zd = z - z0

  baseBucketIndex = 
    ((x0 - min_x) >> 5) * sizeZY + 
    ((y0 - min_y) >> 5) * sizeZ + 
    ((z0 - min_z) >> 5)

  basePointIndex = 
    ((z0 & 31) << 10) + 
    ((y0 & 31) << 5) +
    ((x0 & 31))      
    
  # trilinear x,y,z
  subPointMacro(output0, 0, 0, 0)
  subPointMacro(output1, 1, 0, 0)
  subPointMacro(output2, 0, 1, 0)
  subPointMacro(output3, 1, 1, 0)
  subPointMacro(output4, 0, 0, 1)
  subPointMacro(output5, 1, 0, 1)
  subPointMacro(output6, 0, 1, 1)
  subPointMacro(output7, 1, 1, 1) 

  buffer[j] = trilinearMacro(output0, output1, output2, output3, output4, output5, output6, output7, xd, yd, zd)


InterpolationCollector =

  bulkCollect : (vertices, cubeData) ->

    buffer = new Uint8Array(vertices.length / 3)

    if cubeData

      { buckets, boundary } = cubeData

      sizeZ   = boundary[2]
      sizeZY  = boundary[2] * boundary[1]
      
      min_x = 0 #cubeOffset[0] << 5
      min_y = 0 #cubeOffset[1] << 5
      min_z = 0 #cubeOffset[2] << 5
      max_x = min_x + (boundary[0] << 5) - 1
      max_y = min_y + (boundary[1] << 5) - 1
      max_z = min_z + (boundary[2] << 5) - 1

      lastBucket = null
      lastBucketIndex = -1
      lastBucketZoomStep = 0

      i = vertices.length

      j = -1

      while i

        z = vertices[--i]
        y = vertices[--i]
        x = vertices[--i]

        j++           

        collectLoopMacro(
          x, y, z,
          buffer, 
          j, 
          buckets, 
          min_x, min_y, min_z,
          max_x, max_y, max_z,
          sizeZ, sizeZY)
   
    buffer