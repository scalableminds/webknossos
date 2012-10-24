### define
model/binary/cube : Cube
model/binary/pullqueue : PullQueue
model/binary/renderer : Renderer
model/game : Game
###

# #Model.Binary#
# Binary is the real deal.
# It loads and stores the primary graphical data.
# 
# ##Data structure##
#
# ###Concept###
# We store 3-dimensional data with each coordinate >= [0,0,0].
# Each point is stored in **buckets** which resemble a cubical grid. 
# Those buckets are kept in an expandable data structure (**cube**) which 
# represents the smallest cuboid covering all used buckets.
# 
# ###Implementation###
# Each point value (greyscale color) is represented by a number 
# between 0 and 255, where 0 is black and 255 white. 
# 
# The buckets are implemented as `Uint8Array`s with a length of
# `BUCKET_WIDTH ^ 3`. Each point can be easiliy found through simple 
# arithmetic (see `Model.Binary.pointIndexByVertex`). Each bucket has an 
# address which is its coordinate representation and can be computed 
# by (integer-)dividing each coordinate with `BUCKET_WIDTH`.
#
# We actually use bitwise operations to perform some of our 
# computations. Therefore `BUCKET_WIDTH` needs to be a power of 2.
# Also we consider a bucket to be either non-existant or full. There
# are no sparse buckets.
#
# The cube is defined by the offset `[x,y,z]` and size `[a,b,c]` 
# of the cuboid. Both refer to the address of the buckets. It is 
# actually just a standard javascript array with each item being 
# either `null`, `loadingState` or a bucket. The length of the
# array is `a * b * c`. Also finding the containing bucket of a point 
# can be done with pretty simple math (see 
# `Model.Binary.bucketIndexByVertex`).
#
# Currently, we store separate sets of data for each zoom level.
#
# ###Inserting###
# When inserting new data into the data structure we first need
# to make sure the cube is big enough to cover all buckets. Otherwise
# we'll have to expand the cube (see `Model.Binary.extendByAddressExtent`). 
# Then we just set the buckets.  
#
# ##Loading##
# We do attempt to preload buckets intelligently (see 
# `Model.Binary.ping`). Using the camera matrix we use a transformed 
# preview volume (currently a cuboid) to determine which buckets are
# relevant to load right now. Those buckets are then enumerated starting
# with the current center of projection. They are used to populate a
# download queue, so 5 buckets can be loaded at a time.
# Once a new `Model.Binary.ping` is executed, the queue will be cleared
# again. This algorithm ensures the center bucket to be loaded first always.
#
# ##Querying##
# `Model.Binary.get` provides an interface to query the stored data.
# Give us an array of coordinates (vertices) and we'll give you the 
# corresponding color values. We apply either a linear, bilinear or 
# trilinear interpolation so the result should be quite smooth. However, 
# if one of the required 2, 4 or 8 points is missing we'll decide that 
# your requested point can't be valid aswell.
#

# Macros

tileIndexByTileMacro = (tile) ->

  tile[0] * (@TEXTURE_SIZE >> 5) + tile[1]


