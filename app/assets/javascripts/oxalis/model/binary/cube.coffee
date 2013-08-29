### define
libs/event_mixin : EventMixin
###

class Cube

  # Constants
  BUCKET_SIZE_P : 5
  BUCKET_LENGTH : 0
  ZOOM_STEP_COUNT : 0
  LOOKUP_DEPTH_UP : 0
  LOOKUP_DEPTH_DOWN : 1
  MAXIMUM_BUCKET_COUNT : 5000
  ARBITRARY_MAX_ZOOMSTEP : 2

  LOADING_PLACEHOLDER : {}

  arbitraryCube : null
  dataCubes : null
  volumeCubes : null
  upperBoundary : null

  buckets : null
  bucketIterator : 0
  bucketCount : 0


  # The cube stores the buckets in a seperate array for each zoomStep. For each
  # zoomStep the cube-array contains the boundaries and an array holding the buckets.
  # The bucket-arrays are initialized large enough to hold the whole cube. Thus no
  # expanding is necessary. bucketCount keeps track of how many buckets are currently
  # in the cube.
  #
  # Each bucket consists of an access-value, the zoomStep and the actual data.
  # The access-values are used for garbage collection. When a bucket is accessed, its
  # access-flag is set to true.
  # When buckets have to be collected, an iterator will loop through the the buckets at the beginning of the queue will be removed
  # from the queue and the access-value will be decreased. If the access-value of a
  # bucket becomes 0, itsis no longer in the access-queue and is least resently used.
  # It is then removed from the cube.


  constructor : (@upperBoundary, @ZOOM_STEP_COUNT, @BIT_DEPTH) ->

    _.extend(@, new EventMixin())

    @LOOKUP_DEPTH_UP = @ZOOM_STEP_COUNT - 1
    @BUCKET_LENGTH = (1 << @BUCKET_SIZE_P * 3) * (@BIT_DEPTH >> 3)

    @cubes = []
    @buckets = new Array(@MAXIMUM_BUCKET_COUNT)

    # Initializing the cube-arrays with boundaries
    cubeBoundary = [
      @upperBoundary[0] >> @BUCKET_SIZE_P
      @upperBoundary[1] >> @BUCKET_SIZE_P
      @upperBoundary[2] >> @BUCKET_SIZE_P
    ]

    @arbitraryCube = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
    @arbitraryCube.boundary = cubeBoundary.slice()

    for i in [0...@ZOOM_STEP_COUNT]

      @cubes[i] = {}
      @cubes[i].data = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
      @cubes[i].volume = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
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


  getVoxelIndexByVoxelOffset : ([x, y, z]) ->

    x +
    y * (1 << @BUCKET_SIZE_P) + 
    z * (1 << @BUCKET_SIZE_P * 2)


  getDataBucketByZoomedAddress : (address) ->

    if address[3] >= @ZOOM_STEP_COUNT
      return null

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex? and (bucket = cube[bucketIndex]) != @LOADING_PLACEHOLDER
      bucket
    else
      null


  getVolumeBucketByZoomedAddress : (address) ->

    if address[3] >= @ZOOM_STEP_COUNT
      return null

    cube = @cubes[address[3]].volume
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    cube[bucketIndex]


  getOrCreateVolumeBucketByZoomedAddress : (address) ->

    cube = @cubes[address[3]].volume
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if (bucket = cube[bucketIndex])?
      bucket
    else
      cube[bucketIndex] = new Uint8Array(@BUCKET_LENGTH)


  isBucketRequestedByZoomedAddress : (address) ->

    if address[3] >= @ZOOM_STEP_COUNT
      return true

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # if the bucket does not lie inside the dataset, return true
    not bucketIndex? or cube[bucketIndex]?


  isBucketLoadedByZoomedAddress : (address) ->

    @getDataBucketByZoomedAddress(address)?


  requestBucketByZoomedAddress : (address) ->

    # return if no request is needed
    return if @isBucketRequestedByZoomedAddress(address)

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)
    cube[bucketIndex] = @LOADING_PLACEHOLDER


  setBucketByZoomedAddress : (address, bucketData) ->

    if bucketData?

      cube = @cubes[address[3]].data
      bucketIndex = @getBucketIndexByZoomedAddress(address)

      @addBucketToGarbageCollection(address)

      @bucketCount++
      bucketData.accessed = true
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

      bucket = @getDataBucketByZoomedAddress(address)
      bucket.accessed = true if bucket?


  addBucketToGarbageCollection : (address) ->

    unless @bucketCount < @MAXIMUM_BUCKET_COUNT

      while((bucket = @buckets[@bucketIterator]).accessed)

        bucket.accessed = false
        @bucketIterator = ++@bucketIterator % MAXIMUM_BUCKET_COUNT

      @collectBucket(bucket)
      @bucketCount--

    @buckets[@bucketIterator] = address
    @bucketIterator = ++@bucketIterator % @MAXIMUM_BUCKET_COUNT


  collectBucket : (address) ->

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)
    bucket = @getDataBucketByZoomedAddress(address)

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

    while substituteAddress[3] <= @ARBITRARY_MAX_ZOOMSTEP and not (substitute = @getDataBucketByZoomedAddress(substituteAddress))?

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

  labelTestShape : ->
    # draw a sqhere, centered at (100, 100, 100) with radius 50

    for x in [80..120]
      for y in [80..120]
        for z in [80..120]

          if Math.sqrt((x-100) * (x-100) + (y-100) * (y-100) + (z-100) * (z-100)) <= 20
            @labelVoxel([x, y, z], 5)

    @trigger("volumeLabled")


  labelVoxels : (iterator, label) ->

    while iterator.hasNext
      voxel = iterator.getNext()
      @labelVoxel(voxel, label)

    @trigger("volumeLabled")


  labelVoxel : (voxel, label) ->

    voxelInCube = true
    for i in [0..2]
      voxelInCube &= voxel[i] in [0...@upperBoundary[i]]

    if voxelInCube
      
      for zoomStep in [0...@ZOOM_STEP_COUNT]

        { bucket, voxelIndex } = @getBucketAndVoxelIndex( voxel, zoomStep )

        break if bucket[voxelIndex] == label
        bucket[voxelIndex] = label

        voxel = [
          voxel[0] >> 1
          voxel[1] >> 1
          voxel[2] >> 1
        ]


  getLabel : ( voxel ) ->

    { bucket, voxelIndex } = @getBucketAndVoxelIndex( voxel, 0 )
    return bucket[voxelIndex]


  getDataValue : ( voxel ) ->

    byteOffset = (@BIT_DEPTH >> 3)
    address    = @positionToZoomedAddress( voxel, 0 )
    voxelIndex = byteOffset * @getVoxelIndexByVoxelOffset( @getVoxelOffset( voxel ) )
    bucket     = @getDataBucketByZoomedAddress( address )

    if bucket?
      result = 0
      for i in [0...byteOffset]
        result += (1 << (8 * i)) * bucket[ voxelIndex + byteOffset - 1 - i]
      return result

    return null


  getBucketAndVoxelIndex : (voxel, zoomStep ) ->

    address = @positionToZoomedAddress( voxel, zoomStep )
    voxelOffset = @getVoxelOffset( voxel )

    return {
      bucket : @getOrCreateVolumeBucketByZoomedAddress(address)
      voxelIndex : @getVoxelIndexByVoxelOffset(voxelOffset) }


  getVoxelOffset : ( [x, y, z] ) ->

    return [
      x & 0b11111
      y & 0b11111
      z & 0b11111
    ]
    

  positionToZoomedAddress : ([x, y, z], zoomStep) ->
    # return the bucket a given voxel lies in

    [
      x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]
