### define
libs/event_mixin : EventMixin
###

class Cube

  # Constants
  BUCKET_LENGTH : 32 * 32 * 32
  BUCKET_SIZE_P : 5
  ZOOM_STEP_COUNT : 4

  cube : null
  cubeSize : null
  cubeOffset : null


  constructor : () ->
    
    _.extend(@, new EventMixin())


  getBucketIndexByAddress : ([bucket_x, bucket_y, bucket_z]) ->

    { cubeOffset, cubeSize } = @

    return undefined unless cubeOffset? and cubeSize?

    if bucket_x >= cubeOffset[0] and bucket_x < cubeOffset[0] + cubeSize[0] and
       bucket_y >= cubeOffset[1] and bucket_y < cubeOffset[1] + cubeSize[1] and
       bucket_z >= cubeOffset[2] and bucket_z < cubeOffset[2] + cubeSize[2]
    
      (bucket_x - cubeOffset[0]) * cubeSize[2] * cubeSize[1] +
      (bucket_y - cubeOffset[1]) * cubeSize[2] + 
      (bucket_z - cubeOffset[2])
    
    else

      undefined


  getZoomStepByAddress : (bucket) ->

    bucketIndex = @getBucketIndexByAddress(bucket)

    if bucketIndex? and @cube[bucketIndex]
      @cube[bucketIndex].zoomStep
    else
      @ZOOM_STEP_COUNT


  getRequestedZoomStepByAddress : (bucket) ->

    bucketIndex = @getBucketIndexByAddress(bucket)

    if bucketIndex? and @cube[bucketIndex]
      @cube[bucketIndex].requestedZoomStep
    else
      @ZOOM_STEP_COUNT


  getWorstRequestedZoomStepByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    if zoomStep

      x = bucket_x << zoomStep
      y = bucket_y << zoomStep
      z = bucket_z << zoomStep

      worstZoomStep = 0
      tmp = 0
      width = 1 << zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1
            tmp = @getRequestedZoomStepByAddress([x + dx, y + dy, z + dz])
            worstZoomStep = tmp if tmp > worstZoomStep
            return worstZoomStep if worstZoomStep == @ZOOM_STEP_COUNT
    
      worstZoomStep

    else

      @getRequestedZoomStepByAddress([bucket_x, bucket_y, bucket_z])


  setBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep], bucketData) ->
      
    if zoomStep
      x = bucket_x << zoomStep
      y = bucket_y << zoomStep
      z = bucket_z << zoomStep

      width = 1 << zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1

            bucketIndex = @getBucketIndexByAddress([x + dx, y + dy, z + dz])
            bucket = @cube[bucketIndex]

            if bucketData
              if zoomStep < bucket.zoomStep 
                bucket.data = bucketData
                #@trigger("bucketLoaded", [x + dx, y + dy, z + dz], zoomStep, bucket.zoomStep)
                bucket.zoomStep = zoomStep
            else
              bucket.requestedZoomStep = bucket.zoomStep

    else
      bucketIndex = @getBucketIndexByAddress([bucket_x, bucket_y, bucket_z])

      bucket = @cube[bucketIndex]
      if bucketData
        if zoomStep < bucket.zoomStep 
          bucket.data = bucketData
          #@trigger("bucketLoaded", [bucket_x, bucket_y, bucket_z, 0], bucket.zoomStep)
          bucket.zoomStep = 0
      else
        bucket.requestedZoomStep = bucket.zoomStep

    return


  setRequestedZoomStepByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    if zoomStep

      x = bucket_x << zoomStep
      y = bucket_y << zoomStep
      z = bucket_z << zoomStep

      width = 1 << zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1

            bucketIndex = @getBucketIndexByAddress([x + dx, y + dy, z + dz])

            if @cube[bucketIndex]
              @cube[bucketIndex].requestedZoomStep = Math.min(zoomStep, @cube[bucketIndex].requestedZoomStep)
            else
              @cube[bucketIndex] = { requestedZoomStep : zoomStep, zoomStep : @ZOOM_STEP_COUNT }

    else

      bucketIndex = @getBucketIndexByAddress([bucket_x, bucket_y, bucket_z])

      if @cube[bucketIndex]
        @cube[bucketIndex].requestedZoomStep = 0
      else
        @cube[bucketIndex] = { requestedZoomStep : 0, zoomStep : @ZOOM_STEP_COUNT }

    return

        
  positionToZoomedAddress : ([x, y, z], zoomStep) ->

    [ x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]


  extendByBucketAddressExtent : ([min_x, min_y, min_z], [max_x, max_y, max_z]) ->

    { cube : oldCube, cubeOffset : oldCubeOffset, cubeSize : oldCubeSize } = @

    # Make sure, all cube dimensions are non-negative
    min_x = Math.max(min_x, 0)
    min_y = Math.max(min_y, 0)
    min_z = Math.max(min_z, 0)
    max_x = Math.max(max_x, 0)
    max_y = Math.max(max_y, 0)
    max_z = Math.max(max_z, 0)

    # First, we calculate the new dimension of the cuboid
    if oldCube

      oldUpperBound = new Uint32Array(3)
      oldUpperBound[0] = oldCubeOffset[0] + oldCubeSize[0]
      oldUpperBound[1] = oldCubeOffset[1] + oldCubeSize[1]
      oldUpperBound[2] = oldCubeOffset[2] + oldCubeSize[2]
      
      newCubeOffset = new Uint32Array(3)
      newCubeOffset[0] = Math.min(min_x, oldCubeOffset[0])
      newCubeOffset[1] = Math.min(min_y, oldCubeOffset[1])
      newCubeOffset[2] = Math.min(min_z, oldCubeOffset[2])
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = Math.max(max_x, oldUpperBound[0]) - newCubeOffset[0]
      newCubeSize[1] = Math.max(max_y, oldUpperBound[1]) - newCubeOffset[1]
      newCubeSize[2] = Math.max(max_z, oldUpperBound[2]) - newCubeOffset[2]

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

        for x in [0..newCubeSize[0]]

          if oldCubeOffset[0] <= x + newCubeOffset[0] < oldUpperBound[0]

            for y in [0..newCubeSize[1]]

              if oldCubeOffset[1] <= y + newCubeOffset[1] < oldUpperBound[1]

                for z in [0..newCubeSize[2]]

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

    else

      # Before, there wasn't any cube
      newCubeOffset = new Uint32Array(3)
      newCubeOffset[0] = min_x
      newCubeOffset[1] = min_y
      newCubeOffset[2] = min_z
      
      newCubeSize = new Uint32Array(3)
      newCubeSize[0] = max_x - newCubeOffset[0]
      newCubeSize[1] = max_y - newCubeOffset[1]
      newCubeSize[2] = max_z - newCubeOffset[2]
      
      newCube = new Array(newCubeSize[0] * newCubeSize[1] * newCubeSize[2])

      @cube       = newCube
      @cubeOffset = newCubeOffset
      @cubeSize   = newCubeSize
