_ = require("lodash")

class ArbitraryCubeAdapter

  ARBITRARY_MAX_ZOOMSTEP : 2
  NOT_LOADED_BUCKET_INTENSITY : 100


  constructor : (@cube, @boundary) ->

    @sizeZYX = @boundary[0] * @boundary[1] * @boundary[2]
    @sizeZY  = @boundary[1] * @boundary[2]
    @sizeZ   = @boundary[2]

    @NOT_LOADED_BUCKET_DATA = new Uint8Array(@cube.BUCKET_LENGTH)
    for i in [0...@NOT_LOADED_BUCKET_DATA.length]
      @NOT_LOADED_BUCKET_DATA[i] = @NOT_LOADED_BUCKET_INTENSITY
    @NOT_LOADED_BUCKET_DATA.zoomStep = 0
    @NOT_LOADED_BUCKET_DATA.isTemporalData = true


  getBucket : _.memoize((bucketIndex) ->

    bucketAddress = [
      Math.floor(bucketIndex / @sizeZY),
      Math.floor((bucketIndex % @sizeZY) / @sizeZ),
      bucketIndex % @sizeZ,
      0
    ]

    for zoomStep in [0..@ARBITRARY_MAX_ZOOMSTEP]
      bucket = @cube.getBucket(bucketAddress)

      if bucket.isOutOfBoundingBox
        return null

      if bucket.hasData()
        bucketData = @cube.getBucket(bucketAddress).getData()
        bucketData.zoomStep = zoomStep
        return bucketData

      bucketAddress = [
        bucketAddress[0] >> 1
        bucketAddress[1] >> 1
        bucketAddress[2] >> 1
        bucketAddress[3] + 1
      ]

    return @NOT_LOADED_BUCKET_DATA
  )


  isValidBucket : (bucketIndex) ->

    return bucketIndex < @sizeZYX


  reset : ->

    @getBucket.cache.clear()


module.exports = ArbitraryCubeAdapter
