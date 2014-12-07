### define
backbone : Backbone
###

class Cube

  # Constants
  BUCKET_SIZE_P : 5
  CUBE_SIZE_P   : 7
  LOCAL_ID_SIZE_P : 16
  BUCKET_LENGTH : 0
  ZOOM_STEP_COUNT : 0
  LOOKUP_DEPTH_UP : 0
  LOOKUP_DEPTH_DOWN : 1
  MAXIMUM_BUCKET_COUNT : 5000
  ARBITRARY_MAX_ZOOMSTEP : 2

  LOADING_PLACEHOLDER : {}
  EMPTY_MAPPING : []

  arbitraryCube : null
  dataCubes : null
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

    _.extend(this, Backbone.Events)

    @LOOKUP_DEPTH_UP = @ZOOM_STEP_COUNT - 1
    @BUCKET_LENGTH   = (1 << @BUCKET_SIZE_P * 3) * (@BIT_DEPTH >> 3)
    @BYTE_OFFSET     = (@BIT_DEPTH >> 3)

    @cubes = []
    @buckets = new Array(@MAXIMUM_BUCKET_COUNT)

    @mapping = @EMPTY_MAPPING
    @currentMapping = @mapping

    # Initializing the cube-arrays with boundaries
    cubeBoundary = [
      Math.ceil(@upperBoundary[0] / (1 << @BUCKET_SIZE_P))
      Math.ceil(@upperBoundary[1] / (1 << @BUCKET_SIZE_P))
      Math.ceil(@upperBoundary[2] / (1 << @BUCKET_SIZE_P))
    ]

    @arbitraryCube = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
    @arbitraryCube.boundary = cubeBoundary.slice()

    for i in [0...@ZOOM_STEP_COUNT]

      @cubes[i] = {}
      @cubes[i].data = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
      @cubes[i].boundary = cubeBoundary.slice()

      cubeBoundary = [
        (cubeBoundary[0] + 1) >> 1
        (cubeBoundary[1] + 1) >> 1
        (cubeBoundary[2] + 1) >> 1
      ]


  setPushQueue : (pushQueue) ->

    @pushQueue = pushQueue


  setMappingEnabled : (isEnabled) ->

    @currentMapping = if isEnabled then @mapping else @EMPTY_MAPPING
    @trigger("newMapping")


  hasMapping : ->

    return @mapping.length != 0


  setMapping : (newMapping) ->

    # TODO: Remove, only for simulation purposes
    if not newMapping.length
      newMapping = new newMapping.constructor(1 << @BIT_DEPTH)
      for i in [0...(1 << @BIT_DEPTH)]
        newMapping[i] = if i == 0 then 0 else i + 1

    if @currentMapping == @mapping
      @currentMapping = newMapping
    @mapping = newMapping

    @trigger("newMapping")


  mapId : (idToMap) ->

    mappedId = @currentMapping[idToMap]
    return if mappedId? then mappedId else idToMap


  getArbitraryCube : ->

    @arbitraryCube


  getBucketIndexByZoomedAddress : ( address ) ->

    $.assertExists(@cubes[address[3]], "Cube for given zoomStep does not exist"
      cubeCount: @cubes.length
      zoomStep: address[3]
      zoomStepCount: @ZOOM_STEP_COUNT
    )

    return @getIndexFromZoomedAddress( address, @cubes[address[3]].boundary )


  getIndexFromZoomedAddress : ([x, y, z, zoomStep], boundary) ->

    if x >= 0 and x < boundary[0] and
    y >= 0 and y < boundary[1] and
    z >= 0 and z < boundary[2] and
    zoomStep >= 0 and zoomStep < @ZOOM_STEP_COUNT

      x * boundary[2] * boundary[1] +
      y * boundary[2] +
      z

    else

      undefined


  getVoxelIndexByVoxelOffset : ([x, y, z]) ->

    x +
    y * (1 << @BUCKET_SIZE_P) +
    z * (1 << @BUCKET_SIZE_P * 2)


  getBucketDataByZoomedAddress : (address, createIfUndefined = false) ->

    if address[3] >= @ZOOM_STEP_COUNT
      return null

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex?
      bucket = cube[bucketIndex]
      if bucket? and bucket != @LOADING_PLACEHOLDER
        return bucket
      else if createIfUndefined
        cube[bucketIndex] = new Uint8Array(@BUCKET_LENGTH)
        cube[bucketIndex].temporal = true
        @trigger("temporalBucketCreated", address)
        return cube[bucketIndex]

    return null


  isBucketRequestedByZoomedAddress : (address) ->

    if address[3] >= @ZOOM_STEP_COUNT
      return true

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    # if the bucket does not lie inside the dataset, return true
    if not bucketIndex?
      return true

    return cube[bucketIndex]? and not cube[bucketIndex].temporal


  isBucketLoadedByZoomedAddress : (address) ->

    @getBucketDataByZoomedAddress(address)?


  requestBucketByZoomedAddress : (address) ->

    # return if no request is needed
    return if @isBucketRequestedByZoomedAddress(address)

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)
    if not cube[bucketIndex]?
      cube[bucketIndex] = @LOADING_PLACEHOLDER


  setBucketByZoomedAddress : (address, bucketData) ->

    if bucketData?

      cube = @cubes[address[3]].data
      bucketIndex = @getBucketIndexByZoomedAddress(address)

      @addBucketToGarbageCollection(address)

      @bucketCount++
      bucketData.accessed = true
      bucketData.zoomStep = address[3]

      @setBucketData(cube, bucketIndex, bucketData)

      @setArbitraryBucketByZoomedAddress(address, bucketData) if address[3] <= @ARBITRARY_MAX_ZOOMSTEP
      @trigger("bucketLoaded", address)


  setBucketData : (cube, bucketIndex, newBucketData) ->

    oldBucketData = cube[bucketIndex]

    if cube[bucketIndex]?.temporal
      newBucketData = @mergeBucketData(newBucketData, oldBucketData)

    cube[bucketIndex] = newBucketData
    oldBucketData?.bucketReplacedCallback?()


  mergeBucketData : (newBucketData, oldBucketData) ->

    voxelPerBucket = 1 << @BUCKET_SIZE_P * 3
    for i in [0...voxelPerBucket]

      voxelData = (oldBucketData[i * @BYTE_OFFSET + j] for j in [0...@BYTE_OFFSET])
      voxelEmpty = _.reduce(voxelData, ((memo, v) => memo and v == 0), true)

      unless voxelEmpty
        for j in [0...@BYTE_OFFSET]
          newBucketData[i * @BYTE_OFFSET + j] = oldBucketData[i * @BYTE_OFFSET + j]

    return newBucketData


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

      bucket = @getBucketDataByZoomedAddress(address)
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
    bucket = @getBucketDataByZoomedAddress(address)

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

    while substituteAddress[3] <= @ARBITRARY_MAX_ZOOMSTEP and not (substitute = @getBucketDataByZoomedAddress(substituteAddress))?

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

    @trigger("volumeLabeled")


  labelVoxels : (iterator, label) ->

    while iterator.hasNext
      voxel = iterator.getNext()
      @labelVoxel(voxel, label)

    @pushQueue.push()
    @trigger("volumeLabeled")


  labelVoxel : (voxel, label) ->

    voxelInCube = true
    for i in [0..2]
      voxelInCube &= 0 <= voxel[i] < @upperBoundary[i]

    if voxelInCube

      { bucket, voxelIndex } = @getBucketAndVoxelIndex(voxel, 0, true)

      # Write label in little endian order
      for i in [0...@BYTE_OFFSET]
        bucket[voxelIndex + i] = (label >> (i * 8) ) & 0xff

      # Make sure temporal buckets are not saved before merged
      if bucket.temporal
        bucket.bucketReplacedCallback = =>
          @pushQueue.insert(@positionToZoomedAddress(voxel))
          @pushQueue.push()
      else
        @pushQueue.insert(@positionToZoomedAddress(voxel))


  getDataValue : ( voxel, mapping=@EMPTY_MAPPING ) ->

    { bucket, voxelIndex} = @getBucketAndVoxelIndex( voxel, 0 )

    if bucket?

      result = 0
      # Assuming little endian byte order
      for i in [0...@BYTE_OFFSET]
        result += (1 << (8 * i)) * bucket[ voxelIndex + i]

      if mapping?[result]?
        return mapping[result]

      return result

    return 0


  getMappedDataValue : (voxel) ->

    return @getDataValue(voxel, @currentMapping)


  getBucketAndVoxelIndex : (voxel, zoomStep, createBucketIfUndefined = false ) ->

    address     = @positionToZoomedAddress( voxel, zoomStep )
    voxelOffset = @getVoxelOffset( voxel )

    return {
      bucket : @getBucketDataByZoomedAddress(address, createBucketIfUndefined)
      voxelIndex : @BYTE_OFFSET * @getVoxelIndexByVoxelOffset(voxelOffset) }


  getVoxelOffset : ( [x, y, z] ) ->

    return [
      x & 0b11111
      y & 0b11111
      z & 0b11111
    ]


  positionToZoomedAddress : ([x, y, z], zoomStep = 0) ->
    # return the bucket a given voxel lies in

    [
      x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]

