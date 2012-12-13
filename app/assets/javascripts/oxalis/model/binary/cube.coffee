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
  requests : 0
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

    console.log @


  getBucketIndexByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    cube = @cube[zoomStep]
    boundary = cube.boundary

    if bucket_x >= 0 and bucket_x < boundary[0] and
    bucket_y >= 0 and bucket_y < boundary[1] and
    bucket_z >= 0 and bucket_z < boundary[2] and
    zoomStep >= 0 and zoomStep < @ZOOM_STEP_COUNT

      bucket_x * cube.boundary[2] * cube.boundary[1] +
      bucket_y * cube.boundary[2] +
      bucket_z

    else

      undefined


  getBucketDataByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    cube = @cube[zoomStep]

    bucketIndex = @getBucketIndexByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    if bucketIndex? and cube.buckets[bucketIndex]?

      cube.buckets[bucketIndex].data

    else

      undefined    


  requestBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    cube = @cube[zoomStep]
    bucketIndex = @getBucketIndexByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    return false if not bucketIndex? or cube.buckets[bucketIndex]? and (cube.buckets[bucketIndex].level <= @LOOKUP_DEPTH_UP or cube.buckets[bucketIndex].data == @LOADING_PLACEHOLDER)
    
    cube.buckets[bucketIndex] = { data: @LOADING_PLACEHOLDER, level: @ZOOM_STEP_COUNT }
    return true


  isBucketLoaded : (bucket) ->

#    bucketData = @getBucketDataByZoomedAddress(bucket)
  #   bucketData? and bucketData != @LOADING_PLACEHOLDER

    cube = @cube[bucket[3]]
    bucketIndex = @getBucketIndexByZoomedAddress(bucket)
    bucketData = cube.buckets[bucketIndex]
    bucketData? and bucketData.data != @LOADING_PLACEHOLDER

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

    cube = @cube[zoomStep]

    bucketIndex = @getBucketIndexByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])
    
    if bucketData?
      @requests--
      cube.buckets[bucketIndex].data = bucketData
      cube.buckets[bucketIndex].level = 0
      @updateLevel([
        bucket_x >> 1
        bucket_y >> 1
        bucket_z >> 1
        zoomStep + 1
      ])
      @trigger("bucketLoaded", [bucket_x, bucket_y, bucket_z, zoomStep])

    else

      cube.buckets[bucketIndex].data = null


  positionToZoomedAddress : ([x, y, z], zoomStep) ->

    [ x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]