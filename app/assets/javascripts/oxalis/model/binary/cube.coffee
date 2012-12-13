### define
../../../libs/event_mixin : EventMixin
###

class Cube

  # Constants
  BUCKET_SIZE_P : 5
  BUCKET_LENGTH : 0
  ZOOM_STEP_COUNT : 10
  LOOKUP_DEPTH_UP : 2
  LOOKUP_DEPTH_DOWN : 0

  LOADING_PLACEHOLDER : {}
  cube : null
  upperBoundary : null


  constructor : (@upperBoundary) ->

    _.extend(@, new EventMixin())

    @BUCKET_LENGTH = 1 << @BUCKET_SIZE_P * 3
    @cube = []

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
    if bucket? then bucket.data else null


  isBucketRequestedByZoomedAddress : (address) ->

    buckets = @cube[address[3]].buckets
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if bucketIndex?

      bucket = buckets[bucketIndex]
      bucket? and (bucket.level <= @LOOKUP_DEPTH_UP or bucket.data == @LOADING_PLACEHOLDER)

    else

      true


  isBucketLoadedByZoomedAddress : (address) ->

    bucket = @getBucketByZoomedAddress(address)
    return bucket? and bucket.level == 0


  requestBucketByZoomedAddress : (address) ->

    return if @isBucketRequestedByZoomedAddress(address)

    buckets = @cube[address[3]].buckets 
    bucketIndex = @getBucketIndexByZoomedAddress(address)

    if buckets[bucketIndex]?
      buckets[bucketIndex].data = @LOADING_PLACEHOLDER
    else
      buckets[bucketIndex] = { data: @LOADING_PLACEHOLDER, level: @ZOOM_STEP_COUNT }


  updateLevel : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    return if zoomStep == @ZOOM_STEP_COUNT

    cube = @cube[zoomStep]
    bucketIndex = @getBucketIndexByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    cube.buckets[bucketIndex] = { data: null, level: @ZOOM_STEP_COUNT } unless cube.buckets[bucketIndex]?

    bucket = cube.buckets[bucketIndex]
    return if bucket.level <= 1

    oldBucketLevel = bucket.level
    bucket.level = 0

    subCube = @cube[zoomStep - 1]

    for dx in [0..1]
      for dy in [0..1]
        for dz in [0..1]

          subBucketIndex = @getBucketIndexByZoomedAddress([(bucket_x << 1) + dx, (bucket_y << 1) + dy, (bucket_z << 1) + dz, zoomStep - 1])

          unless subCube.buckets[subBucketIndex]?
            bucket.level = @ZOOM_STEP_COUNT
            return

          bucket.level = Math.max(bucket.level, subCube.buckets[subBucketIndex].level + 1)

    if bucket.level < oldBucketLevel and bucket.level < @LOOKUP_DEPTH_UP

      @updateLevel([
        bucket_x >> 1
        bucket_y >> 1
        bucket_z >> 1
        zoomStep + 1
      ])


  setBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep], bucketData) ->

    bucket = @getBucketByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])
    
    if bucketData?
      bucket.data = bucketData
      bucket.level = 0
      @updateLevel([
        bucket_x >> 1
        bucket_y >> 1
        bucket_z >> 1
        zoomStep + 1
      ])
      @trigger("bucketLoaded", [bucket_x, bucket_y, bucket_z, zoomStep])

    else

      bucket.data = null


  positionToZoomedAddress : ([x, y, z], zoomStep) ->

    [ x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]