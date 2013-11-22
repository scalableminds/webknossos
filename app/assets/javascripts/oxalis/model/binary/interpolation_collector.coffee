### define 
underscore : _
###


# This provides interpolation mechanics. It's a lot of code. But it
# should run fast.


# See model/binary/cube to find out how this works
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
# Trilinear interpolation (Point is in a cube)
# This macro is used for collecting and interpolating the data.
# It aims to be fast, therefore the code is ugly.
InterpolationCollector =

  bulkCollect : (vertices, buckets) ->

    buffer = new Uint8Array(vertices.length / 3)
    accessedBuckets = []

    if buckets

      boundary = buckets.boundary

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


        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 0
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 0
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 0
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output0 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output0 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 0
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 0
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 1
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output1 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output1 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 0
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 1
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 0
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output2 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output2 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 0
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 1
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 1
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output3 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output3 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 1
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 0
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 0
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output4 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output4 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 1
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 0
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 1
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output5 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output5 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 1
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 1
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 0
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output6 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output6 = bucket[pointIndex]

        else
          continue




        bucketIndex = baseBucketIndex

        sub_x = x0
        sub_y = y0
        sub_z = z0

        # We use bitmasks to handle x, y and z coordinates.
        # `31     = 00000 00000 11111`
        if 1
          sub_z++
          if (basePointIndex & 31744) == 31744
            # The point seems to be at the right border.
            bucketIndex++
            # Bound checking.
            continue if bucketIndex % sizeZ == 0

        # `992   = 00000 11111 00000`
        if 1
          sub_y++
          if (basePointIndex & 992) == 992
            # The point is to at the bottom border.
            bucketIndex += sizeZ
            # Bound checking.
            continue if bucketIndex % sizeZY == 0

        # `31744 = 11111 00000 00000`
        if 1
          sub_x++
          if (basePointIndex & 31) == 31
            # The point seems to be at the back border.
            bucketIndex += sizeZY


        if bucketIndex == lastBucketIndex



          coordMask = 31 << lastBucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - lastBucketZoomStep)) +
              ((sub_y & coordMask) << (5 - lastBucketZoomStep)) +
              ((sub_x & coordMask) >> (lastBucketZoomStep))
            ) >> 0


          
          output7 = lastBucket[pointIndex]

        else if bucketIndex < cube.length and (bucket = cube[bucketIndex])?

          bucketZoomStep = bucket.zoomStep || 0

          accessedBuckets.push [
            sub_x >> (5 + bucketZoomStep)
            sub_y >> (5 + bucketZoomStep)
            sub_z >> (5 + bucketZoomStep)
            bucketZoomStep
          ]



          coordMask = 31 << bucketZoomStep

          pointIndex = 
            (
              ((sub_z & coordMask) << (10 - bucketZoomStep)) +
              ((sub_y & coordMask) << (5 - bucketZoomStep)) +
              ((sub_x & coordMask) >> (bucketZoomStep))
            ) >> 0



          lastBucket = bucket
          lastBucketIndex = bucketIndex
          lastBucketZoomStep = bucketZoomStep

          output7 = bucket[pointIndex]

        else
          continue

 



        trilinearOutput = 
          output0 * (1 - xd) * (1 - yd) * (1 - zd) +
          output1 * xd * (1 - yd) * (1 - zd) + 
          output2 * (1 - xd) * yd * (1 - zd) + 
          output3 * xd * yd * (1 - zd) +
          output4 * (1 - xd) * (1 - yd) * zd + 
          output5 * xd * (1 - yd) * zd + 
          output6 * (1 - xd) * yd * zd + 
          output7 * xd * yd * zd



        buffer[j] = trilinearOutput


   
    { buffer, accessedBuckets }



