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
  MAXIMUM_BUCKET_COUNT : 500
  ARBITRARY_MAX_ZOOMSTEP : 2

  LOADING_PLACEHOLDER : {}

  arbitraryCube : null
  cubes : null
  upperBoundary : null
  access : null
  bucketCount : 0


  # The new cube stores the buckets in a seperate array for each zoomStep. For each
  # zoomStep the cube-array contains the boundaries and an array holding the buckets.
  # The bucket-arrays are initialized large enough to hold the whole cube. Thus no
  # expanding is necessary. bucketCount keeps track of how many buckets are currently
  # in the cube.
  #
  # Each bucket consists of an access-value, the zoomStep and the actual data.
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
    @cubes = []
    @access = new RingBuffer(4, 5000, Int32Array)

    # Initializing the cube-arrays with boundaries
    cubeBoundary = [
      @upperBoundary[0] >> @BUCKET_SIZE_P
      @upperBoundary[1] >> @BUCKET_SIZE_P
      @upperBoundary[2] >> @BUCKET_SIZE_P
    ]

    @arbitraryCube = { boundary: cubeBoundary.slice(), buckets: new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2]) }

    for i in [0..@ZOOM_STEP_COUNT]

      @cubes[i] = { boundary: cubeBoundary.slice(), buckets: new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2]) }
      cubeBoundary = [
        (cubeBoundary[0] + 1) >> 1
        (cubeBoundary[1] + 1) >> 1
        (cubeBoundary[2] + 1) >> 1
      ]


  getArbitraryCube : ->

    @arbitraryCube


  getBucketIndexByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    boundary = @cubes[zoomStep].boundary

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

    buckets = @cubes[address[3]].buckets
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex?
      buckets[bucketIndex]
    else
      undefined


  getBucketDataByZoomedAddress : (address) ->

    bucket = @getBucketByZoomedAddress(address)

    if bucket? and bucket.data != @LOADING_PLACEHOLDER

      @access.unshift(address)
      bucket.access++
      bucket.data

    else

      null


  isBucketRequestedByZoomedAddress : (address) ->

    buckets = @cubes[address[3]].buckets
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # if the bucket lies inseide the dataset
    if bucketIndex?

      # check whether bucket exists at all and is already requested or even loaded
      bucket = buckets[bucketIndex]
      bucket? and bucket.data?

    else

      # else their is no point requesting it
      true


  isBucketLoadedByZoomedAddress : (address) ->

    bucket = @getBucketByZoomedAddress(address)
    return bucket? and bucket.data? and bucket.data != @LOADING_PLACEHOLDER


  requestBucketByZoomedAddress : (address) ->

    # return if no request is needed
    return if @isBucketRequestedByZoomedAddress(address)

    buckets = @cubes[address[3]].buckets 
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # mark the bucket as requested
    if buckets[bucketIndex]?
      buckets[bucketIndex].data = @LOADING_PLACEHOLDER
    else
      buckets[bucketIndex] = { data: @LOADING_PLACEHOLDER, access: 0 }


  setBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep], bucketData) ->

    bucket = @getBucketByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])
    
    if bucketData?

      @bucketCount++
      @access.unshift([bucket_x, bucket_y, bucket_z, zoomStep])

      bucket.access++
      bucket.data = bucketData

      @trigger("bucketLoaded", [bucket_x, bucket_y, bucket_z, zoomStep])

      if zoomStep <= @ARBITRARY_MAX_ZOOMSTEP

        arbitraryCube = @arbitraryCube.buckets
        width = 1 << zoomStep

        for dx in [0...width] by 1
          for dy in [0...width] by 1
            for dz in [0...width] by 1

              subBucket = [
                (bucket_x << zoomStep) + dx
                (bucket_y << zoomStep) + dy
                (bucket_z << zoomStep) + dz
                0
              ]

              bucketIndex = @getBucketIndexByZoomedAddress(subBucket)

              if not arbitraryCube[bucketIndex] or arbitraryCube[bucketIndex].zoomStep > zoomStep

                bucketData.zoomStep = zoomStep
                #arbitraryCube[bucketIndex] = bucketData

    else

      bucket.data = null


  # tries to remove the bucket from the cube
  # and returns whether removing was successful
  tryCollectBucket : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    bucket = @getBucketByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    # if the bucket is no longer in the access-queue
    if bucket? and --bucket.access <= 0

      # remove it
      @bucketCount--
      bucket.data = null


  # remove buckets until cube is within bucketCount-limit
  collectGarbage : ->

    while @bucketCount > @MAXIMUM_BUCKET_COUNT and @access.length

      @tryCollectBucket(@access.pop())


  # return the bucket a given voxel lies in
  positionToZoomedAddress : ([x, y, z], zoomStep) ->

    [ x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]