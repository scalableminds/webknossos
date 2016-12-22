Backbone   = require("backbone")
Cube       = require("./cube")
Queue      = require("./pullqueue")
Dimensions = require("../dimensions")

# Macros
# should work as normal functions, as well
tileIndexByTileMacro = (_this, tile) ->

  tile[0] * (1 << _this.TEXTURE_SIZE_P - _this.cube.BUCKET_SIZE_P) + tile[1]


subTileMacro = (tile, index) ->

  [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)]


bufferOffsetByTileMacro = (_this, tile, tileSize) ->

  tile[0] * (1 << tileSize) + tile[1] * (1 << tileSize) * (1 << _this.TEXTURE_SIZE_P)


class Plane2D

  # Constants
  TEXTURE_SIZE_P : 0
  BUCKETS_PER_ROW : 0
  MAP_SIZE : 0
  RECURSION_PLACEHOLDER : {recursionPlaceholder: true}
  DELTA : [0, 5, 10]
  U : 0
  V : 0
  W : 0

  NOT_LOADED_BUCKET_INTENSITY : 100
  NOT_LOADED_BUCKET_PLACEHOLDER : {notLoadedBucketPlaceholder: true}

  cube : null
  queue : null

  dataTexture : null


  constructor : (@index, @cube, @queue, @TEXTURE_SIZE_P, @DATA_BIT_DEPTH,
                 @TEXTURE_BIT_DEPTH, @MAPPED_DATA_BIT_DEPTH, isSegmentation) ->

    _.extend(this, Backbone.Events)

    @BUCKETS_PER_ROW = 1 << (@TEXTURE_SIZE_P - @cube.BUCKET_SIZE_P)
    @TEXTURE_SIZE = (1 << (@TEXTURE_SIZE_P << 1)) * (@TEXTURE_BIT_DEPTH >> 3)

    if isSegmentation
      @NOT_LOADED_BUCKET_INTENSITY = 0
    @NOT_LOADED_BUCKET_DATA = new Uint8Array(@cube.BUCKET_LENGTH)
    for i in [0...@NOT_LOADED_BUCKET_DATA.length]
      @NOT_LOADED_BUCKET_DATA[i] = @NOT_LOADED_BUCKET_INTENSITY

    @_forceRedraw = false

    for i in [0..@cube.LOOKUP_DEPTH_DOWN]
      @MAP_SIZE += 1 << (i << 1)

    [@U, @V, @W] = Dimensions.getIndices(@index)

    @dataTexture = { renderTile: @renderDataTile }

    @listenTo(@cube, "bucketLoaded", (bucket) ->

      zoomStepDiff = @dataTexture.zoomStep - bucket[3]
      if zoomStepDiff > 0
        bucket = [
          bucket[0] >> zoomStepDiff
          bucket[1] >> zoomStepDiff
          bucket[2] >> zoomStepDiff
          @dataTexture.zoomStep
        ]

      # Checking, whether the new bucket intersects with the current layer
      if @dataTexture.layer >> (@cube.BUCKET_SIZE_P + bucket[3]) == bucket[@W] and @dataTexture.topLeftBucket?

        # Get the tile, the bucket would be drawn to
        u = bucket[@U] - @dataTexture.topLeftBucket[@U]
        v = bucket[@V] - @dataTexture.topLeftBucket[@V]

        # If the tile is part of the texture, mark it as changed
        if u in [0...@BUCKETS_PER_ROW] and v in [0...@BUCKETS_PER_ROW]
          tile = [u, v]
          @dataTexture.tiles[tileIndexByTileMacro(@, tile)] = false
          @dataTexture.ready &= not (u in [@dataTexture.area[0]..@dataTexture.area[2]] and v in [@dataTexture.area[1]..@dataTexture.area[3]])
    )

    @cube.on "volumeLabeled", => @reset()
    @cube.on "mappingChanged", => @reset()


  reset : ->

    @dataTexture.tiles = new Array(@BUCKETS_PER_ROW * @BUCKETS_PER_ROW)
    @dataTexture.ready = false


  forceRedraw : ->

    @_forceRedraw = true


  hasChanged : ->

    not @dataTexture.ready


  get : ({position, zoomStep, area}) ->

    @getTexture(@dataTexture, position, zoomStep, area)


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
    if @_forceRedraw or not _.isEqual(texture.layer, layer) or not _.isEqual(texture.zoomStep, zoomStep)
      texture.layer = layer
      texture.zoomStep = zoomStep
      texture.topLeftBucket = topLeftBucket
      texture.area = area

      texture.tiles = new Array(@BUCKETS_PER_ROW * @BUCKETS_PER_ROW)
      texture.buffer = new Uint8Array(@TEXTURE_SIZE)
      texture.ready = false

      @_forceRedraw = false

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

          oldTileIndex = tileIndexByTileMacro(@, oldTile)
          newTileIndex = tileIndexByTileMacro(@, newTile)

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
          tileIndex = tileIndexByTileMacro(@, tile)

          # Render tile if necessary and mark it as rendered
          unless texture.tiles[tileIndex]
            texture.renderTile.call(@, tile)
            texture.tiles[tileIndex] = true

      texture.buffer

    else

      # If the texture didn't need to be changed...
      null


   copyTile : (destTile, sourceTile, destBuffer, sourceBuffer) ->

    destOffset = bufferOffsetByTileMacro(@, destTile, @cube.BUCKET_SIZE_P)
    sourceOffset = bufferOffsetByTileMacro(@, sourceTile, @cube.BUCKET_SIZE_P)

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

    else if map[mapIndex] == @NOT_LOADED_BUCKET_PLACEHOLDER

      tileSizeP = @cube.BUCKET_SIZE_P - (@dataTexture.zoomStep - tileZoomStep)
      @renderToBuffer(
        {
          buffer: @dataTexture.buffer
          offset: bufferOffsetByTileMacro(@, tile, tileSizeP)
          widthP: tileSizeP
          rowDelta: 1 << @TEXTURE_SIZE_P
        }
        {
          buffer: @NOT_LOADED_BUCKET_DATA
          mapping: null
          offset: 0
          pixelDelta: 1
          rowDelta: 1
          pixelRepeatP: 0
          rowRepeatP: 0
        }
      )

    else

      bucket = map[mapIndex]
      bucketZoomStep = bucket[3]
      tileSizeP = @cube.BUCKET_SIZE_P - (@dataTexture.zoomStep - tileZoomStep)
      skipP = Math.max(@dataTexture.zoomStep - bucketZoomStep, 0)
      repeatP = Math.max(bucketZoomStep - @dataTexture.zoomStep, 0)
      destOffset = bufferOffsetByTileMacro(@, tile, tileSizeP)

      offsetMask = (1 << bucketZoomStep - tileZoomStep) - 1;
      scaleFactorP = @cube.BUCKET_SIZE_P - (bucketZoomStep - tileZoomStep)

      sourceOffsets = [
        (((@dataTexture.topLeftBucket[@U] << @dataTexture.zoomStep - tileZoomStep) + tile[0]) & offsetMask) << scaleFactorP
        (((@dataTexture.topLeftBucket[@V] << @dataTexture.zoomStep - tileZoomStep) + tile[1]) & offsetMask) << scaleFactorP
        (@dataTexture.layer >> bucketZoomStep) & (1 << @cube.BUCKET_SIZE_P) - 1
      ]

      sourceOffset = (sourceOffsets[0] << @DELTA[@U]) + (sourceOffsets[1] << @DELTA[@V]) + (sourceOffsets[2] << @DELTA[@W])

      bucketData = @cube.getBucket(bucket).getData()
      mapping    = @cube.currentMapping

      @renderToBuffer(
        {
          buffer: @dataTexture.buffer
          offset: destOffset
          widthP: tileSizeP
          rowDelta: 1 << @TEXTURE_SIZE_P
        }
        {
          buffer: bucketData
          mapping: mapping
          offset: sourceOffset
          pixelDelta: 1 << (@DELTA[@U] + skipP)
          rowDelta: 1 << (@DELTA[@V] + skipP)
          pixelRepeatP: repeatP
          rowRepeatP: repeatP
        }
      )


  generateRenderMap : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    bucket = @cube.getBucket([bucket_x, bucket_y, bucket_z, zoomStep])
    return [[bucket_x, bucket_y, bucket_z, zoomStep]] if bucket.hasData()
    return [undefined] if bucket.isOutOfBoundingBox

    map = new Array(@MAP_SIZE)
    map[0] = @NOT_LOADED_BUCKET_PLACEHOLDER

    maxZoomStepOffset = Math.max(0, Math.min(@cube.LOOKUP_DEPTH_UP,
      @cube.ZOOM_STEP_COUNT - zoomStep - 1
    ))

    if zoomStep < @cube.ZOOM_STEP_COUNT
      for i in [maxZoomStepOffset...0]

        bucket = [
          bucket_x >> i
          bucket_y >> i
          bucket_z >> i
          zoomStep + i
        ]

        map[0] = bucket if @cube.getBucket(bucket).hasData()

    if zoomStep != 0 and @enhanceRenderMap(map, 0, [bucket_x, bucket_y, bucket_z, zoomStep], map[0], @cube.LOOKUP_DEPTH_DOWN)

      map[0] = @RECURSION_PLACEHOLDER

    map


  enhanceRenderMap : (map, mapIndex, [bucket_x, bucket_y, bucket_z, zoomStep], fallback, level) ->

    enhanced = false
    bucket = @cube.getBucket([bucket_x, bucket_y, bucket_z, zoomStep])

    if bucket.hasData()

      map[mapIndex] = [bucket_x, bucket_y, bucket_z, zoomStep]
      enhanced = true

    else if bucket.isOutOfBoundingBox and fallback == @NOT_LOADED_BUCKET_PLACEHOLDER

      map[mapIndex] = undefined
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


  renderToBuffer : (destination, source) ->

    i = 1 << (destination.widthP << 1)
    destination.nextRowMask = (1 << destination.widthP) - 1
    source.nextPixelMask = (1 << source.pixelRepeatP) - 1
    source.nextRowMask = (1 << destination.widthP + source.rowRepeatP) - 1

    mapping = source.mapping

    bytesSrc       = @DATA_BIT_DEPTH >> 3
    bytesSrcMapped = if mapping? and mapping.length then @MAPPED_DATA_BIT_DEPTH >> 3 else bytesSrc
    bytesDest      = @TEXTURE_BIT_DEPTH >> 3
    shorten        = bytesDest < bytesSrcMapped

    while i--
      dest = destination.offset++ * bytesDest
      src = source.offset * bytesSrc

      sourceValue = 0
      for b in [0...bytesSrc]
        sourceValue += (1 << (b * 8)) * source.buffer[ src + b ]
      sourceValue = if mapping? and mapping[ sourceValue ]? then mapping[ sourceValue ] else sourceValue

      # If you have to shorten the data,
      # use the first none-zero byte unless all are zero
      # assuming little endian order
      for b in [0...bytesSrcMapped]
        if (value = (sourceValue >> (b*8)) % 256 ) or b == bytesSrcMapped - 1 or (not shorten)
          destination.buffer[dest++] = value
          if shorten
            break

      if (i & source.nextPixelMask) == 0
        source.offset += source.pixelDelta

      if (i & destination.nextRowMask) == 0
        destination.offset += destination.rowDelta - (1 << destination.widthP)
        source.offset -= source.pixelDelta << (destination.widthP - source.pixelRepeatP)

      if (i & source.nextRowMask) == 0
        source.offset += source.rowDelta

    return

module.exports = Plane2D
