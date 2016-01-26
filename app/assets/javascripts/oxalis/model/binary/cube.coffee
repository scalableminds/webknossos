Backbone = require("backbone")
_ = require("lodash")
ErrorHandling = require("libs/error_handling")
{Bucket, NullBucket} = require("./bucket")
ArbitraryCubeAdapter = require("./arbitrary_cube_adapter")

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

  EMPTY_MAPPING : null

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

    @NULL_BUCKET = new NullBucket(@BIT_DEPTH)

    @LOOKUP_DEPTH_UP = @ZOOM_STEP_COUNT - 1
    @MAX_ZOOM_STEP   = @ZOOM_STEP_COUNT - 1
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

    @arbitraryCube = new ArbitraryCubeAdapter(@, cubeBoundary.slice())

    for i in [0...@ZOOM_STEP_COUNT]

      @cubes[i] = {}
      @cubes[i].data = new Array(cubeBoundary[0] * cubeBoundary[1] * cubeBoundary[2])
      @cubes[i].boundary = cubeBoundary.slice()

      cubeBoundary = [
        (cubeBoundary[0] + 1) >> 1
        (cubeBoundary[1] + 1) >> 1
        (cubeBoundary[2] + 1) >> 1
      ]


  setMapping : (@mapping) ->

    @trigger("mappingChanged")


  setPushQueue : (@pushQueue) ->


  setMappingEnabled : (isEnabled) ->

    @currentMapping = if isEnabled then @mapping else @EMPTY_MAPPING
    @trigger("newMapping")


  hasMapping : ->

    return @mapping?


  setMapping : (newMapping) ->

    # Generate fake mapping
    #if not newMapping.length
    #  newMapping = new newMapping.constructor(1 << @BIT_DEPTH)
    #  for i in [0...(1 << @BIT_DEPTH)]
    #    newMapping[i] = if i == 0 then 0 else i + 1

    if @currentMapping == @mapping
      @currentMapping = newMapping
    @mapping = newMapping

    @trigger("newMapping")


  mapId : (idToMap) ->

    return if @currentMapping? and (mappedId = @currentMapping[idToMap])? then mappedId else idToMap


  getArbitraryCube : ->

    return @arbitraryCube


  getVoxelIndexByVoxelOffset : ([x, y, z]) ->

    return x + y * (1 << @BUCKET_SIZE_P) + z * (1 << @BUCKET_SIZE_P * 2)


  getBucketIndexByZoomedAddress : ([x, y, z, zoomStep]) ->

    ErrorHandling.assertExists(@cubes[zoomStep], "Cube for given zoomStep does not exist"
      cubeCount: @cubes.length
      zoomStep: zoomStep
      zoomStepCount: @ZOOM_STEP_COUNT
    )

    boundary = @cubes[zoomStep].boundary

    if  x >= 0 and x < boundary[0] and
        y >= 0 and y < boundary[1] and
        z >= 0 and z < boundary[2]

      return x * boundary[2] * boundary[1] + y * boundary[2] + z

    else

      return undefined


  getBucketByZoomedAddress : (address) ->

    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex?
      unless cube[bucketIndex]?
        cube[bucketIndex] = @createBucket(address)
      return cube[bucketIndex]

    return @NULL_BUCKET


  createBucket : (address) ->

    bucket = new Bucket(@BIT_DEPTH, address)
    bucket.on
      bucketLoaded : => @trigger("bucketLoaded", address)
    @addBucketToGarbageCollection(bucket)
    return bucket


  accessBuckets : (addressList) ->

    for address in addressList

      bucket = @getBucketByZoomedAddress(address)
      bucket.access()


  addBucketToGarbageCollection : (bucket) ->

    unless @bucketCount < @MAXIMUM_BUCKET_COUNT

      while(not @buckets[@bucketIterator].shouldCollect())

        @bucketIterator = ++@bucketIterator % @MAXIMUM_BUCKET_COUNT

      @collectBucket(@buckets[@bucketIterator])
      @bucketCount--

    @bucketCount++
    @buckets[@bucketIterator] = bucket
    @bucketIterator = ++@bucketIterator % @MAXIMUM_BUCKET_COUNT


  collectBucket : (bucket) ->

    address = bucket.zoomedAddress
    cube = @cubes[address[3]].data
    bucketIndex = @getBucketIndexByZoomedAddress(address)
    cube[bucketIndex] = null


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

      mergedCallback = _.debounce((=>
        @pushQueue.insert(@positionToZoomedAddress(voxel))
        @pushQueue.push()), 1000)

      labelFunc = (data) =>
        # Write label in little endian order
        for i in [0...@BYTE_OFFSET]
          data[voxelIndex + i] = (label >> (i * 8) ) & 0xff

      bucket.label(labelFunc, mergedCallback)


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

    address = @positionToZoomedAddress( voxel, zoomStep )

    [x, y, z] = voxel.map((v) -> v & 0b11111)
    voxelIndex = x + y * (1 << @BUCKET_SIZE_P) + z * (1 << @BUCKET_SIZE_P * 2)

    return {
      bucket : @getBucketByZoomedAddress(address, createBucketIfUndefined)
      voxelIndex : @BYTE_OFFSET * voxelIndex }


  positionToZoomedAddress : ([x, y, z], zoomStep = 0) ->
    # return the bucket a given voxel lies in

    [
      x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]

module.exports = Cube