Binary =

  # Constants
  PING_THROTTLE_TIME : 10
  
  TEXTURE_SIZE : 512

  # Priorities
  PRIORITIES : [
    240, 239, 238, 237, 236, 235, 234, 233, 232, 231, 230, 229, 228, 227, 226, 225,
    241, 182, 181, 180, 179, 178, 177, 176, 175, 174, 173, 172, 171, 170, 169, 224,
    242, 183, 132, 131, 130, 129, 128, 127, 126, 125, 124, 123, 122, 121, 168, 223,
    243, 184, 133,  90,  89,  88,  87,  86,  85,  84,  83,  82,  81, 120, 167, 222,
    244, 185, 134,  91,  56,  55,  54,  53,  52,  51,  50,  49,  80, 119, 166, 221,
    245, 186, 135,  92,  57,  30,  29,  28,  27,  26,  25,  48,  79, 118, 165, 220,
    246, 187, 136,  93,  58,  31,  12,  11,  10,   9,  24,  47,  78, 117, 164, 219,
    247, 188, 137,  94,  59,  32,  13,   2,   1,   8,  23,  46,  77, 116, 163, 218,
    248, 189, 138,  95,  60,  33,  14,   3,   0,   7,  22,  45,  76, 115, 162, 217,
    249, 190, 139,  96,  61,  34,  15,   4,   5,   6,  21,  44,  75, 114, 161, 216,
    250, 191, 140,  97,  62,  35,  16,  17,  18,  19,  20,  43,  74, 113, 160, 215,
    251, 192, 141,  98,  63,  36,  37,  38,  39,  40,  41,  42,  73, 112, 159, 214,
    252, 193, 142,  99,  64,  65,  66,  67,  68,  69,  70,  71,  72, 111, 158, 213,
    253, 194, 143, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 157, 212,
    254, 195, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 211,
    255, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210]

  PRELOADING : [0,100,200]

  planes : [
    { layer : null, zoomStep : null, view : { u : 0, v : 1, w : 2 } }
    { layer : null, zoomStep : null, view : { u : 2, v : 1, w : 0 } }
    { layer : null, zoomStep : null, view : { u : 0, v : 2, w : 1 } }
  ]

  cubeReady : false

  init : () ->

    Cube.on "bucketLoaded", (bucket, zoomStep, oldZoomStep) =>

      for i in [0..2] by 1
        plane = @planes[i]

        continue unless plane.topLeftBucket

        if plane.layer >> 5 == bucket[plane.view.w] and oldZoomStep > plane.zoomStep

          u = (bucket[plane.view.u] >> plane.zoomStep) - plane.topLeftBucket[plane.view.u]
          v = (bucket[plane.view.v] >> plane.zoomStep) - plane.topLeftBucket[plane.view.v]

          if u in [0..@TEXTURE_SIZE >> 5] and v in [0..@TEXTURE_SIZE >> 5]
              #TODO Macro-Fix
              tile = [u, v]
              plane.tiles[tileIndexByTileMacro(tile)] = true
              if u in [plane.area[0]..plane.area[2]] and v in [plane.area[1]..plane.area[3]]
                plane.changed = true


  # Use this method to let us know when you've changed your spot. Then we'll try to 
  # preload some data. 
  ping : (position, zoomSteps, direction) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, zoomSteps, direction)

  pingImpl : (position, zoomSteps, direction) ->

    unless position == @lastPosition and direction == @lastDirection and _.isEqual(zoomSteps, @lastZoomSteps)

      @lastPosition = position
      @lastZoomSteps = zoomSteps.slice(0)
      @lastDirection = direction

      console.time "ping"

      positionBucket = [position[0] >> 5, position[1] >> 5, position[2] >> 5]
      zoomedPositionBucket = [positionBucket[0] >> zoomSteps[0], positionBucket[1] >> zoomSteps[0], positionBucket[2] >> zoomSteps[0]]


      resizeRadius = 5

      buckets  = @getBucketArray(zoomedPositionBucket, resizeRadius, resizeRadius, 0).concat(
                  @getBucketArray(zoomedPositionBucket, resizeRadius, 0, resizeRadius),
                  @getBucketArray(zoomedPositionBucket, 0, resizeRadius, resizeRadius))


      Cube.extendByBucketAddressExtent6(
        (zoomedPositionBucket[0] - resizeRadius) << zoomSteps[0], (zoomedPositionBucket[1] - resizeRadius) << zoomSteps[0], (zoomedPositionBucket[2] - resizeRadius) << zoomSteps[0],
        (zoomedPositionBucket[0] + resizeRadius) << zoomSteps[0], (zoomedPositionBucket[1] + resizeRadius) << zoomSteps[0], (zoomedPositionBucket[2] + resizeRadius) << zoomSteps[0]
      )

      console.time "queue"
      PullQueue.clear()

      direction = [0,0,1]
#      directionValue = Math.sqrt(direction[0]*direction[0] + direction[1]*direction[1] + direction[2]*direction[2])
#      directionMax   = Math.max(direction[0], direction[1], direction[2])
#      direction      = [direction[0]/directionMax, direction[1]/directionMax, direction[2]/directionMax]

