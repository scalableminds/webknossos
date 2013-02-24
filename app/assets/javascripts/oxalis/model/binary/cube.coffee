### define
../../../libs/event_mixin : EventMixin
../../../libs/ring_buffer : RingBuffer
../../../libs/request : Request
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


  # The cube stores the buckets in a seperate array for each zoomStep. For each
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

    @arbitraryCube = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
    @arbitraryCube.boundary = cubeBoundary.slice()

    for i in [0...@ZOOM_STEP_COUNT]

      @cubes[i] = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
      @cubes[i].boundary = cubeBoundary.slice()

      cubeBoundary = [
        (cubeBoundary[0] + 1) >> 1
        (cubeBoundary[1] + 1) >> 1
        (cubeBoundary[2] + 1) >> 1
      ]


  getArbitraryCube : ->

    @arbitraryCube


  getBucketIndexByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->
    
    $.assertNotIs(@cubes[zoomStep], "undefined", "Cube for given zoomStep does not exist"
      cubeCount: @cubes.length
      zoomStep: zoomStep
      zoomStepCount: @ZOOM_STEP_COUNT
    )

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

    cube = @cubes[address[3]]
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex? and (bucket = cube[bucketIndex]) != @LOADING_PLACEHOLDER
      bucket
    else
      null


  isBucketRequestedByZoomedAddress : (address) ->

    cube = @cubes[address[3]]
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # if the bucket does not lie inside the dataset, return true
    not bucketIndex? or cube[bucketIndex]?


  isBucketLoadedByZoomedAddress : (address) ->

    @getBucketByZoomedAddress(address)?


  requestBucketByZoomedAddress : (address) ->

    # return if no request is needed
    return if @isBucketRequestedByZoomedAddress(address)

    cube = @cubes[address[3]]
    bucketIndex = @getBucketIndexByZoomedAddress(address)
    cube[bucketIndex] = @LOADING_PLACEHOLDER


  setBucketByZoomedAddress : (address, bucketData) ->

    if bucketData?

      cube = @cubes[address[3]]
      bucketIndex = @getBucketIndexByZoomedAddress(address)

      @bucketCount++
      @access.unshift(address)
      bucketData.access = 1
      bucketData.zoomStep = address[3]

      cube[bucketIndex] = bucketData

      @setArbitraryBucketByZoomedAddress(address, bucketData) if address[3] <= @ARBITRARY_MAX_ZOOMSTEP
      @trigger("bucketLoaded", address)


  setArbitraryBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep], bucketData) ->

    cube = @arbitraryCube

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
          bucket = cube[bucketIndex]

          cube[bucketIndex] = bucketData if not bucket? or bucket.zoomStep > zoomStep


  accessBuckets : (addressList) ->

    for address in addressList

      bucket = @getBucketByZoomedAddress(address)

      if bucket?
        @access.unshift(address)
        bucket.access++
    console.log addressList.length, @access.length, @bucketCount


  # tries to remove the bucket from the cube
  tryCollectBucket : (address) ->

    cube = @cubes[address[3]]
    bucketIndex = @getBucketIndexByZoomedAddress(address)
    bucket = cube[bucketIndex]

    # if the bucket is no longer in the access-queue
    if bucket? and --bucket.access <= 0

      # remove it
      @bucketCount--
      cube[bucketIndex] = null

      @collectArbitraryBucket(address, bucket) if address[3] <= @ARBITRARY_MAX_ZOOMSTEP


  collectArbitraryBucket : ([bucket_x, bucket_y, bucket_z, zoomStep], oldBucket) ->

    cube = @arbitraryCube

    substitute = null
    substituteAddress = [
      bucket_x >> 1
      bucket_y >> 1
      bucket_z >> 1
      zoomStep + 1
    ]

    while substituteAddress[3] <= @ARBITRARY_MAX_ZOOMSTEP and not (substitute = @getBucketByZoomedAddress(substituteAddress))?

          substituteAddress[0] >>= 1
          substituteAddress[1] >>= 1
          substituteAddress[2] >>= 1
          substituteAddress[3]++

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
              
          cube[bucketIndex] = substitute if cube[bucketIndex] == oldBucket


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