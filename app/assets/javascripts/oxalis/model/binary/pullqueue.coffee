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
    fourBit = @shouldRequestFourBit()

    # Measuring the time until response arrives to select appropriate preloading strategy
    roundTripBeginTime = new Date()

    requestData = if @isNDstore() then @requestFromNDstore else @requestFromWKstore

    Request.always(
      requestData(batch).then((responseBuffer) =>
        @connectionInfo.log(@layer.name, roundTripBeginTime, batch.length, responseBuffer.length)

        offset = 0
        for bucket, i in batch
          if fourBit
            bucketData = @decodeFourBit(responseBuffer.subarray(offset, offset += (@cube.BUCKET_LENGTH >> 1)))
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
    ).then( (responseBuffer) =>
      responseBuffer = new Uint8Array(responseBuffer)
    )


  requestFromNDstore : (batch) =>

    return new Promise( (resolve, reject) =>
      bucket = @getBucketData(batch[0])
      bucketSize = bucket.cubeSize

      # ndstore cannot deliver data for coordinates that are out of bounds
      bounds = @clampBucketToMaxCoordinates(bucket)
      url = """#{@datastoreInfo.url}/ca/#{@datastoreInfo.accessToken}/raw/raw/#{bucket.zoomStep}/
        #{bounds[0]},#{bounds[3]}/
        #{bounds[1]},#{bounds[4]}/
        #{bounds[2]},#{bounds[5]}/"""

      # if at least one dimension is out of bounds, return an empty array
      if bounds[0] >= bounds[3] or bounds[1] >= bounds[4] or bounds[2] >= bounds[5]
        resolve(new Uint8Array(bucketSize * bucketSize * bucketSize))
        return

      Request.receiveArraybuffer(url).then(
        (responseBuffer) =>
          # the untyped array cannot be accessed by index, use a dataView for that
          dataView = new DataView(responseBuffer)

          # create a typed uint8 array that is initialized with zeros
          buffer = new Uint8Array(bucketSize * bucketSize * bucketSize)
          bucketBounds = @getMaxCoordinatesAsBucket(bounds, bucket)

          # copy the ndstore response into the new array, respecting the bounds of the dataset
          index = 0
          for z in [bucketBounds[2]...bucketBounds[5] or bucket.cubeSize]
            for y in [bucketBounds[1]...bucketBounds[4] or bucket.cubeSize]
              for x in [bucketBounds[0]...bucketBounds[3] or bucket.cubeSize]
                buffer[z * bucketSize * bucketSize + y * bucketSize + x] = dataView.getUint8(index++)
          resolve(buffer)
        (error) =>
          reject(error)
      )
    )


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


  clampBucketToMaxCoordinates : ( {position, cubeSize, zoomStep} ) ->

    min = @layer.lowerBoundary
    max = @layer.upperBoundary

    [ x, y, z ] = position
    return [
      Math.max(min[0], x)
      Math.max(min[1], y)
      Math.max(min[2], z)
      # maxCoordinates are exclusive
      Math.min(max[0], x + cubeSize)
      Math.min(max[1], y + cubeSize)
      Math.min(max[2], z + cubeSize)
    ]


  getMaxCoordinatesAsBucket : (bounds, bucket) ->

    return _.map(bounds, (e) => e % (1 << ( @cube.BUCKET_SIZE_P + bucket.zoomStep )))


  setFourBit : (@fourBit) ->


  shouldRequestFourBit : ->

    return @fourBit and @layer.category == "color" and not @isNDstore()


  isNDstore : ->

    return @datastoreInfo.typ == "ndstore"


module.exports = PullQueue
