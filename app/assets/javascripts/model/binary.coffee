### define
model/binary/cube : Cube
model/binary/pullqueue : PullQueue
model/game : Game
libs/simple_array_buffer_socket : SimpleArrayBufferSocket
libs/simple_worker : SimpleWorker
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

Binary =

  # Constants
  PING_THROTTLE_TIME : 200
  TEXTURE_SIZE : 256

  # This method allows you to query the data structure. Give us an array of
  # vertices and we'll the interpolated data.
  # 
  # Invalid points will have the value 0.

  getXY : (position, zoomStep) ->

    $.when(@getXYSync(position, zoomStep))

  # A synchronized implementation of `get`. Cuz its faster.
  getXYSync : (position, zoomStep) ->

    buffer = new Uint8Array(@TEXTURE_SIZE * @TEXTURE_SIZE)

    unless _.isEqual({position, zoomStep}, {@position, @zoomStep})

      @lastPosition = position
      @lastZoomStep = zoomStep

      @positionBucket = [position[0] >> (5 + zoomStep), position[1] >> (5 + zoomStep), position[2] >> (5 + zoomStep)]
      @bucketsXY = @getBucketArray(@positionBucket, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6, 0)
      #@bucketsXZ = @getBucketArray(@positionBucket, @TEXTURE_SIZE >> 6, 0, @TEXTURE_SIZE >> 6)
      #@bucketsYZ = @getBucketArray(@positionBucket, 0, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6)

    if cubeData = Cube.getSubCubeByZoomStep(zoomStep)

      { cube, cubeSize, cubeOffset } = cubeData

      offset_x = position[0] & 31
      offset_y = position[1] & 31
      offset_z = position[2] & 31

      texture_x = -offset_x
      texture_y = -offset_y
      for y in [0..(@TEXTURE_SIZE >> 5)]
        texture_y = (y << 5) - offset_y
        height = 32
        off_y = 0
        if y == 0
          texture_y = 0
          height = 32 - offset_y
          off_y = offset_y
        if y == (@TEXTURE_SIZE >> 5)
          height = offset_y

        for x in [0..(@TEXTURE_SIZE >> 5)]
          texture_x = (x << 5) - offset_x
          width = 32
          off_x = 0
          if x == 0
            texture_x = 0
            width = 32 - offset_x
            off_x = offset_x
          if x == (@TEXTURE_SIZE >> 5)
            width = offset_x

          if @bucketsXY[y*((@TEXTURE_SIZE >> 5) + 1) + x] and colors = cube[Cube.bucketIndexByAddress(@bucketsXY[y*((@TEXTURE_SIZE >> 5) + 1) + x], zoomStep)]
            @renderBucketToBuffer(colors, 1024, 32-1024*width, texture_y*@TEXTURE_SIZE + texture_x, 1024*off_x + 32*off_y + offset_z, @TEXTURE_SIZE - width, buffer, width, height)
          else
            console.log "bucker missing:", @bucketsXY[y*((@TEXTURE_SIZE >> 5) + 1) + x]
    buffer

  renderBucketToBuffer : (colors, pixelDelta, rowDelta, offset, bucketOffset, bufferDelta, buffer, w, h) ->
    bufferIndex = offset
    bucketIndex = bucketOffset
    i = w * h
    while i--
      buffer[bufferIndex++] = colors[bucketIndex]
      bucketIndex += pixelDelta
      unless i % w
        bucketIndex += rowDelta
        bufferIndex += bufferDelta

  # Use this method to let us know when you've changed your spot. Then we'll try to 
  # preload some data. 
  ping : (position, zoomStep) ->

    @ping = _.throttle(@pingImpl, @PING_THROTTLE_TIME)
    @ping(position, zoomStep)

  pingImpl : (position, zoomStep) ->

    unless _.isEqual({ position, zoomStep }, { @lastPosition, @lastZoomStep })

      @lastPosition = position
      @lastZoomStep = zoomStep

      console.time "ping"

      @positionBucket = [position[0] >> (5 + zoomStep), position[1] >> (5 + zoomStep), position[2] >> (5 + zoomStep)]
      @bucketsXY = @getBucketArray(@positionBucket, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6, 0)
      #@bucketsXZ = @getBucketArray(@positionBucket, @TEXTURE_SIZE >> 6, 0, @TEXTURE_SIZE >> 6)
      #@bucketsYZ = @getBucketArray(@positionBucket, 0, @TEXTURE_SIZE >> 6, @TEXTURE_SIZE >> 6)

      Cube.extendByBucketAddressExtent6(
        @positionBucket[0] - (@TEXTURE_SIZE >> 6), @positionBucket[1] - (@TEXTURE_SIZE >> 6), @positionBucket[2] - (@TEXTURE_SIZE >> 6),
        @positionBucket[0] + (@TEXTURE_SIZE >> 6), @positionBucket[1] + (@TEXTURE_SIZE >> 6), @positionBucket[2] + (@TEXTURE_SIZE >> 6),
        zoomStep)

      console.time "queue"
      PullQueue.clear()

      i = @bucketsXY.length
      console.log i
      while i--
        if @bucketsXY[i]
          PullQueue.insert [@bucketsXY[i][0], @bucketsXY[i][1], @bucketsXY[i][2], zoomStep], i

      console.timeEnd "queue"
      PullQueue.pull()
      console.timeEnd "ping"

  getBucketArray : (center, range_x, range_y, range_z) ->

    buckets = []

    for z in [-range_z..range_z]
      for y in [-range_y..range_y]
        for x in [-range_x..range_x]
          bucket = [center[0] + x, center[1] + y, center[2] + z]
          buckets.push if _.min(bucket) >= 0 then bucket else null

    buckets