#      directionValue = Math.max(directionValue, 0.01)         # so there is no division by 0
#      preloading = [0, Math.round(10/directionValue),         # TODO: optimze those values
#                    Math.round(100/directionValue),
#                    Math.round(200/directionValue),
#                    Math.round(300/directionValue)]
#
      delta_x = delta_y = delta_z = 0
      direction_x = direction_y = direction_z = 0
      index = buckets.length
      level = 0

 #     if zoomStep != 3            # don't do this if you need to load the lowest resolution anyway
 #     for coordinate in [0..2]
 #         i = [0, 0, 0]
 #         for indexValue in [0, 1, -1]
 #           i[coordinate] = indexValue
 #           for b in buckets3
 #             if b
 #               priority = Math.max(Math.abs(b[0] - @positionBucket3[0]), Math.abs(b[1] - @positionBucket3[1]), Math.abs(b[2] - @positionBucket3[2]))
 #               PullQueue.insert [b[0] + i[0], b[1] + i[1], b[2] + i[2]], 3, priority + Math.abs(indexValue)*buckets3.length
 #     console.timeEnd "queue 1"

      i = buckets.length * @PRELOADING.length
      while i--
        index--
        if buckets[index]
          # priority = Math.max(Math.abs(buckets[index][0] - @positionBucket[0]), Math.abs(buckets[index][1] - @positionBucket[1]), Math.abs(buckets[index][2] - @positionBucket3[2]))
          PullQueue.insert [buckets[index][0] + direction_x, buckets[index][1] + direction_y, buckets[index][2] + direction_z], zoomSteps[0], @PRIORITIES[index % @PRIORITIES.length] + @PRELOADING[level]

        unless i % buckets.length
          index = buckets.length
          level++

          delta_x += direction[0]
          delta_y += direction[1]
          delta_z += direction[2]
          direction_x = Math.round(delta_x)
          direction_y = Math.round(delta_y)
          direction_z = Math.round(delta_z)

    PullQueue.pull()

    @cubeReady = true


  get : (position, zoomStep, area, plane) ->

    $.when(@getSync(position, zoomStep, area, @planes[plane]))


  # A synchronized implementation of `get`. Cuz its faster.
  getSync : (position, zoomStep, area, plane) ->

    #zoomStep = 2
    #position[0] = 2688
    #position[1] = 2688
    #console.log "HERE WE GO"

    return unless @cubeReady

    topLeftPosition = position.slice(0)
    topLeftPosition
    topLeftPosition[plane.view.u] -= (@TEXTURE_SIZE >> 1) << zoomStep
    topLeftPosition[plane.view.v] -= (@TEXTURE_SIZE >> 1) << zoomStep

    topLeftBucket = Cube.vertexToZoomedBucketAddress(topLeftPosition, zoomStep)

    layer = position[plane.view.w]

    area = [
      area[0] >> 5
      area[1] >> 5
      area[2] - 1 >> 5
      area[3] - 1 >> 5
    ]

    unless _.isEqual(plane.layer, layer) and _.isEqual(plane.zoomStep, zoomStep)
      plane.layer = layer
      plane.zoomStep = zoomStep
      plane.topLeftBucket = topLeftBucket
      plane.area = area
      plane.tiles = @getTileArray(topLeftBucket, @TEXTURE_SIZE >> 5, @TEXTURE_SIZE >> 5, plane.view)
      plane.buffer = new Uint8Array(@TEXTURE_SIZE * @TEXTURE_SIZE)
      plane.changed = true

    unless _.isEqual(plane.topLeftBucket, topLeftBucket)
      oldTopLeftBucket = plane.topLeftBucket
      oldTiles = plane.tiles
      oldBuffer = plane.buffer

      plane.topLeftBucket = topLeftBucket
      plane.tiles = @getTileArray(topLeftBucket, @TEXTURE_SIZE >> 5, @TEXTURE_SIZE >> 5, plane.view)
      plane.buffer = new Uint8Array(@TEXTURE_SIZE * @TEXTURE_SIZE)
      plane.changed = true

      width = (@TEXTURE_SIZE >> 5) - Math.abs(plane.topLeftBucket[plane.view.u] - oldTopLeftBucket[plane.view.u])
      height = (@TEXTURE_SIZE >> 5) - Math.abs(plane.topLeftBucket[plane.view.v] - oldTopLeftBucket[plane.view.v])
      oldOffset = [
        Math.max(plane.topLeftBucket[plane.view.u] - oldTopLeftBucket[plane.view.u], 0)
        Math.max(plane.topLeftBucket[plane.view.v] - oldTopLeftBucket[plane.view.v], 0)
      ]
      newOffset = [
        Math.max(oldTopLeftBucket[plane.view.u] - plane.topLeftBucket[plane.view.u], 0)
        Math.max(oldTopLeftBucket[plane.view.v] - plane.topLeftBucket[plane.view.v], 0)
      ]

      for du in [0...width] by 1
        for dv in [0...height] by 1

          oldTile = [oldOffset[0] + du, oldOffset[1] + dv]
          newTile = [newOffset[0] + du, newOffset[1] + dv]

          oldTileIndex = tileIndexByTileMacro(oldTile)
          newTileIndex = tileIndexByTileMacro(newTile)

          if plane.tiles[newTileIndex] and not oldTiles[oldTileIndex]
            
            Renderer.copyTile(plane.buffer, newTile, oldBuffer, oldTile)
            plane.tiles[newTileIndex] = false

    if plane.changed or not _.isEqual(plane.area, area)
      plane.area = area
      plane.changed = false

      for u in [area[0]..area[2]] by 1
        for v in [area[1]..area[3]] by 1

          tile = [u, v]
          tileIndex = tileIndexByTileMacro(tile)
 
          if plane.tiles[tileIndex]
            Renderer.renderTile(tile, plane)
            plane.tiles[tileIndex] = false

      plane.buffer
    
    else
      null


  getTileArray : (offset, range_u, range_v, view) ->

    tiles = []

    for du in [0...range_u] by 1
      for dv in [0...range_v] by 1
        tiles.push offset[view.u] + du >= 0 and offset[view.v] + dv >= 0 and offset[view.w] >= 0

    tiles


  getBucketArray : (center, range_x, range_y, range_z) ->

    buckets = []

    #TODO
    for z in [-range_z..range_z]
      for y in [-range_y..range_y]
        for x in [-range_x..range_x]
          bucket = [center[0] + x, center[1] + y, center[2] + z]
          if x < 8 and y < 8 and z < 8
            buckets.push if _.min(bucket) >= 0 then bucket else null

    buckets

Binary.init()

Binary
