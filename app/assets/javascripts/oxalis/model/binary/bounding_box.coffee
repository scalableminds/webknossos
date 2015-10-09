_ = require("lodash")

class BoundingBox


  constructor : ( @boundingBox, @cube ) ->

    @BUCKET_SIZE_P = @cube.BUCKET_SIZE_P
    @BYTE_OFFSET   = @cube.BYTE_OFFSET

    if @boundingBox?
      { @min, @max } = @boundingBox


  getBoxForZoomStep : ( zoomStep ) ->

    return {
      min : _.map @min, (e) => e >> ( @BUCKET_SIZE_P + zoomStep )
      max : _.map @max, (e) => e >> ( @BUCKET_SIZE_P + zoomStep )
    }


  containsBucket : ( [x, y, z, zoomStep] ) ->

    return true unless @boundingBox?

    { min, max } = @getBoxForZoomStep zoomStep

    return (
      min[0] <= x <= max[0] and
      min[1] <= y <= max[1] and
      min[2] <= z <= max[2]
    )


  containsFullBucket : ( [x, y, z, zoomStep] ) ->

    return true unless @boundingBox?

    { min, max } = @getBoxForZoomStep zoomStep

    return (
      min[0] < x < max[0] and
      min[1] < y < max[1] and
      min[2] < z < max[2]
    )


  removeOutsideArea : ( bucket, bucketData ) ->

    return if @containsFullBucket bucket

    baseVoxel = _.map bucket[0..2], (e) => e << ( @BUCKET_SIZE_P + bucket[3] )

    for dx in [0...(1 << @BUCKET_SIZE_P)]
      for dy in [0...(1 << @BUCKET_SIZE_P)]
        for dz in [0...(1 << @BUCKET_SIZE_P)]

          x = baseVoxel[0] + ( dx << bucket[3] )
          y = baseVoxel[1] + ( dy << bucket[3] )
          z = baseVoxel[2] + ( dz << bucket[3] )

          if (
            @min[0] <= x <= @max[0] and
            @min[1] <= y <= @max[1] and
            @min[2] <= z <= @max[2]
          )
            continue

          index = @cube.getVoxelIndexByVoxelOffset [dx, dy, dz]
          for b in [0...@BYTE_OFFSET]
            bucketData[index + b] = 0

    return

module.exports = BoundingBox
