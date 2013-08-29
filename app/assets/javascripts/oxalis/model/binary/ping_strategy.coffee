### define
../dimensions : Dimensions
###

class PingStrategy

  # Constants
  TEXTURE_SIZE_P : 0


  velocityRangeStart : 0
  velocityRangeEnd : 0

  roundTripTimeRangeStart : 0
  roundTripTimeRangeEnd : 0

  cube : null

  constructor : (@cube, @TEXTURE_SIZE_P) ->


  inVelocityRange : (value) ->

    @velocityRangeStart <= value <= @velocityRangeEnd


  inRoundTripTimeRange : (value) ->

    @roundTripTimeRangeStart <= value <= @roundTripTimeRangeEnd


  ping : ->

    throw "Needs to be implemented in subclass"
    {
      pullQueue : [ x0, y0, z0, zoomStep0, x1, y1, z1, zoomStep1 ]
      extent : { min_x, min_y, min_z, max_x, max_y, max_z }
    }


class PingStrategy.DslSlow extends PingStrategy

  velocityRangeStart : 0
  velocityRangeEnd : Infinity

  roundTripTimeRangeStart : 0
  roundTripTimeRangeEnd : Infinity

  ping : (position, direction, zoomStep, area, activePlane) ->

    pullQueue = [] 

    for plane in [0..2]
      [@u, @v, @w] = Dimensions.getIndices(plane)

      # Converting area from voxels to buckets
      bucketArea = [
        area[plane][0] >> @cube.BUCKET_SIZE_P
        area[plane][1] >> @cube.BUCKET_SIZE_P
        area[plane][2] - 1 >> @cube.BUCKET_SIZE_P
        area[plane][3] - 1 >> @cube.BUCKET_SIZE_P
      ]

      centerBucket = @cube.positionToZoomedAddress(position, zoomStep)
      buckets = @getBucketArray(centerBucket, @TEXTURE_SIZE_P - 1, bucketArea)

      for bucket in buckets
        if bucket?
          priority = Math.abs(bucket[0] - centerBucket[0]) + Math.abs(bucket[1] - centerBucket[1]) + Math.abs(bucket[2] - centerBucket[2])
          pullQueue.push([[bucket[0], bucket[1], bucket[2], zoomStep], priority])
          if plane == activePlane
            # preload only for active plane
            if direction[@w] >= 0 then bucket[@w]++ else bucket[@w]--
            pullQueue.push([[bucket[0], bucket[1], bucket[2], zoomStep], priority << 1])
            if direction[@w] >= 0 then bucket[@w]++ else bucket[@w]--
            pullQueue.push([[bucket[0], bucket[1], bucket[2], zoomStep], priority << 2])

    pullQueue


  getBucketArray : (center, range, area) ->

    buckets = []
    for u in [-(range-area[0])..(area[2]-range)]
      for v in [-(range-area[1])..(area[3]-range)]
        bucket = center.slice(0)
        bucket[@u] += u
        bucket[@v] += v
        buckets.push if _.min(bucket) >= 0 then bucket else null

    buckets


  strategyName : ->
    
    "DSL_SLOW"


PingStrategy