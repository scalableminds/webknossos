### define
../../../libs/event_mixin : EventMixin
../../../libs/ring_buffer : RingBuffer
###

class Cube

  # Constants
  BUCKET_SIZE_P : 5
  BUCKET_LENGTH : 0
  ZOOM_STEP_COUNT : 0
  LOOKUP_DEPTH_UP : 0
  LOOKUP_DEPTH_DOWN : 1
  MAXIMUM_BUCKET_COUNT : 5000

  LOADING_PLACEHOLDER : {}

  cube : null
  upperBoundary : null
  access : null
  bucketCount : 0


  # The new cube stores the buckets in a seperate array for each zoomStep. For each
  # zoomStep the cube-array contains the boundaries and an array holding the buckets.
  # The bucket-arrays are initialized large enough to hold the whole cube. Thus no
  # expanding is necessary. bucketCount keeps track of how many buckets are currently
  # in the cube.
  #
  # Each bucket consists of a level-value, an access-value and the actual data.
  # The lavel-values indiating wheter the bucket itself is loaded or has to be
  # assembeled from higher resolution buckets. A value of 0 means, the bucket itself
  # is loaded. Levels higher than 0 indicate, that buckets from the next "level" layers
  # are needed. The lookup of higher / lower resolution buckets to replace a bucket
  # an be configured using the LOOKUP_DEPTH_UP (lower resolution) and LOOKUP_DEPTH_DOWN
  # (higher resolution) constants. When buckets are added or removed the level-values
  # of lower resolution buckets have to be updated.
  #
  # The access-values are used for garbage collection. When a bucket is accessed, its
  # address is pushed to the access-queue and its access-value is increased by 1.
  # When buckets are needed, the buckets at the beginning of the queue will be removed
  # from the queue and the access-value will be decreased. If the access-value of a
  # bucket becomes 0, itsis no longer in the access-queue and is least resently used.
  # It is then removed from the cube.


  constructor : (@upperBoundary, @ZOOM_STEP_COUNT) ->

    _.extend(@, new EventMixin())

    @LOOKUP_DEPTH_UP = @ZOOM_STEP_COUNT
    @BUCKET_LENGTH = 1 << @BUCKET_SIZE_P * 3
    @cube = []
    @access = new RingBuffer(@MAXIMUM_BUCKET_COUNT * 30)

    # Initializing the cube-arrays with boundaries
    cubeBoundary = [
      @upperBoundary[0] >> @BUCKET_SIZE_P
      @upperBoundary[1] >> @BUCKET_SIZE_P
      @upperBoundary[2] >> @BUCKET_SIZE_P
    ]

    for i in [0..@ZOOM_STEP_COUNT]

      @cube[i] = { boundary: cubeBoundary.slice(), buckets: new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2]) }
      cubeBoundary = [
        (cubeBoundary[0] + 1) >> 1
        (cubeBoundary[1] + 1) >> 1
        (cubeBoundary[2] + 1) >> 1
      ]


  getBucketIndexByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    boundary = @cube[zoomStep].boundary

    if bucket_x >= 0 and bucket_x < boundary[0] and
    bucket_y >= 0 and bucket_y < boundary[1] and
    bucket_z >= 0 and bucket_z < boundary[2] and
    zoomStep >= 0 and zoomStep < @ZOOM_STEP_COUNT

      bucket_x * boundary[2] * boundary[1] +
      bucket_y * boundary[2] +
      bucket_z

    else

      undefined


  getBucketByZoomedAddress : (address) ->

    buckets = @cube[address[3]].buckets
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex?
      buckets[bucketIndex]
    else
      undefined


  getBucketDataByZoomedAddress : (address) ->

    bucket = @getBucketByZoomedAddress(address)

    if bucket?

      @access.unshift(address)
      bucket.access++
      bucket.data

    else

      null


  isBucketRequestedByZoomedAddress : (address) ->

    buckets = @cube[address[3]].buckets
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # if the bucket lies inseide the dataset
    if bucketIndex?

      # check whether bucket exists at all, it can be assembled from other buckets or is already requested
      bucket = buckets[bucketIndex]
      bucket? and (bucket.level <= @LOOKUP_DEPTH_DOWN or bucket.data == @LOADING_PLACEHOLDER)

    else

      # else their is no point requesting it
      true


  isBucketLoadedByZoomedAddress : (address) ->

    bucket = @getBucketByZoomedAddress(address)
    return bucket? and bucket.level == 0


  requestBucketByZoomedAddress : (address) ->

    # return if no request is needed
    return if @isBucketRequestedByZoomedAddress(address)

    buckets = @cube[address[3]].buckets 
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # mark the bucket as requested
    if buckets[bucketIndex]?
      buckets[bucketIndex].data = @LOADING_PLACEHOLDER
    else
      buckets[bucketIndex] = { data: @LOADING_PLACEHOLDER, level: @LOOKUP_DEPTH_DOWN + 1, access: 0 }


  setBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep], bucketData) ->

    bucket = @getBucketByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])
    
    if bucketData?

      @bucketCount++
      @access.unshift([bucket_x, bucket_y, bucket_z, zoomStep])

      bucket.access++
      bucket.data = bucketData
      bucket.level = 0

      # the bucket with a lower zoomStep can maybe be assembled
      # from buckets with the current zoomStep now
      #@updateBucketChain([
      #  bucket_x >> 1
      #  bucket_y >> 1
      #  bucket_z >> 1
      #  zoomStep + 1
      #])

      @trigger("bucketLoaded", [bucket_x, bucket_y, bucket_z, zoomStep])

    else

      bucket.data = null


  updateBucket : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    return false if zoomStep == 0 or zoomStep == @ZOOM_STEP_COUNT 

    cube = @cube[zoomStep]
    bucketIndex = @getBucketIndexByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    cube.buckets[bucketIndex] = { data: null, level: @LOOKUP_DEPTH_DOWN + 1, access: 0 } unless cube.buckets[bucketIndex]?

    bucket = cube.buckets[bucketIndex]

    return false if bucket.level == 0

    oldBucketLevel = bucket.level
    bucket.level = 0

    subCube = @cube[zoomStep - 1]

    for dx in [0..1]
      for dy in [0..1]
        for dz in [0..1]

          subBucketIndex = @getBucketIndexByZoomedAddress([(bucket_x << 1) + dx, (bucket_y << 1) + dy, (bucket_z << 1) + dz, zoomStep - 1])

          unless subCube.buckets[subBucketIndex]?

            bucket.level = @LOOKUP_DEPTH_DOWN + 1
            return bucket.level != oldBucketLevel

          bucket.level = Math.max(bucket.level, subCube.buckets[subBucketIndex].level + 1)

    bucket.level = Math.min(bucket.level, @LOOKUP_DEPTH_DOWN + 1)
    bucket.level != oldBucketLevel


  updateBucketChain : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    while @updateBucket([bucket_x, bucket_y, bucket_z, zoomStep])

      bucket_x >>= 1
      bucket_y >>= 1
      bucket_z >>= 1
      zoomStep += 1


  # tries to remove the bucket from the cube
  # and returns whether removing was successful
  tryCollectBucket : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    bucket = @getBucketByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    # if the bucket is no longer in the access-queue
    if bucket? and --bucket.access <= 0

      # remove it
      @bucketCount--
      bucket.data = null
      bucket.level = @LOOKUP_DEPTH_DOWN + 1

      # if buckets with a lower zoomStep rely on this bucket
      # they need to get informed
      #@updateBucket([bucket_x, bucket_y, bucket_z, zoomStep])
      #@updateBucketChain([
      #  bucket_x >> 1
      #  bucket_y >> 1
      #  bucket_z >> 1
      #  zoomStep + 1
      #])
      true

    else

      false


  # remove buckets until cube is within bucketCount-limit
  collectGarbage : ->

    while @bucketCount > @MAXIMUM_BUCKET_COUNT and @access.length

      @tryCollectBucket(@access.pop())


  positionToZoomedAddress : ([x, y, z], zoomStep) ->

    [ x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]