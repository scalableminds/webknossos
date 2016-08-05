_             = require("lodash")
Cube          = require("./cube")
Request       = require("../../../libs/request")

class PullQueue

  # Constants
  BATCH_LIMIT : 6

  # For buckets that should be loaded immediately and
  # should never be removed from the queue
  PRIORITY_HIGHEST : -1

  cube : null
  queue : null

  batchCount : 0
  roundTripTime : 0


  constructor : (@cube, @layer, @boundingBox, @connectionInfo, @datastoreInfo) ->

    @queue = []
    @BATCH_SIZE = if @isNDstore() then 1 else 3
    @fourBit = false

    # Debug option.
    # If true, buckets of all 0 will be transformed to have 255 bytes everywhere.
    @whitenEmptyBuckets = false


  pull : ->

    # Filter and sort queue, using negative priorities for sorting so .pop() can be used to get next bucket
    @queue = _.filter(@queue, (item) =>
      @boundingBox.containsBucket(item.bucket) and
        @cube.getBucketByZoomedAddress(item.bucket).needsRequest()
    )
    @queue = _.sortBy(@queue, (item) -> item.priority)

    # Starting to download some buckets
    while @batchCount < @BATCH_LIMIT and @queue.length

      batch = []
      while batch.length < @BATCH_SIZE and @queue.length
        address = @queue.shift().bucket
        bucket = @cube.getBucketByZoomedAddress(address)

        continue unless bucket.needsRequest()

        batch.push(address)
        bucket.pull()

      if batch.length > 0
        @pullBatch(batch)


  pullBatch : (batch) ->

    # Loading a bunch of buckets
    @batchCount++
    fourBit = @shouldRequestFourBit()

    # Measuring the time until response arrives to select appropriate preloading strategy
    roundTripBeginTime = new Date()

    Request.always(
      @layer.requestFromStore(batch.map((b) => @getBucketData(b))).then((responseBuffer) =>
        @connectionInfo.log(@layer.name, roundTripBeginTime, batch.length, responseBuffer.length)

        offset = 0
        for bucket in batch
          if fourBit
            bucketData = @decodeFourBit(responseBuffer.subarray(offset, offset += (@cube.BUCKET_LENGTH >> 1)))
          else
            bucketData = responseBuffer.subarray(offset, offset += @cube.BUCKET_LENGTH)
          @boundingBox.removeOutsideArea(bucket, bucketData)
          @maybeWhitenEmptyBucket(bucketData)
          @cube.getBucketByZoomedAddress(bucket).receiveData(bucketData)
      ).catch(=>
        for bucketAddress in batch
          bucket = @cube.getBucketByZoomedAddress(bucketAddress)
          bucket.pullFailed()
          if bucket.dirty
            @add({bucket : bucketAddress, priority : @PRIORITY_HIGHEST})
      )
      =>
        @batchCount--
        @pull()
    )


  getBucketData : (bucket) =>

    zoomStep = bucket[3]
    return {
      position : [
        bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
      ]
      zoomStep : zoomStep
      cubeSize : 1 << @cube.BUCKET_SIZE_P
      fourBit : @shouldRequestFourBit()
    }


  clearNormalPriorities : ->

    @queue = _.filter(@queue, (e) => e.priority == @PRIORITY_HIGHEST)


  add : (item) ->

    @queue.push(item)


  addAll : (items) ->

    @queue = @queue.concat(items)


  decodeFourBit : (colors) ->

    # Expand 4-bit data
    newColors = new Uint8Array(colors.length << 1)

    index = 0
    while index < newColors.length
      value = colors[index >> 1]
      newColors[index] = value & 0b11110000
      index++
      newColors[index] = value << 4
      index++

    newColors


  setFourBit : (@fourBit) ->


  shouldRequestFourBit : ->

    return @fourBit and @layer.category == "color" and not @isNDstore()


  isNDstore : ->

    return @datastoreInfo.typ == "ndstore"


  maybeWhitenEmptyBucket : (bucketData) ->

    return unless @whitenEmptyBuckets

    allZero = _.reduce(bucketData, ((res, e) -> res and e == 0), true)

    if allZero
      for i in [0...bucketData.length]
        bucketData[i] = 255


module.exports = PullQueue
