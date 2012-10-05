### define
model/binary/cube : Cube
model/game : Game
###

RenderMap = 

  generateRenderMap : (bucket, zoomStep, plane) ->

    map = new Array(@MAP_SIZE)

    if zoomStep

      offset_x = bucket[0] << zoomStep
      offset_y = bucket[1] << zoomStep
      offset_z = bucket[2] << zoomStep

      width = 1 << zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1
            subBucket = [offset_x + dx, offset_y + dy, offset_z + dz]
            subBucketZoomStep = Cube.getZoomStepOfBucketByAddress(subBucket)
            if plane.layer >> (subBucketZoomStep + 5) == subBucket[plane.view.w] >> subBucketZoomStep
              @addBucketToRenderMap(map, 0, subBucket, subBucketZoomStep, [bucket[plane.view.u], bucket[plane.view.v]], zoomStep, plane.view)
    else

      [ bucket ]

    return map


  addBucketToRenderMap : (map, mapIndex, bucket, bucketZoomStep, tile, tileZoomStep, plane) ->

    if not map[mapIndex] or map[mapIndex] == @RECURSION_PLACEHOLDER
      currentZoomStep = Cube.ZOOM_STEP_COUNT
    else currentZoomStep =  Cube.getZoomStepOfBucketByAddress(map[mapIndex])

    
    if currentZoomStep <= tileZoomStep
      return

    if bucketZoomStep == tileZoomStep
      map[mapIndex] = bucket
      return

    if bucketZoomStep < tileZoomStep
      
      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        zoomDifference = tileZoomStep - 1
        subBucket = [bucket[0] >> zoomDifference, bucket[1] >> zoomDifference, bucket[2] >> zoomDifference]
        
        if subBucket[view.u] == subTile[0] and subBucket[view.v] == subTile[1]
          @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, bucket, bucketZoomStep, subTile, tileZoomStep - 1, view)
        else
          if map[mapIndex] != @RECURSION_PLACEHOLDER
            @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, map[mapIndex], currentZoomStep, subTile, tileZoomStep - 1, view)

      map[mapIndex] = @RECURSION_PLACEHOLDER
      return

    if map[mapIndex] == @RECURSION_PLACEHOLDER

      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, bucket, bucketZoomStep, subTile, tileZoomStep - 1)
      return

    if currentZoomStep > bucketZoomStep
      map[mapIndex] = bucket