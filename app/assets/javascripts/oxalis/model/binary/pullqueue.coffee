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
    @url = "#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?cubeSize=#{1 << @cube.BUCKET_SIZE_P}&token=#{@layer.token}"


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

    requestData = new MultipartData()

    for bucket in batch
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

    Request.always(
      requestData.dataPromise().then((data) =>
        Request.sendArraybufferReceiveArraybuffer("#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?token=#{@layer.token}",
          data : data
          headers :
            "Content-Type" : "multipart/mixed; boundary=#{requestData.boundary}"
          timeout : @MESSAGE_TIMEOUT
          compress : true
        ).then(
          (responseBuffer) =>
            responseBuffer = new Uint8Array(responseBuffer)
            @connctionInfo.log(@layer.name, roundTripBeginTime, batch.length, responseBuffer.length)

            offset = 0

            for bucket, i in batch
              if bucket.fourBit
                bucketData = @decode4bit(responseBuffer.subarray(offset, offset += (@cube.BUCKET_LENGTH >> 1)))
              else
                bucketData = responseBuffer.subarray(offset, offset += @cube.BUCKET_LENGTH)

              @boundingBox.removeOutsideArea(bucket, bucketData)
              @cube.getBucketByZoomedAddress(bucket).receiveData(bucketData)
        )
        =>
          for bucket in batch
            @add({bucket : bucket, priority : @PRIORITY_HIGHEST})
      )
      =>
        @batchCount--
        @pull()
    )


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


module.exports = PullQueue
