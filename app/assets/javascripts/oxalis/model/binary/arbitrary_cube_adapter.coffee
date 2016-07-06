_ = require("lodash")

class ArbitraryCubeAdapter

  ARBITRARY_MAX_ZOOMSTEP : 2


  constructor : (@cube, @boundary) ->

    @sizeZYX = @boundary[0] * @boundary[1] * @boundary[2]
    @sizeZY  = @boundary[1] * @boundary[2]
    @sizeZ   = @boundary[2]


  getBucket : _.memoize((bucketIndex) ->

    return null unless @isValidBucket(bucketIndex)

    bucketAddress = [
      Math.floor(bucketIndex / @sizeZY),
      Math.floor((bucketIndex % @sizeZY) / @sizeZ),
      bucketIndex % @sizeZ,
      0
    ]

    for zoomStep in [0..@ARBITRARY_MAX_ZOOMSTEP]
      if @cube.getBucketByZoomedAddress(bucketAddress).hasData()
        bucketData = @cube.getBucketByZoomedAddress(bucketAddress).getData()
        bucketData.zoomStep = zoomStep
        return bucketData

      bucketAddress = [
        bucketAddress[0] >> 1
        bucketAddress[1] >> 1
        bucketAddress[2] >> 1
        bucketAddress[3] + 1
      ]

    return null
  )


  isValidBucket : (bucketIndex) ->

    return bucketIndex < @sizeZYX


  reset : ->

    @getBucket.cache.clear()


module.exports = ArbitraryCubeAdapter
