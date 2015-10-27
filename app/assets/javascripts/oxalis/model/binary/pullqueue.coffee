Cube              = require("./cube")
Request           = require("libs/request")
MultipartData     = require("libs/multipart_data")

class PullQueue

  # Constants
  BATCH_LIMIT : 6
  BATCH_SIZE : 3
  MESSAGE_TIMEOUT : 10000

  # For buckets that should be loaded immediately and
  # should never be removed from the queue
  PRIORITY_HIGHEST : -1

  cube : null
  queue : null

  dataSetName : ""

  batchCount : 0
  roundTripTime : 0


  constructor : (@dataSetName, @cube, @layer, @tracingId, @boundingBox, @connctionInfo) ->

    @queue = []


  pull : ->
    # Filter and sort queue, using negative priorities for sorting so .pop() can be used to get next bucket
    @queue = _.filter(@queue, (item) =>
      (@boundingBox.containsBucket(item.bucket) and
          not @cube.isBucketRequestedByZoomedAddress(item.bucket))
    )
    @queue = _.sortBy(@queue, (item) -> item.priority)

    # Starting to download some buckets
    while @batchCount < @BATCH_LIMIT and @queue.length

      items = @queue.splice(0, Math.min(@BATCH_SIZE, @queue.length))
      batch = (item.bucket for item in items)
      @pullBatch(batch)


  pullBatch : (batch) ->
    # Loading a bunch of buckets

    @batchCount++

    requestData = new MultipartData()

    for bucket in batch
      @cube.requestBucketByZoomedAddress(bucket)
      zoomStep = bucket[3]

      requestData.addPart(
        "X-Bucket": JSON.stringify(
          position: [
            bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
            bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
            bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
          ]
          zoomStep: zoomStep
          cubeSize: 1 << @cube.BUCKET_SIZE_P
          fourBit: @shouldRequestFourBit()))

    # Measuring the time until response arrives to select appropriate preloading strategy
    roundTripBeginTime = new Date()

    @sendRequest(requestData)
      .then(

        (responseBuffer) =>

          @connctionInfo.log(@layer.name, roundTripBeginTime, batch.length, responseBuffer.length)

          offset = 0

          for bucket, i in batch
            if bucket.fourBit
              bucketData = @decode4bit(responseBuffer.subarray(offset, offset += (@cube.BUCKET_LENGTH >> 1)))
            else
              bucketData = responseBuffer.subarray(offset, offset += @cube.BUCKET_LENGTH)

            @boundingBox.removeOutsideArea(bucket, bucketData)
            @cube.setBucketByZoomedAddress(bucket, bucketData)

        =>
          for bucket in batch
            @cube.setBucketByZoomedAddress(bucket, null)

    ).always =>

      @batchCount--
      @pull()


  clearNormalPriorities : ->

    @queue = _.filter(@queue, (e) => e.priority == @PRIORITY_HIGHEST)


  add : (item) ->

    @queue.push(item)


  addAll : (items) ->

    @queue = @queue.concat(items)


  decode4Bit : (colors) ->

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

    return @fourBit and @layer.category == "color"


  sendRequest : (multipartData) ->

    multipartData.dataPromise().then((data) =>
      Request.send(
        multipartData : data
        multipartBoundary : multipartData.boundary
        url : "#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?token=#{@layer.token}"
        dataType : 'arraybuffer'
        timeout : @MESSAGE_TIMEOUT
        compress : true
      ).then (buffer) ->
        if buffer
          new Uint8Array(buffer)
        else
          []
    )


module.exports = PullQueue
