### define ###

# Macros

# Computes the index of the specified bucket.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByAddress3Macro = (bucket_x, bucket_y, bucket_z) ->

  (bucket_x - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  (bucket_y - cubeOffset[1]) * cubeSize[2] + 
  (bucket_z - cubeOffset[2])


Cube = 

  ZOOM_STEP_COUNT : 4

  # Now comes the implementation of our internal data structure.
  # `cube` is the main array. It actually represents a cuboid 
  # containing all the buckets. `cubeSize` and `cubeOffset` 
  # describe its dimension.
  cube : null
  cubeSize : null
  cubeOffset : null

  getCube : ->
  
    { cube, cubeSize, cubeOffset } = @
    
    if cube 
      { cube, cubeSize, cubeOffset }
    else 
      null


  getWorstRequestedZoomStepOfBucketByZoomedAddress : (bucket, zoomStep) ->

    @getWorstRequestedZoomStepOfBucketByZoomedAddress3(
      bucket[0]
      bucket[1]
      bucket[2]
      zoomStep
    )


  getWorstRequestedZoomStepOfBucketByZoomedAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    x = bucket_x << zoomStep
    y = bucket_y << zoomStep
    z = bucket_z << zoomStep

    worstZoomStep = 0
    tmp = 0
    width = 1 << zoomStep
    for dx in [0...width] by 1
      for dy in [0...width] by 1
        for dz in [0...width] by 1
          tmp = @getRequestedZoomStepOfBucketByAddress3(x + dx, y + dy, z + dz)
          worstZoomStep = tmp if tmp > worstZoomStep
          return if worstZoomStep = @ZOOM_STEP_COUNT

    worstZoomStep


  getRequestedZoomStepOfBucketByAddress : (bucket) ->

    @getRequestedZoomStepOfBucketByAddress3(
      bucket[0]
      bucket[1]
      bucket[2]
    )


  getRequestedZoomStepOfBucketByAddress3 : (bucket_x, bucket_y, bucket_z) ->

    { cube } = @

    bucketIndex = @bucketIndexByAddress3(bucket_x, bucket_y, bucket_z)

    if cube[bucketIndex]
      cube[bucketIndex].requestedZoomStep
    else
      @ZOOM_STEP_COUNT

  setBucketByZoomedAddress : (bucket, zoomStep, bucketData) ->

    @setBucketByZoomedAddress3(
      bucket[0]
      bucket[1]
      bucket[2]
      bucketData
      zoomStep
    )


  setBucketByZoomedAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep, bucketData) ->

    { cube } = @
      
    if zoomStep
      baseBucketMask = ~0 << zoomStep

      baseBucket_x = bucket_x & baseBucketMask
      baseBucket_y = bucket_y & baseBucketMask
      baseBucket_z = bucket_z & baseBucketMask

      width = 1 << zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1

            bucket = cube[@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z)]

            if bucketData
              if zoomStep < bucket.zoomStep 
                bucket.data = bucketData
                bucket.zoomStep = zoomStep
            else
              bucket.requestedZoomStep = bucket.zoomStep

    else
      bucket = cube[@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z)]

      if bucketData
        if zoomStep < bucket.zoomStep 
          bucket.data = bucketData
          bucket.zoomStep = 0
      else
        bucket.requestedZoomStep = bucket.zoomStep


  setRequestedZoomStepByZoomedAddress : (bucket, zoomStep) ->

    setRequestedZoomStepByZoomedAddress3(
      bucket[0]
      bucket[1]
      bucket[2]
      zoomStep
    )


  setRequestedZoomStepByZoomedAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    { cube } = @

    if zoomStep
      baseBucketMask = ~0 << zoomStep

      baseBucket_x = bucket_x & baseBucketMask
      baseBucket_y = bucket_y & baseBucketMask
      baseBucket_z = bucket_z & baseBucketMask

      width = 1 << zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1

            bucketIndex = @bucketIndexByAddress3(baseBucket_x + dx, baseBucket_y + dy, baseBucket_z + dz)

            if cube[bucketIndex]
              cube[bucketIndex].requestedZoomStep = Math.min(zoomStep, cube[bucketIndex].requestedZoomStep)
            else
              cube[bucketIndex] = { requestedZoomStep : zoomStep, zoomStep : @ZOOM_STEP_COUNT }

    else
      bucketIndex = @bucketIndexByAddress3(baseBucket_x + dx, baseBucket_y + dy, baseBucket_z + dz)

      if cube[bucketIndex]
        cube[bucketIndex].requestedZoomStep = 0
      else
        cube[bucketIndex] = { requestedZoomStep = 0, zoomStep : @ZOOM_STEP_COUNT }


  bucketIndexByAddress : (bucket) ->

    @bucketIndexByAddress3(
      bucket[0]
      bucket[1]
      bucket[2]
    )


  bucketIndexByZoomedAddress : (bucket, zoomStep) ->

    @bucketIndexByAddress3(
      bucket[0] << zoomStep
      bucket[1] << zoomStep
      bucket[2] << zoomStep
    )


  bucketIndexByAddress3 : (bucket_x, bucket_y, bucket_z) ->

    { cubeOffset, cubeSize } = @

    bucketIndexByAddress3Macro(bucket_x, bucket_y, bucket_z)


  vertexToZoomedBucketAddress : (vertex, zoomStep) ->

    @vertexToAddress3(
      vertex[0]
      vertex[1]
      vertex[2]
    )


  vertexToZoomedBucketAddress3 : (x, y, z, zoomStep) ->

    [ x >> 5 + zoomStep, y >> 5 + zoomStep, z >> 5 + zoomStep]


  extendByBucketAddressExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }) ->  

    @extendByBucketAddressExtent6(min_x, min_y, min_z, max_x, max_y, max_z)  


  extendByBucketAddressExtent6 : (min_x, min_y, min_z, max_x, max_y, max_z) ->

    { cube : oldCube, cubeOffset : oldCubeOffset, cubeSize : oldCubeSize } = @

    # First, we calculate the new dimension of the cuboid.
    if oldCube
      oldUpperBound = new Uint32Array(3)
      oldUpperBound[0] = oldCubeOffset[0] + oldCubeSize[0]
      oldUpperBound[1] = oldCubeOffset[1] + oldCubeSize[1]
      oldUpperBound[2] = oldCubeOffset[2] + oldCubeSize[2]
      
      newCubeOffset = new Uint32Array(3)
      newCubeOffset[0] = Math.min(min_x, max_x, oldCubeOffset[0])
      newCubeOffset[1] = Math.min(min_y, max_y, oldCubeOffset[1])
      newCubeOffset[2] = Math.min(min_z, max_z, oldCubeOffset[2])
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(min_x, max_x, oldUpperBound[0] - 1) - newCubeOffset[0] + 1
      newCubeSize[1] = Math.max(min_y, max_y, oldUpperBound[1] - 1) - newCubeOffset[1] + 1
      newCubeSize[2] = Math.max(min_z, max_z, oldUpperBound[2] - 1) - newCubeOffset[2] + 1
      

      # Just reorganize the existing buckets when the cube dimensions 
      # have changed. Transferring all old buckets to their new location.
      if newCubeOffset[0] != oldCubeOffset[0] or 
      newCubeOffset[1] != oldCubeOffset[1] or 
      newCubeOffset[2] != oldCubeOffset[2] or 
      newCubeSize[0] != oldCubeSize[0] or 
      newCubeSize[1] != oldCubeSize[1] or 
      newCubeSize[2] != oldCubeSize[2]

        newCube = new Array(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])
        newIndex = 0

        for x in [0...newCubeSize[0]]

          if oldCubeOffset[0] <= x + newCubeOffset[0] < oldUpperBound[0]

            for y in [0...newCubeSize[1]]

              if oldCubeOffset[1] <= y + newCubeOffset[1] < oldUpperBound[1]

                for z in [0...newCubeSize[2]]

                  if oldCubeOffset[2] <= z + newCubeOffset[2] < oldUpperBound[2]
                    oldIndex = 
                      (x + newCubeOffset[0] - oldCubeOffset[0]) * oldCubeSize[2] * oldCubeSize[1] +
                      (y + newCubeOffset[1] - oldCubeOffset[1]) * oldCubeSize[2] +
                      (z + newCubeOffset[2] - oldCubeOffset[2])
                    newCube[newIndex] = oldCube[oldIndex]
                  newIndex++
              else
                newIndex += newCubeSize[2]

          else
            newIndex += newCubeSize[2] * newCubeSize[1]

        @cube       = newCube
        @cubeOffset = newCubeOffset
        @cubeSize   = newCubeSize

        # verify

        # throw "ouch" unless newIndex == newCube.length

        # for x in [newCubeOffset[0]...(newCubeOffset[0] + newCubeSize[0])]
        #   for y in [newCubeOffset[1]...(newCubeOffset[1] + newCubeSize[1])]
        #     for z in [newCubeOffset[2]...(newCubeOffset[2] + newCubeSize[2])]
              
        #         oldIndex =
        #           (x - oldCubeOffset[0]) * oldCubeSize[2] * oldCubeSize[1] +
        #           (y - oldCubeOffset[1]) * oldCubeSize[2] + 
        #           (z - oldCubeOffset[2])
              
        #         newIndex = 
        #           (x - newCubeOffset[0]) * newCubeSize[2] * newCubeSize[1] +
        #           (y - newCubeOffset[1]) * newCubeSize[2] + 
        #           (z - newCubeOffset[2])

        #       if (oldCubeOffset[0] <= x < oldUpperBound[0]) and
        #       (oldCubeOffset[1] <= y < oldUpperBound[1]) and
        #       (oldCubeOffset[2] <= z < oldUpperBound[2])
        #         throw "ouch" unless oldCube[oldIndex] == newCube[newIndex]
        #       else
        #         throw "ouch" unless newCube[newIndex] == undefined

    else
      # Before, there wasn't any cube.
      newCubeOffset = new Uint32Array(3)
      newCubeOffset[0] = Math.min(min_x, max_x)
      newCubeOffset[1] = Math.min(min_y, max_y)
      newCubeOffset[2] = Math.min(min_z, max_z)
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(min_x, max_x) - newCubeOffset[0] + 1
      newCubeSize[1] = Math.max(min_y, max_y) - newCubeOffset[1] + 1
      newCubeSize[2] = Math.max(min_z, max_z) - newCubeOffset[2] + 1
      
      newCube = new Array(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])

      @cube       = newCube
      @cubeOffset = newCubeOffset
      @cubeSize   = newCubeSize