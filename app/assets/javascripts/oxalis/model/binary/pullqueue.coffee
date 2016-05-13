_             = require("lodash")
Cube          = require("./cube")
Request       = require("../../../libs/request")
MultipartData = require("../../../libs/multipart_data")

class PullQueue

  # Constants
  BATCH_LIMIT : 6
  MESSAGE_TIMEOUT : 10000

  # For buckets that should be loaded immediately and
  # should never be removed from the queue
  PRIORITY_HIGHEST : -1

  cube : null
  queue : null

  dataSetName : ""

  batchCount : 0
  roundTripTime : 0


  constructor : (@dataSetName, @cube, @layer, @boundingBox, @connectionInfo, @datastoreInfo) ->

    @queue = []
    @url = "#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?cubeSize=#{1 << @cube.BUCKET_SIZE_P}&token=#{@layer.token}"
    @BATCH_SIZE = if @isNDstore() then 1 else 3

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

    # Measuring the time until response arrives to select appropriate preloading strategy
    roundTripBeginTime = new Date()

    requestData = if @isNDstore() then @requestFromNDstore else @requestFromWKstore

    Request.always(
      requestData(batch).then((responseBuffer) =>
        responseBuffer = new Uint8Array(responseBuffer)
        @connectionInfo.log(@layer.name, roundTripBeginTime, batch.length, responseBuffer.length)

        offset = 0

        for bucket, i in batch
          if bucket.fourBit
            bucketData = @decode4bit(responseBuffer.subarray(offset, offset += (@cube.BUCKET_LENGTH >> 1)))
          else
            bucketData = responseBuffer.subarray(offset, offset += @cube.BUCKET_LENGTH)
          @boundingBox.removeOutsideArea(bucket, bucketData)
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


  requestFromWKstore : (batch) =>

    requestData = new MultipartData()

    for bucket in batch

      requestData.addPart(
        "X-Bucket": JSON.stringify(
          @getBucketData(bucket)
      ))

    return requestData.dataPromise().then((data) =>
      Request.sendArraybufferReceiveArraybuffer("#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?token=#{@layer.token}",
        data : data
        headers :
          "Content-Type" : "multipart/mixed; boundary=#{requestData.boundary}"
        timeout : @MESSAGE_TIMEOUT
        compress : true
      )
    )


  requestFromNDstore : (batch) =>

    bucket = @getBucketData(batch[0])
    url = """#{@datastoreInfo.url}/ca/#{@datastoreInfo.accessToken}/raw/raw/#{bucket.zoomStep}/
      #{bucket.position[0]},#{bucket.position[0]+bucket.cubeSize}/
      #{bucket.position[1]},#{bucket.position[1]+bucket.cubeSize}/
      #{bucket.position[2]},#{bucket.position[2]+bucket.cubeSize}/"""

    return Request.receiveArraybuffer(url)


  getBucketData : (bucket) =>

    zoomStep = bucket[3]
    return {
      position: [
        bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
      ]
      zoomStep: zoomStep
      cubeSize: 1 << @cube.BUCKET_SIZE_P
      fourBit: @shouldRequestFourBit()
    }


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


  isNDstore : ->

    return @datastoreInfo.typ == "ndstore"


module.exports = PullQueue
