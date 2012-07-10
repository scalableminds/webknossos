### define ###

# Macros

# Computes the bucket index of the given vertex.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByVertex3Macro = (x, y, z) ->

  ((x >> 5) - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  ((y >> 5) - cubeOffset[1]) * cubeSize[2] + 
  ((z >> 5) - cubeOffset[2])


# Computes the index of the specified bucket.
# Requires `cubeOffset` and `cubeSize` to be in scope.
bucketIndexByAddress3Macro = (bucket_x, bucket_y, bucket_z) ->
  (bucket_x - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
  (bucket_y - cubeOffset[1]) * cubeSize[2] + 
  (bucket_z - cubeOffset[2])

# Computes the index of the vertex with the given coordinates in
# its bucket.
pointIndexMacro = (x, y, z) ->
  
  ((x & 31) << 10) +
  ((y & 31) << 5) +
  ((z & 31))


Cube = 

  LOADING_PLACEHOLDER_OBJECT : {}
  ZOOM_STEP_COUNT : 4

  # Now comes the implementation of our internal data structure.
  # `cube` is the main array. It actually represents a cuboid 
  # containing all the buckets. `cubeSize` and `cubeOffset` 
  # describe its dimension.
  cubes : []
  cubeSizes : []
  cubeOffsets : []

  getSubCubeByZoomStep : (zoomStep) ->

    if cube = @cubes[zoomStep]

      cubeSize   = @cubeSizes[zoomStep]
      cubeOffset = @cubeOffsets[zoomStep]

      { cube, cubeSize, cubeOffset }

    else 

      null


  isBucketSetByAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    @cubes[zoomStep][@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)]?


  setBucketByAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep, bucketData) ->

    @cubes[zoomStep][@bucketIndexByAddress3(bucket_x, bucket_y, bucket_z, zoomStep)] = bucketData


  # Retuns the index of the bucket (in the cuboid) which holds the
  # point you're looking for.
  bucketIndexByVertex : (vertex, zoomStep) ->

    @bucketIndexByVertex3Macro(vertex[0], vertex[1], vertex[2], zoomStep)


  bucketIndexByVertex3 : (x, y, z, zoomStep) ->

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    @bucketIndexByVertex3Macro(x, y, z, zoomStep)


  bucketIndexByAddress : (address, zoomStep) ->

    @bucketIndexByAddress3(address[0], address[1], address[2], zoomStep)


  bucketIndexByAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    cubeOffset = @cubeOffsets[zoomStep]
    cubeSize = @cubeSizes[zoomStep]

    bucketIndexByAddress3Macro(bucket_x, bucket_y, bucket_z)

  
  # Returns the index of the point (in the bucket) you're looking for.
  pointIndexByVertex : (vertex) ->
    
    pointIndexMacro(vertex[0], vertex[1], vertex[2])


  pointIndexByVertex3 : (x, y, z) ->
    
    pointIndexMacro(x, y, z)


  # Want to add data? Make sure the cuboid is big enough.
  # This one is for passing real point coordinates.
  extendByVertexExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }, zoomStep) ->
    
    @extendByBucketAddressExtent(
      min_x >> 5,
      min_y >> 5,
      min_z >> 5,
      max_x >> 5,
      max_y >> 5,
      max_z >> 5,
      zoomStep
    )


  extendByVertex : ([ x, y, z ], zoomStep) ->

    @extendByVertex3(x, y, z, zoomStep)


  extendByVertex3 : (x, y, z, zoomStep) ->
    
    bucket_x = x >> 5
    bucket_y = y >> 5
    bucket_z = z >> 5

    @extendByBucketAddressExtent(
      bucket_x,
      bucket_y,
      bucket_z,
      bucket_x,
      bucket_y,
      bucket_z,
      zoomStep
    )


  extendByBucketAddress : ([ x, y, z ], zoomStep) ->

    @extendByBucketAddressExtent(x, y, z, x, y, z, zoomStep)

      
  extendByBucketAddressExtent : ({ min_x, min_y, min_z, max_x, max_y, max_z }, zoomStep) ->  

    @extendByBucketAddressExtent6(min_x, min_y, min_z, max_x, max_y, max_z, zoomStep)  


  extendByBucketAddressExtent6 : (min_x, min_y, min_z, max_x, max_y, max_z, zoomStep) ->

    oldCube       = @cubes[zoomStep]
    oldCubeOffset = @cubeOffsets[zoomStep]
    oldCubeSize   = @cubeSizes[zoomStep]
  
    # First, we calculate the new dimension of the cuboid.
    if oldCube?
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

        @cubes[zoomStep]       = newCube
        @cubeOffsets[zoomStep] = newCubeOffset
        @cubeSizes[zoomStep]   = newCubeSize

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

      @cubes[zoomStep]       = newCube
      @cubeOffsets[zoomStep] = newCubeOffset
      @cubeSizes[zoomStep]   = newCubeSize

    # Also extend greater zoomSteps to make room for interpolated textures
    if zoomStep < @ZOOM_STEP_COUNT - 1
      @extendByBucketAddressExtent6(min_x >> 1, min_y >> 1, min_z >> 1, max_x >> 1, max_y >> 1, max_z >> 1, zoomStep + 1)
