### define
model/binary/cube : Cube
model/binary/pullqueue : Queue
###

# Macros

tileIndexByTileMacro = (tile) ->

  tile[0] * (@TEXTURE_SIZE >> @cube.BUCKET_SIZE_P) + tile[1]


subTileMacro = (tile, index) ->

  [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)]


bufferOffsetByTileMacro = (tile, tileSize) ->

  tile[0] * tileSize + tile[1] * tileSize * @TEXTURE_SIZE


class Plane2D

  # Constants
  TEXTURE_SIZE_P : 9
  MAP_SIZE : 85 # 4⁰ + 4¹ + 4² + 4³

  u : 0
  v : 0
  w : 0
  cube : null
  queue : null

  layer : 0
  zoomStep : 0
  topLeftBucket : []
  area : []
  tiles : []
  buffer: null
  changed : true


  constructor : (@u, @v, @w, @cube, @queue) ->

    null


  ping : (position, direction, zoomStep) ->

    centerBucket = @cube.positionToZoomedAddress(position, zoomStep)
 
    topLeftBucket = centerBucket.slice(0)
    topLeftBucket[@u] -= @TEXTURE_SIZE_P - 1
    topLeftBucket[@v] -= @TEXTURE_SIZE_P - 1

    bottomRightBucket = centerBucket.slice(0)
    bottomRightBucket[@u] += @TEXTURE_SIZE_P - 1
    bottomRightBucket[@v] += @TEXTURE_SIZE_P - 1
    bottomRightBucket[@w] += 1

    @cube.extendByBucketAddressExtent([
      topLeftBucket[0] << zoomStep
      topLeftBucket[1] << zoomStep
      topLeftBucket[2] << zoomStep
    ], [
      bottomRightBucket[0] << zoomStep
      bottomRightBucket[1] << zoomStep
      bottomRightBucket[2] << zoomStep
    ])

    buckets = @getBucketArray(centerBucket, @TEXTURE_SIZE_P - 1)

    for bucket in buckets
      @queue.insert([bucket[0], bucket[1], bucket[2], zoomStep], 0) if bucket?


  getBucketArray : (center, range) ->

    buckets = []

    for u in [-range...range]
      for v in [-range...range]
        bucket = center.slice(0)
        bucket[@u] += u
        bucket[@v] += v
        buckets.push if _.min(bucket) >= 0 then bucket else null

    buckets


  get : (position, [zoomStep, area]) ->

    # Making sure, position is top-left corner of some bucket
    position = [
      position[0] & ~0b11111
      position[1] & ~0b11111
      position[2] & ~0b11111
    ]

    # Calculating the coordinates of the textures top-left corner
    topLeftPosition = position.slice(0)
    topLeftPosition[@u] -= 1 << @TEXTURE_SIZE_P - 1 + zoomStep
    topLeftPosition[@v] -= 1 << @TEXTURE_SIZE_P - 1 + zoomStep
    layer = topLeftPosition[@w]

    topLeftBucket = @cube.positionToZoomedAddress(topLeftPosition, zoomStep)

    # Converting area from voxels to buckets
    area = [
      area[0] >> @cube.BUCKET_SIZE_P
      area[1] >> @cube.BUCKET_SIZE_P
      area[2] - 1 >> @cube.BUCKET_SIZE_P
      area[3] - 1 >> @cube.BUCKET_SIZE_P
    ]

    # If layer or zoomStep have changed, everything needs to be redrawn
    unless _.isEqual(@layer, layer) and _.isEqual(@zoomStep, zoomStep)
      @layer = layer
      @zoomStep = zoomStep
      @topLeftBucket = topLeftBucket
      @area = area
      @tiles = @getTileArray(topLeftBucket, 1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P)
      @buffer = new Uint8Array(1 << 2 * @TEXTURE_SIZE_P)
      @changed = true

    # If the top-left-bucket has changed, still visible tiles are copied to their new location
    unless _.isEqual(@topLeftBucket, topLeftBucket)
      oldTopLeftBucket = @topLeftBucket
      oldTiles = @tiles
      oldBuffer = @buffer

      @topLeftBucket = topLeftBucket
      @tiles = @getTileArray(topLeftBucket, 1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P)
      @buffer = new Uint8Array(1 << 2 * @TEXTURE_SIZE_P)
      @changed = true

      # Calculating boundaries for copying
      width = (1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P) - Math.abs(@topLeftBucket[@u] - oldTopLeftBucket[@u])
      height = (1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P) - Math.abs(@topLeftBucket[@v] - oldTopLeftBucket[@v])
      oldOffset = [
        Math.max(@topLeftBucket[@u] - oldTopLeftBucket[@u], 0)
        Math.max(@topLeftBucket[@v] - oldTopLeftBucket[@v], 0)
      ]
      newOffset = [
        Math.max(oldTopLeftBucket[@u] - @topLeftBucket[@u], 0)
        Math.max(oldTopLeftBucket[@v] - @topLeftBucket[@v], 0)
      ]

      # Copying tiles
      for du in [0...width] by 1
        for dv in [0...height] by 1

          oldTile = [oldOffset[0] + du, oldOffset[1] + dv]
          newTile = [newOffset[0] + du, newOffset[1] + dv]

          oldTileIndex = tileIndexByTileMacro(oldTile)
          newTileIndex = tileIndexByTileMacro(newTile)

          if plane.tiles[newTileIndex] and not oldTiles[oldTileIndex]
            
