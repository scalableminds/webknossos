Cube              = require("./cube")
Request           = require("libs/request")

class PullQueue

  # Constants
  BATCH_LIMIT : 6
  BATCH_SIZE : 3

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

    transmitBuffer = []
    for bucket in batch
      zoomStep = bucket[3]
      transmitBuffer.push(
        zoomStep
        if @shouldRequestFourBit(zoomStep) then 1 else 0
        bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
      )

    # Measuring the time until response arrives to select appropriate preloading strategy
    roundTripBeginTime = new Date()

    Request.always(
      Request.sendArraybufferReceiveArraybuffer(
        @url
        data: new Float32Array(transmitBuffer)
      ).then(
        (responseBuffer) =>

          responseBuffer = new Uint8Array(responseBuffer)
          @connctionInfo.log(@layer.name, roundTripBeginTime, batch.length, responseBuffer.length)

          offset = 0

          for bucket, i in batch
            if transmitBuffer[i * 5 + 1]
              bucketData = @decode(responseBuffer.subarray(offset, offset += (@cube.BUCKET_LENGTH >> 1)))
            else
              bucketData = responseBuffer.subarray(offset, offset += @cube.BUCKET_LENGTH)

            @boundingBox.removeOutsideArea(bucket, bucketData)
            @cube.getBucketByZoomedAddress(bucket).receiveData(bucketData)
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


  decode : (colors) ->

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


  shouldRequestFourBit : (zoomStep) ->

    return @fourBit and @layer.category == "color"


module.exports = PullQueue
