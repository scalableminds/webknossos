### define
./cube : Cube
./pullqueue : Queue
../dimensions : DimensionHelper
../../../libs/event_mixin : EventMixin
###

# Macros

tileIndexByTileMacro = (tile) ->

  tile[0] * (1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P) + tile[1]


subTileMacro = (tile, index) ->

  [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)]


bufferOffsetByTileMacro = (tile, tileSize) ->

  tile[0] * (1 << tileSize) + tile[1] * (1 << tileSize) * (1 << @TEXTURE_SIZE_P)


class Plane2D

  # Constants
  TEXTURE_SIZE_P : 0
  BUCKETS_IN_A_ROW : 0
  MAP_SIZE : 0
  RECURSION_PLACEHOLDER : {}
  DELTA : [0, 5, 10]

  index : null
  u : 0
  v : 0
  w : 0
  cube : null
  queue : null
  lookUpTable : null

  layer : -1
  zoomStep : -1
  topLeftBucket : []
  area : []
  tiles : []
  buffer: null
  changed : true


  constructor : (@index, @cube, @queue, @TEXTURE_SIZE_P) ->

    _.extend(@, new EventMixin())

    @BUCKETS_IN_A_ROW = 1 << (@TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P)

    for i in [0..@cube.LOOKUP_DEPTH_DOWN]
      @MAP_SIZE += 1 << (2 * i)

    [@u, @v, @w] = Dimensions.getIndices(@index)

    @cube.on "bucketLoaded", (bucket) =>

      # Checking, whether the new bucket intersects with the current layer
      if @layer >> (@cube.BUCKET_SIZE_P + bucket[3]) == bucket[@w]

        # Get the tile, the bucket would be drawn to
        u = bucket[@u] - @topLeftBucket[@u]
        v = bucket[@v] - @topLeftBucket[@v]

        # If the tile is part of the texture, mark it as changed
        if u in [0...@BUCKETS_IN_A_ROW] and v in [0...@BUCKETS_IN_A_ROW]
          #TODO Macro-Fix
          tile = [u, v]
          @tiles[tileIndexByTileMacro(tile)] = true
          @changed |= u in [@area[0]..@area[2]] and v in [@area[1]..@area[3]]


  updateLookUpTable : (@lookUpTable) ->

    for i in [0..@tiles.length]
      @tiles[i] = true

    @changed = true


  ping : (position, direction, zoomStep) ->

    centerBucket = @cube.positionToZoomedAddress(position, zoomStep)
    buckets = @getBucketArray(centerBucket, @TEXTURE_SIZE_P - 4)

    for bucket in buckets
      if bucket?
        priority = Math.abs(bucket[0] - centerBucket[0]) + Math.abs(bucket[1] - centerBucket[1]) + Math.abs(bucket[2] - centerBucket[2])
        @queue.insert([bucket[0], bucket[1], bucket[2], zoomStep], priority)
        bucket[@w]++
        @queue.insert([bucket[0], bucket[1], bucket[2], zoomStep], priority << 1)
        bucket[@w]++
        @queue.insert([bucket[0], bucket[1], bucket[2], zoomStep], priority << 2)


  getBucketArray : (center, range) ->

    buckets = []

    for u in [-range...range]
      for v in [-range...range]
        bucket = center.slice(0)
        bucket[@u] += u
        bucket[@v] += v
        buckets.push if _.min(bucket) >= 0 then bucket else null

    buckets


  get : (position, {zoomStep, area}) ->

    $.when(@getImpl(position, zoomStep, area))


  getImpl : (position, zoomStep, area) ->

    # Saving the layer, we'll have to render
    layer = position[@w]

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
      @tiles = @getTileArray(topLeftBucket, @BUCKETS_IN_A_ROW)
      @buffer = new Uint8Array(1 << @TEXTURE_SIZE_P * 2)
      @changed = true

    # If the top-left-bucket has changed, still visible tiles are copied to their new location
    unless _.isEqual(@topLeftBucket, topLeftBucket)
      oldTopLeftBucket = @topLeftBucket
      oldTiles = @tiles
      oldBuffer = @buffer

      @topLeftBucket = topLeftBucket
      @tiles = @getTileArray(topLeftBucket, @BUCKETS_IN_A_ROW)
      @buffer = new Uint8Array(1 << @TEXTURE_SIZE_P * 2)
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
      for du in [1...width] by 1
        for dv in [1...height] by 1

          oldTile = [oldOffset[0] + du, oldOffset[1] + dv]
          newTile = [newOffset[0] + du, newOffset[1] + dv]

          oldTileIndex = tileIndexByTileMacro(oldTile)
          newTileIndex = tileIndexByTileMacro(newTile)

          if @tiles[newTileIndex] and not oldTiles[oldTileIndex]
            
            @copyTile(newTile, oldTile, oldBuffer)
            @tiles[newTileIndex] = false

    # If something has changed, only changed tiles are drawn
    if @changed or not _.isEqual(@area, area)
      @area = area
      @changed = false
      
      # Tiles are rendered from the bottom-right to the top-left corner
      # to make linear interpolation possible in the future
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


  copyTile : (destTile, sourceTile, sourceBuffer) ->

    destOffset = bufferOffsetByTileMacro(destTile, @cube.BUCKET_SIZE_P)
    sourceOffset = bufferOffsetByTileMacro(sourceTile, @cube.BUCKET_SIZE_P)

    @renderToBuffer(destOffset, 1 << @TEXTURE_SIZE_P, @cube.BUCKET_SIZE_P, sourceBuffer, sourceOffset, 1, 1 << @TEXTURE_SIZE_P, 0, 0, false)


  renderTile : (tile) ->

    bucket = @topLeftBucket.slice(0)
    bucket[@u] += tile[0]
    bucket[@v] += tile[1]

    map = @generateRenderMap(bucket)
    @renderSubTile(map, 0, tile, @zoomStep)


  renderSubTile : (map, mapIndex, tile, tileZoomStep) ->

    return unless map[mapIndex]

    if map[mapIndex] == @RECURSION_PLACEHOLDER

      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        @renderSubTile(map, (mapIndex << 2) + 1 + i, subTile, tileZoomStep - 1)

    else

      bucketZoomStep = map[mapIndex][3]
      tileSize = @cube.BUCKET_SIZE_P - (@zoomStep - tileZoomStep)
      skip = Math.max(@zoomStep - bucketZoomStep, 0)
      repeat = Math.max(bucketZoomStep - @zoomStep, 0)
      destOffset = bufferOffsetByTileMacro(tile, tileSize)

      offsetMask = (1 << bucketZoomStep - tileZoomStep) - 1;
      scaleFactor = @cube.BUCKET_SIZE_P - (bucketZoomStep - tileZoomStep)

      sourceOffsets = [
        (((@topLeftBucket[@u] << @zoomStep - tileZoomStep) + tile[0]) & offsetMask) << scaleFactor
        (((@topLeftBucket[@v] << @zoomStep - tileZoomStep) + tile[1]) & offsetMask) << scaleFactor
        (@layer >> bucketZoomStep) & (1 << 5) - 1
      ]

      sourceOffset = (sourceOffsets[0] << @DELTA[@u]) + (sourceOffsets[1] << @DELTA[@v]) + (sourceOffsets[2] << @DELTA[@w])

      bucketData = @cube.getBucketDataByZoomedAddress(map[mapIndex])

      @renderToBuffer(destOffset, 1 << @TEXTURE_SIZE_P, tileSize, bucketData, sourceOffset,
        1 << (@DELTA[@u] + skip),
        1 << (@DELTA[@v] + skip),
        repeat,
        repeat,
        true)


  renderToBuffer : (destOffset, destRowDelta, destSize, sourceBuffer, sourceOffset, sourcePixelDelta, sourceRowDelta, sourcePixelRepeat, sourceRowRepeat, mapColors) ->

    lookUpTable = @lookUpTable

    i = 1 << (destSize << 1)
    destRowMask = (1 << destSize) - 1
    sourcePixelRepeatMask = (1 << sourcePixelRepeat) - 1
    sourceRowRepeatMask = (1 << destSize + sourceRowRepeat) - 1

    while i--
      @buffer[destOffset++] = if mapColors then lookUpTable[sourceBuffer[sourceOffset]] else sourceBuffer[sourceOffset]
     
      if (i & sourcePixelRepeatMask) == 0
        sourceOffset += sourcePixelDelta
      
      if (i & destRowMask) == 0
        destOffset += destRowDelta - (1 << destSize)
        sourceOffset -= sourcePixelDelta << (destSize - sourcePixelRepeat)

      if (i & sourceRowRepeatMask) == 0
        sourceOffset += sourceRowDelta

    return


  generateRenderMap : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    return [[bucket_x, bucket_y, bucket_z, zoomStep]] if @cube.isBucketLoadedByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    map = new Array(@MAP_SIZE)
    map[0] = undefined
    
    for i in [Math.min(@cube.LOOKUP_DEPTH_UP, @cube.ZOOM_STEP_COUNT - zoomStep - 1)...0]

      bucket = [
        bucket_x >> i
        bucket_y >> i
        bucket_z >> i
        zoomStep + i
      ]
      
      map[0] = bucket if @cube.isBucketLoadedByZoomedAddress(bucket)

    if zoomStep and @enhanceRenderMap(map, 0, [bucket_x, bucket_y, bucket_z, zoomStep], map[0], @cube.LOOKUP_DEPTH_DOWN)

      map[0] = @RECURSION_PLACEHOLDER

    map


  enhanceRenderMap : (map, mapIndex, [bucket_x, bucket_y, bucket_z, zoomStep], fallback, level) ->

    enhanced = false

    if @cube.isBucketLoadedByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep]) 

      map[mapIndex] = [bucket_x, bucket_y, bucket_z, zoomStep]
      enhanced = true

    else

      map[mapIndex] = fallback

    dw = @layer >> (5 + zoomStep - 1) & 0b1

    recursive = false

    if level and zoomStep

      for du in [0..1]
        for dv in [0..1]

          subBucket = [bucket_x << 1, bucket_y << 1, bucket_z << 1, zoomStep - 1]
          subBucket[@u] += du
          subBucket[@v] += dv
          subBucket[@w] += dw

          recursive |= @enhanceRenderMap(map, (mapIndex << 2) + 2 * dv + du + 1, subBucket, map[mapIndex], level - 1)

    if recursive

      map[mapIndex] = @RECURSION_PLACEHOLDER
      enhanced = true

    return enhanced