#            @copyTile(newTile, oldTile, @buffer, oldBuffer)
            @tiles[newTileIndex] = false

    # If something has changed, only changed tiles are drawn
    if @changed or not _.isEqual(@area, area)
      @area = area
      @changed = false
      
      # Tiles are rendered from the bottom-right to the top-left corner
      # to make linear interpolation possible
      for u in [area[2]..area[0]] by -1
        for v in [area[3]..area[1]] by -1
          
          tile = [u, v, zoomStep]
          tileIndex = tileIndexByTileMacro(tile)

          # Render tile if necessary and mark it as rendered
          if @tiles[tileIndex]
            @renderTile(tile, @buffer)
            @tiles[tileIndex] = false

      @buffer
    
    else

      # If the texture didn't need to be changed...
      null


  getTileArray : (offset, range) ->

    tiles = []

    for du in [0...range] by 1
      for dv in [0...range] by 1
        tiles.push offset[@u] + du >= 0 and offset[@v] + dv >= 0 and offset[@w] >= 0

    tiles


  copyTile : (destBuffer, destTile, sourceBuffer, sourceTile) ->

    destOffset = bufferOffsetByTileMacro(destTile, 1 << @cube.BUCKET_SIZE_P)
    sourceOffset = bufferOffsetByTileMacro(sourceTile, 1 << @cube.BUCKET_SIZE_P)
            
    #TODO @renderToBuffer(destBuffer, destOffset, @TEXTURE_SIZE, 5, sourceBuffer, sourceOffset, 1, @TEXTURE_SIZE, 0, 0)        


  renderTile : (tile) ->

#    bucket = @topLeftBucket.slice(0)
#    bucket[@u] += tile[0]
#    bucket[@v] += tile[1]

#    map = @generateRenderMap(bucket)
    #@renderSubTile(map, 0, tile, plane.zoomStep, plane)


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


  generateRenderMap : (bucket) ->

    map = new Array(@MAP_SIZE)
    
    if @zoomStep

      offset_x = bucket[0] << @zoomStep
      offset_y = bucket[1] << @zoomStep
      offset_z = bucket[2] << @zoomStep

      width = 1 << @zoomStep
      for dx in [0...width] by 1
        for dy in [0...width] by 1
          for dz in [0...width] by 1
            subBucket = [offset_x + dx, offset_y + dy, offset_z + dz]
            subBucketZoomStep = @cube.getZoomStepByAddress(subBucket)

            if @layer >> (subBucketZoomStep + @cube.BUCKET_SIZE_P) == subBucket[@w] >> subBucketZoomStep
              @addBucketToRenderMap(map, 0, subBucket, subBucketZoomStep, [bucket[@u], bucket[@v]], zoomStep)

      map

    else

      if @cube.getZoomStepByAddress(bucket) < @cube.ZOOM_STEP_COUNT
        [ bucket ]
      else
        [ undefined ]


  addBucketToRenderMap : (map, mapIndex, bucket, bucketZoomStep, tile, tileZoomStep) ->

    if not map[mapIndex] or map[mapIndex] == @RECURSION_PLACEHOLDER
      currentZoomStep = @cube.ZOOM_STEP_COUNT
    else currentZoomStep =  @cube.getZoomStepOfBucketByAddress(map[mapIndex])

    # 
    if currentZoomStep <= tileZoomStep
      return

    # 
    if bucketZoomStep == tileZoomStep
      map[mapIndex] = bucket
      return

    # 
    if bucketZoomStep < tileZoomStep
      
      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        zoomDifference = tileZoomStep - 1
        subBucket = [bucket[0] >> zoomDifference, bucket[1] >> zoomDifference, bucket[2] >> zoomDifference]
        
        if subBucket[@u] == subTile[0] and subBucket[@v] == subTile[1]
          @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, bucket, bucketZoomStep, subTile, tileZoomStep - 1)
        else
          if map[mapIndex] != @RECURSION_PLACEHOLDER
            @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, map[mapIndex], currentZoomStep, subTile, tileZoomStep - 1)

      map[mapIndex] = @RECURSION_PLACEHOLDER
      return

    if map[mapIndex] == @RECURSION_PLACEHOLDER

      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        @addBucketToRenderMap(map, (mapIndex << 2) + 1 + i, bucket, bucketZoomStep, subTile, tileZoomStep - 1)
      return

    if currentZoomStep > bucketZoomStep
      map[mapIndex] = bucket
