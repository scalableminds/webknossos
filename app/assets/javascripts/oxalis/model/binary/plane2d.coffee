### define
./cube : Cube
./pullqueue : Queue
../dimensions : Dimensions
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
  BUCKETS_PER_ROW : 0
  MAP_SIZE : 0
  TEXTURE_BIT_DEPTH : 8
  RECURSION_PLACEHOLDER : {}
  DELTA : [0, 5, 10]
  U : 0
  V : 0
  W : 0

  cube : null
  queue : null
  contrastCurves : null
  
  dataTexture : null
  volumeTexture : null


  constructor : (index, @cube, @queue, @TEXTURE_SIZE_P, @DATA_BIT_DEPTH) ->

    _.extend(@, new EventMixin())

    @BUCKETS_PER_ROW = 1 << (@TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P)
    @TEXTURE_SIZE = (1 << (@TEXTURE_SIZE_P << 1)) * (@TEXTURE_BIT_DEPTH >> 3)

    for i in [0..@cube.LOOKUP_DEPTH_DOWN]
      @MAP_SIZE += 1 << (i << 1)

    [@U, @V, @W] = Dimensions.getIndices(index)

    @dataTexture = { renderTile: @renderDataTile }
    @volumeTexture = { renderTile: @renderVolumeTile }

    @cube.on "bucketLoaded", (bucket) =>

      # Checking, whether the new bucket intersects with the current layer
      if @dataTexture.layer >> (@cube.BUCKET_SIZE_P + bucket[3]) == bucket[@W] and @dataTexture.topLeftBucket?

        # Get the tile, the bucket would be drawn to
        u = bucket[@U] - @dataTexture.topLeftBucket[@U]
        v = bucket[@V] - @dataTexture.topLeftBucket[@V]

        # If the tile is part of the texture, mark it as changed
        if u in [0...@BUCKETS_PER_ROW] and v in [0...@BUCKETS_PER_ROW]
          tile = [u, v]
          @dataTexture.tiles[tileIndexByTileMacro(tile)] = false
          @dataTexture.ready &= not (u in [@dataTexture.area[0]..@dataTexture.area[2]] and v in [@dataTexture.area[1]..@dataTexture.area[3]])

    @cube.on "volumeLabled", =>

      @volumeTexture.tiles = new Array(@BUCKETS_PER_ROW * @BUCKETS_PER_ROW)
      @volumeTexture.ready = false


  updateContrastCurves : (@contrastCurves) ->

    @dataTexture.tiles = new Array(@BUCKETS_PER_ROW * @BUCKETS_PER_ROW)
    @dataTexture.ready = false


  get : (position, {zoomStep, area}) ->

    $.when(@getImpl(position, zoomStep, area))


  hasChanged : ->

    not (@dataTexture.ready and @volumeTexture.ready)


  getImpl : (position, zoomStep, area) ->

    [@getTexture(@dataTexture, position, zoomStep, area), @getTexture(@volumeTexture, position, zoomStep, area)]


  getTexture : (texture, position, zoomStep, area) ->

    if not texture.counter?
      texture.counter = 0
    texture.counter++

    # Saving the layer, we'll have to render
    layer = position[@W]

    # Making sure, position is top-left corner of some bucket
    position = [
      position[0] & ~0b11111
      position[1] & ~0b11111
      position[2] & ~0b11111
    ]

    # Calculating the coordinates of the textures top-left corner
    topLeftPosition = position.slice(0)
    topLeftPosition[@U] -= 1 << @TEXTURE_SIZE_P - 1 + zoomStep
    topLeftPosition[@V] -= 1 << @TEXTURE_SIZE_P - 1 + zoomStep

    topLeftBucket = @cube.positionToZoomedAddress(topLeftPosition, zoomStep)

    # Converting area from voxels to buckets
    area = [
      area[0] >> @cube.BUCKET_SIZE_P
      area[1] >> @cube.BUCKET_SIZE_P
      area[2] - 1 >> @cube.BUCKET_SIZE_P
      area[3] - 1 >> @cube.BUCKET_SIZE_P
    ]

    # If layer or zoomStep have changed, everything needs to be redrawn
    unless _.isEqual(texture.layer, layer) and _.isEqual(texture.zoomStep, zoomStep)
      texture.layer = layer
      texture.zoomStep = zoomStep
      texture.topLeftBucket = topLeftBucket
      texture.area = area

      texture.tiles = new Array(@BUCKETS_PER_ROW * @BUCKETS_PER_ROW)
      texture.buffer = new Uint8Array(@TEXTURE_SIZE)
      texture.ready = false

    # If the top-left-bucket has changed, still visible tiles are copied to their new location
    unless _.isEqual(texture.topLeftBucket, topLeftBucket)
      oldTopLeftBucket = texture.topLeftBucket
      texture.topLeftBucket = topLeftBucket

      oldTiles = texture.tiles
      oldBuffer = texture.buffer
      texture.tiles = new Array(@BUCKETS_PER_ROW * @BUCKETS_PER_ROW)
      texture.buffer = new Uint8Array(@TEXTURE_SIZE)
      texture.ready = false

      # Calculating boundaries for copying
      width = (1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P) - Math.abs(texture.topLeftBucket[@U] - oldTopLeftBucket[@U])
      height = (1 << @TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P) - Math.abs(texture.topLeftBucket[@V] - oldTopLeftBucket[@V])
      oldOffset = [
        Math.max(texture.topLeftBucket[@U] - oldTopLeftBucket[@U], 0)
        Math.max(texture.topLeftBucket[@V] - oldTopLeftBucket[@V], 0)
      ]
      newOffset = [
        Math.max(oldTopLeftBucket[@U] - texture.topLeftBucket[@U], 0)
        Math.max(oldTopLeftBucket[@V] - texture.topLeftBucket[@V], 0)
      ]

      # Copying tiles
      for du in [1...width] by 1
        for dv in [1...height] by 1

          oldTile = [oldOffset[0] + du, oldOffset[1] + dv]
          newTile = [newOffset[0] + du, newOffset[1] + dv]

          oldTileIndex = tileIndexByTileMacro(oldTile)
          newTileIndex = tileIndexByTileMacro(newTile)

          #if oldTiles[oldTileIndex]
          #  @copyTile(newTile, oldTile, texture.buffer, oldBuffer)
          #  texture.tiles[newTileIndex] = true

    # If something has changed, only changed tiles are drawn
    unless texture.ready and _.isEqual(texture.area, area)
      texture.ready = true
      texture.area = area

      # Tiles are rendered from the bottom-right to the top-left corner
      # to make linear interpolation possible in the future
      for u in [area[2]..area[0]] by -1
        for v in [area[3]..area[1]] by -1
          
          tile = [u, v]
          tileIndex = tileIndexByTileMacro(tile)

          # Render tile if necessary and mark it as rendered
          unless texture.tiles[tileIndex]
            texture.renderTile.call(@, tile)
            texture.tiles[tileIndex] = true

      texture.buffer
    
    else

      # If the texture didn't need to be changed...
      null


   copyTile : (destTile, sourceTile, destBuffer, sourceBuffer) ->

    destOffset = bufferOffsetByTileMacro(destTile, @cube.BUCKET_SIZE_P)
    sourceOffset = bufferOffsetByTileMacro(sourceTile, @cube.BUCKET_SIZE_P)

    @renderToBuffer(
      {
        buffer: destBuffer
        offset: destOffset
        widthP: @cube.BUCKET_SIZE_P
        rowDelta: 1 << @TEXTURE_SIZE_P
      }
      {
        buffer: sourceBuffer
        offset: sourceOffset
        pixelDelta: 1
        rowDelta: 1 << @TEXTURE_SIZE_P
        pixelRepeatP: 0
        rowRepeatP: 0
      }
      null
    )


  renderDataTile : (tile) ->

    bucket = @dataTexture.topLeftBucket.slice(0)
    bucket[@U] += tile[0]
    bucket[@V] += tile[1]

    map = @generateRenderMap(bucket)
    @renderSubTile(map, 0, tile, @dataTexture.zoomStep)


  renderSubTile : (map, mapIndex, tile, tileZoomStep) ->

    return unless map[mapIndex]

    if map[mapIndex] == @RECURSION_PLACEHOLDER

      for i in [0..3] by 1
        subTile = subTileMacro(tile, i)
        @renderSubTile(map, (mapIndex << 2) + 1 + i, subTile, tileZoomStep - 1)

    else

      bucket = map[mapIndex]
      bucketZoomStep = bucket[3]
      tileSizeP = @cube.BUCKET_SIZE_P - (@dataTexture.zoomStep - tileZoomStep)
      skipP = Math.max(@dataTexture.zoomStep - bucketZoomStep, 0)
      repeatP = Math.max(bucketZoomStep - @dataTexture.zoomStep, 0)
      destOffset = bufferOffsetByTileMacro(tile, tileSizeP)

      offsetMask = (1 << bucketZoomStep - tileZoomStep) - 1;
      scaleFactorP = @cube.BUCKET_SIZE_P - (bucketZoomStep - tileZoomStep)

      sourceOffsets = [
        (((@dataTexture.topLeftBucket[@U] << @dataTexture.zoomStep - tileZoomStep) + tile[0]) & offsetMask) << scaleFactorP
        (((@dataTexture.topLeftBucket[@V] << @dataTexture.zoomStep - tileZoomStep) + tile[1]) & offsetMask) << scaleFactorP
        (@dataTexture.layer >> bucketZoomStep) & (1 << @cube.BUCKET_SIZE_P) - 1
      ]

      sourceOffset = (sourceOffsets[0] << @DELTA[@U]) + (sourceOffsets[1] << @DELTA[@V]) + (sourceOffsets[2] << @DELTA[@W])

      bucketData = @cube.getDataBucketByZoomedAddress(bucket)
      @cube.accessBuckets([bucket])

      @renderToBuffer(
        {
          buffer: @dataTexture.buffer
          offset: destOffset
          widthP: tileSizeP
          rowDelta: 1 << @TEXTURE_SIZE_P
        }
        {
          buffer: bucketData
          offset: sourceOffset
          pixelDelta: 1 << (@DELTA[@U] + skipP)
          rowDelta: 1 << (@DELTA[@V] + skipP)
          pixelRepeatP: repeatP
          rowRepeatP: repeatP
        }
        if @contrastCurves? then @contrastCurves[bucket[3]]
      )


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

    dw = @dataTexture.layer >> (@cube.BUCKET_SIZE_P + zoomStep - 1) & 0b1

    recursive = false

    if level and zoomStep

      for du in [0..1]
        for dv in [0..1]
          subBucket = [bucket_x << 1, bucket_y << 1, bucket_z << 1, zoomStep - 1]
          subBucket[@U] += du
          subBucket[@V] += dv
          subBucket[@W] += dw

          recursive |= @enhanceRenderMap(map, (mapIndex << 2) + 2 * dv + du + 1, subBucket, map[mapIndex], level - 1)

    if recursive

      map[mapIndex] = @RECURSION_PLACEHOLDER
      enhanced = true

    return enhanced


  renderVolumeTile : (tile) ->

    bucket = @volumeTexture.topLeftBucket.slice(0)
    bucket[@U] += tile[0]
    bucket[@V] += tile[1]

    destOffset = bufferOffsetByTileMacro(tile, @cube.BUCKET_SIZE_P)
    sourceOffset = ((@volumeTexture.layer >> @volumeTexture.zoomStep) & (1 << @cube.BUCKET_SIZE_P) - 1)  << @DELTA[@W]

    bucketData = @cube.getVolumeBucketByZoomedAddress(bucket)

    return unless bucketData?

    @renderToBuffer(
      {
        buffer: @volumeTexture.buffer
        offset: destOffset
        widthP: @cube.BUCKET_SIZE_P
        rowDelta: 1 << @TEXTURE_SIZE_P
      }
      {
        buffer: bucketData
        offset: sourceOffset
        pixelDelta: 1 << @DELTA[@U]
        rowDelta: 1 << @DELTA[@V]
        pixelRepeatP: 0
        rowRepeatP: 0
      }
      null
    )


  renderToBuffer : (destination, source, contrastCurve) ->

    i = 1 << (destination.widthP << 1)
    destination.nextRowMask = (1 << destination.widthP) - 1
    source.nextPixelMask = (1 << source.pixelRepeatP) - 1
    source.nextRowMask = (1 << destination.widthP + source.rowRepeatP) - 1

    bytesSrc  = @DATA_BIT_DEPTH >> 3
    bytesDest = @TEXTURE_BIT_DEPTH >> 3

    while i--
      dest = destination.offset++ * bytesDest
      src = source.offset * bytesSrc

      for b in [(bytesSrc - 1)..0] by -1
        if (value = source.buffer[src + b]) or b == 0
          destination.buffer[dest++] = if contrastCurve? then contrastCurve[value] else value
          break
      src += bytesSrc

      if (i & source.nextPixelMask) == 0
        source.offset += source.pixelDelta
      
      if (i & destination.nextRowMask) == 0
        destination.offset += destination.rowDelta - (1 << destination.widthP)
        source.offset -= source.pixelDelta << (destination.widthP - source.pixelRepeatP)

      if (i & source.nextRowMask) == 0
        source.offset += source.rowDelta

    return
