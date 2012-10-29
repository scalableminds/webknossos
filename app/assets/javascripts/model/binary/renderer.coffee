### define
model/binary/cube : Cube
model/game : Game
###

# Macros

subTileMacro = (tile, index) ->

  [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)]


bufferOffsetByTileMacro = (tile, tileSize) ->

  tile[0] * (1 << tileSize) + tile[1] * (1 << tileSize) * @TEXTURE_SIZE


Renderer = 

  # Constants
  TEXTURE_SIZE : 512
  MAP_SIZE : 85 # 4⁰ + 4¹ + 4² + 4³
  DELTA : [9, 4, 0]
  REPEAT : [0, 0, 0]

  RECURSION_PLACEHOLDER : {}
  

  copyTile : (destBuffer, destTile, sourceBuffer, sourceTile) ->

    destOffset = bufferOffsetByTileMacro(destTile, 5)
    sourceOffset = bufferOffsetByTileMacro(sourceTile, 5)
            
    Renderer.renderToBuffer(destBuffer, destOffset, @TEXTURE_SIZE, 5, sourceBuffer, sourceOffset, 1, @TEXTURE_SIZE, 0, 0)        


  renderTile : (tile, plane) ->

    bucket = plane.topLeftBucket.slice(0)
    bucket[plane.view.u] += tile[0]
    bucket[plane.view.v] += tile[1]

    map = @generateRenderMap(bucket, plane.zoomStep, plane)
    @renderSubTile(map, 0, tile, plane.zoomStep, plane)


  renderSubTile : (map, mapIndex, tile, tileZoomStep, plane) ->

    return unless map[mapIndex]

    if map[mapIndex] == @RECURSION_PLACEHOLDER

      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        @renderSubTile(map, (mapIndex << 2) + 1 + i, subTile, tileZoomStep - 1, plane)

    else
 
      tileSize = 5 - (plane.zoomStep - tileZoomStep)
      bucket = Cube.getBucketByAddress(map[mapIndex])
      skip = Math.max(plane.zoomStep - bucket.zoomStep, 0)
      repeat = Math.max(bucket.zoomStep - plane.zoomStep, 0)

      destOffset = bufferOffsetByTileMacro(tile, tileSize)

      offsetMask = (1 << bucket.zoomStep - tileZoomStep) - 1;
      scaleFactor = 5 - (bucket.zoomStep - tileZoomStep)

      sourceOffsets = [
        (((plane.topLeftBucket[plane.view.u] << plane.zoomStep - tileZoomStep) + tile[0]) & offsetMask) << scaleFactor
        (((plane.topLeftBucket[plane.view.v] << plane.zoomStep - tileZoomStep) + tile[1]) & offsetMask) << scaleFactor
        (plane.layer >> bucket.zoomStep) & (1 << 5) - 1
      ]

      sourceOffsets[plane.view.w] = sourceOffsets[plane.view.w] >> 1
      sourceOffset = (sourceOffsets[0] << @DELTA[plane.view.u]) + (sourceOffsets[1] << @DELTA[plane.view.v]) + (sourceOffsets[2] << @DELTA[plane.view.w])

      @renderToBuffer(plane.buffer, destOffset, @TEXTURE_SIZE, tileSize, bucket.data, sourceOffset,
        1 << (@DELTA[plane.view.u] + skip),
        1 << (@DELTA[plane.view.v] + skip),
        @REPEAT[plane.view.u] + repeat,
        @REPEAT[plane.view.v] + repeat)


  renderToBuffer : (destBuffer, destOffset, destRowDelta, destSize, sourceBuffer, sourceOffset, sourcePixelDelta, sourceRowDelta, sourcePixelRepeat, sourceRowRepeat) ->

    i = 1 << (destSize << 1)
    destRowMask = (1 << destSize) - 1
    sourcePixelRepeatMask = (1 << sourcePixelRepeat) - 1
    sourceRowRepeatMask = (1 << destSize + sourceRowRepeat) - 1

    while i--
      destBuffer[destOffset++] = sourceBuffer[sourceOffset]
     
      if (i & sourcePixelRepeatMask) == 0
        sourceOffset += sourcePixelDelta
      
      if (i & destRowMask) == 0
        destOffset += destRowDelta - (1 << destSize)
        sourceOffset -= sourcePixelDelta << (destSize - sourcePixelRepeat)

      if (i & sourceRowRepeatMask) == 0
        sourceOffset += sourceRowDelta


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
              @addBucketToRenderMap(map, 0, subBucket, subBucketZoomStep, [bucket[plane.view.u], bucket[plane.view.v]], zoomStep, plane)

      map

    else

      if Cube.getZoomStepOfBucketByAddress(bucket) < Cube.ZOOM_STEP_COUNT
        [ bucket ]
      else [ undefined ]


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
        
        if subBucket[plane.view.u] == subTile[0] and subBucket[plane.view.v] == subTile[1]
          @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, bucket, bucketZoomStep, subTile, tileZoomStep - 1, plane)
        else
          if map[mapIndex] != @RECURSION_PLACEHOLDER
            @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, map[mapIndex], currentZoomStep, subTile, tileZoomStep - 1, plane)

      map[mapIndex] = @RECURSION_PLACEHOLDER
      return

    if map[mapIndex] == @RECURSION_PLACEHOLDER

      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, bucket, bucketZoomStep, subTile, tileZoomStep - 1, plane)
      return

    if currentZoomStep > bucketZoomStep
      map[mapIndex] = bucket
