### define
model/binary/cube : Cube
model/game : Game
###

# Macros

subTileMacro = (tile, index) ->

  [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)]


bufferOffsetByTileCoordsMacro = (tile, scaleFactor) ->

  tile[0] * (1 << (5 - scaleFactor)) + 
  tile[1] * (1 << (5 - scaleFactor)) * @TEXTURE_SIZE


Renderer = 

  # Constants
  TEXTURE_SIZE : 512
  MAP_SIZE : 85 # 4⁰ + 4¹ + 4² + 4³
  DELTA : [9, 4, 0]
  REPEAT : [0, 0, 1]

  SPECIALbucketData : null

  RECURSION_PLACEHOLDER : {}
  
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

#      unless @SPECIALbucketData
 #       @SPECIALbucketData = new Uint8Array(32*32*16)
  #      i = 0
   #     for x in [0..31] by 1
    #      for y in [0..31] by 1
     #       for z in [0..15] by 1
      #        @SPECIALbucketData[i] = if z == 0 then 255 else 128
       #       i++
        #console.log @SPECIALbucketData

      scaleFactor = plane.zoomStep - tileZoomStep
      layerMask = (1 << 5) - 1
      destOffset = bufferOffsetByTileCoordsMacro(tile, scaleFactor)
      

      sourceOffset = ((plane.layer >> plane.zoomStep) & layerMask) * (1 << @DELTA[plane.view.w])
      
      bucketData = Cube.getBucketByAddress(map[mapIndex])

      @renderToBuffer(plane.buffer, destOffset, @TEXTURE_SIZE, 5 - scaleFactor, bucketData, sourceOffset, 1 << @DELTA[plane.view.u], 1 << @DELTA[plane.view.v], @REPEAT[plane.view.u], @REPEAT[plane.view.v], plane.view.w == 2 and tile[0] == 7 and tile[1] == 7)


  renderToBuffer : (destBuffer, destOffset, destRowDelta, destSize, sourceBuffer, sourceOffset, sourcePixelDelta, sourceRowDelta, sourcePixelRepeat, sourceRowRepeat, debug) ->

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
