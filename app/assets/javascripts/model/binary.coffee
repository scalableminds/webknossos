### define
model/binary/cube : Cube
model/binary/pullqueue : PullQueue
model/binary/plane2d : Plane2D
model/game : Game
###

# Macros

tileIndexByTileMacro = (tile) ->

  tile[0] * (@TEXTURE_SIZE >> 5) + tile[1]


class Binary

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
    new Plane2D()
    new Plane2D()
    new Plane2D()
  ]


  #######################

  cube : null
  queue : null

  # Constants
  TEXTURE_SIZE : 512
  PING_THROTTLE_TIME : 1000


  constructor : () ->

    @cube = new Cube()
    @queue = new PullQueue("507b1796e4b0b75f0b2827bc", @cube) # TODO

#    @cube.on "bucketLoaded", (bucket, newZoomStep, oldZoomStep) =>

 #     for i in [0..2] by 1
#        plane = @planes[i]

  #      continue unless plane.topLeftBucket

   #     if plane.layer >> 5 == bucket[plane.view.w] and oldZoomStep > plane.zoomStep
#
 #         u = (bucket[plane.view.u] >> plane.zoomStep) - plane.topLeftBucket[plane.view.u]
  #        v = (bucket[plane.view.v] >> plane.zoomStep) - plane.topLeftBucket[plane.view.v]

   #       if u in [0..@TEXTURE_SIZE >> 5] and v in [0..@TEXTURE_SIZE >> 5]
    #          #TODO Macro-Fix
     #         tile = [u, v]
      #        plane.tiles[tileIndexByTileMacro(tile)] = true
       #       if u in [plane.area[0]..plane.area[2]] and v in [plane.area[1]..plane.area[3]]
        #        plane.changed = true

  ping : (position, zoomSteps, direction) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, zoomSteps, direction)

  pingImpl : (position, zoomSteps, direction) ->

    unless position == @lastPosition and direction == @lastDirection and _.isEqual(zoomSteps, @lastZoomSteps)

      console.log "changed"

      @lastPosition = position
      @lastZoomSteps = zoomSteps.slice(0)
      @lastDirection = direction

      console.time "ping"

      positionBucket = [position[0] >> 5, position[1] >> 5, position[2] >> 5]
      zoomedPositionBucket = [positionBucket[0] >> zoomSteps[0], positionBucket[1] >> zoomSteps[0], positionBucket[2] >> zoomSteps[0]]

      buckets   = @getBucketArray(zoomedPositionBucket, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6, 0).concat(
                  @getBucketArray(zoomedPositionBucket, @TEXTURE_SIZE >> 6, 0, @TEXTURE_SIZE >> 6),
                  @getBucketArray(zoomedPositionBucket, 0, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6))

      # Buckets of zoom step 3 so that there won't be any black
#      @positionBucket3 = [position[0] >> (5 + 3), position[1] >> (5 + 3), position[2] >> (5 + 3)]
#      buckets3  = @getBucketArray(@positionBucket3, @TEXTURE_SIZE >> (6 + 3 - zoomStep), @TEXTURE_SIZE >> (6 + 3 - zoomStep), 0).concat(
#                  @getBucketArray(@positionBucket3, @TEXTURE_SIZE >> (6 + 3 - zoomStep), 0, @TEXTURE_SIZE >> (6 + 3 - zoomStep)),
#                  @getBucketArray(@positionBucket3, 0, @TEXTURE_SIZE >> (6 + 3 - zoomStep), @TEXTURE_SIZE >> (6 + 3 - zoomStep)))

      resizeRadius = (@TEXTURE_SIZE >> 6)

      @cube.extendByBucketAddressExtent(
        [(zoomedPositionBucket[0] - resizeRadius) << zoomSteps[0], (zoomedPositionBucket[1] - resizeRadius) << zoomSteps[0], (zoomedPositionBucket[2] - resizeRadius) << zoomSteps[0]],
        [(zoomedPositionBucket[0] + resizeRadius) << zoomSteps[0], (zoomedPositionBucket[1] + resizeRadius) << zoomSteps[0], (zoomedPositionBucket[2] + resizeRadius) << zoomSteps[0]]
     #   0,0,0,200,200,200
      )

      console.time "queue"
      @queue.clear()

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

      i = buckets.length #* @PRELOADING.length
      while i--
        index--
        if buckets[index]
         # priority = Math.max(Math.abs(buckets[index][0] - @positionBucket[0]), Math.abs(buckets[index][1] - @positionBucket[1]), Math.abs(buckets[index][2] - @positionBucket3[2]))
          @queue.insert [buckets[index][0] + direction_x, buckets[index][1] + direction_y, buckets[index][2] + direction_z, zoomSteps[0]], @PRIORITIES[index % @PRIORITIES.length]# + @PRELOADING[level]# + buckets3.length

        unless i % buckets.length
          index = buckets.length
          level++

          #delta_x += direction[0]
          #delta_y += direction[1]
          #delta_z += direction[2]
          #direction_x = Math.round(delta_x)
          #direction_y = Math.round(delta_y)
          #direction_z = Math.round(delta_z)

    @queue.pull()


  get : (position, zoomStep, area, plane) ->

    $.when(@getSync(position, zoomStep, area, plane))


  getSync : (position, zoomStep, area, plane) ->

    @planes[plane].get(position, zoomStep, area)


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