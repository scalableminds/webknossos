### define
../../../libs/event_mixin : EventMixin
###

class Cube

  # Constants
  BUCKET_SIZE_P : 5
  BUCKET_LENGTH : 0
  ZOOM_STEP_COUNT : 10
  LOOKUP_DEPTH_UP : 2
  LOOKUP_DEPTH_DOWN : 3

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

    cube = @cube[zoomStep]

    bucket_x * cube.boundary[2] * cube.boundary[1] +
    bucket_y * cube.boundary[1] +
    bucket_z


  requestBucketByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

    cube = @cube[zoomStep]
    bucketIndex = @getBucketIndexByZoomedAddress([bucket_x, bucket_y, bucket_z, zoomStep])

    unless cube.buckets[bucketIndex]?
      cube.buckets[bucketIndex] = { data: @LOADING_PLACEHOLDER, level: @ZOOM_STEP_COUNT }
      return true

    return cube.buckets[bucketIndex].level > @LOOKUP_DEPTH_DOWN and cube.buckets[bucketIndex].data != @LOADING_PLACEHOLDER


  getZoomStepByAddress : (bucket) ->

#    bucketIndex = @getBucketIndexByAddress(bucket)

 #   if bucketIndex? and @cube[bucketIndex]
  #    @cube[bucketIndex].zoomStep
   # else
    #  @ZOOM_STEP_COUNT


  getRequestedZoomStepByAddress : (bucket) ->

#    bucketIndex = @getBucketIndexByAddress(bucket)

 #   if bucketIndex? and @cube[bucketIndex]
  #    @cube[bucketIndex].requestedZoomStep
   # else
    #  @ZOOM_STEP_COUNT


  getWorstRequestedZoomStepByZoomedAddress : ([bucket_x, bucket_y, bucket_z, zoomStep]) ->

#    if zoomStep

 #     x = bucket_x << zoomStep
  #    y = bucket_y << zoomStep
   #   z = bucket_z << zoomStep

    #  worstZoomStep = 0
     # tmp = 0
      #width = 1 << zoomStep
#      for dx in [0...width] by 1
 #       for dy in [0...width] by 1
  #        for dz in [0...width] by 1
   #         tmp = @getRequestedZoomStepByAddress([x + dx, y + dy, z + dz])
    #        worstZoomStep = tmp if tmp > worstZoomStep
     #       return worstZoomStep if worstZoomStep == @ZOOM_STEP_COUNT
    
      #worstZoomStep

#    else

 #     @getRequestedZoomStepByAddress([bucket_x, bucket_y, bucket_z])

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

    if bucket.level < oldBucketLevel and bucket.level < @LOOKUP_DEPTH_DOWN

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

      cube.buckets[bucketIndex].data = bucketData
      cube.buckets[bucketIndex].level = 0
      @updateLevel([
        bucket_x >> 1
        bucket_y >> 1
        bucket_z >> 1
        zoomStep + 1
      ])

    else

      cube.buckets[bucketIndex].data = null


  positionToZoomedAddress : ([x, y, z], zoomStep) ->

    [ x >> @BUCKET_SIZE_P + zoomStep,
      y >> @BUCKET_SIZE_P + zoomStep,
      z >> @BUCKET_SIZE_P + zoomStep,
      zoomStep
    ]