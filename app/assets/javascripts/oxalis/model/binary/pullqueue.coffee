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
    @BATCH_SIZE = if @isNDstore() then 1 else 3

    # Debug option.
    # If true, buckets of all 0 will be transformed to have 255 bytes everywhere.
    @whitenEmptyBuckets = false


  pull : ->

    # Filter and sort queue, using negative priorities for sorting so .pop() can be used to get next bucket
    @queue = _.filter(@queue, (item) =>
      @boundingBox.containsBucket(item.bucket) and
        @cube.getOrCreateBucket(item.bucket).needsRequest()
    )
    @queue = _.sortBy(@queue, (item) -> item.priority)

    # Starting to download some buckets
    while @batchCount < @BATCH_LIMIT and @queue.length

      batch = []
      while batch.length < @BATCH_SIZE and @queue.length
        address = @queue.shift().bucket
        bucket = @cube.getOrCreateBucket(address)

        # Buckets might be in the Queue multiple times
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
          @maybeWhitenEmptyBucket(bucketData)
          @cube.getBucket(bucket).receiveData(bucketData)
      ).catch(=>
        for bucketAddress in batch
          bucket = @cube.getBucket(bucketAddress)
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
        "X-Bucket" : JSON.stringify(
          @getBucketData(bucket)
      ))

    return requestData.dataPromise().then((data) =>
      @layer.tokenPromise.then( =>
        token = @layer.token
        Request.sendArraybufferReceiveArraybuffer("#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?token=#{token}",
          data : data
          headers :
            "Content-Type" : "multipart/mixed; boundary=#{requestData.boundary}"
          timeout : @MESSAGE_TIMEOUT
          compress : true
          doNotCatch : true
        ).catch((err) =>
          # renew token if it is invalid
          if err.status == 403
            @layer.renewToken(token)

          throw err
        )
      )
    ).then( (responseBuffer) ->
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

      # if at least one dimension is completely out of bounds, return an empty array
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
          for z in [bucketBounds[2]...bucketBounds[5]]
            for y in [bucketBounds[1]...bucketBounds[4]]
              for x in [bucketBounds[0]...bucketBounds[3]]
                buffer[z * bucketSize * bucketSize + y * bucketSize + x] = dataView.getUint8(index++)
          resolve(buffer)
        (error) ->
          reject(error)
      )
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


  clampBucketToMaxCoordinates : ( {position, zoomStep} ) ->

    min = @layer.lowerBoundary
    max = @layer.upperBoundary

    cubeSize = 1 << @cube.BUCKET_SIZE_P + zoomStep

    [ x, y, z ] = position
    return [
      Math.max(min[0], x)
      Math.max(min[1], y)
      Math.max(min[2], z)
      Math.min(max[0], x + cubeSize)
      Math.min(max[1], y + cubeSize)
      Math.min(max[2], z + cubeSize)
    ]


  getMaxCoordinatesAsBucket : (bounds, bucket) ->

    # transform bounds in zoom-step-0 voxels to bucket coordinates between 0 and BUCKET_SIZE_P
    bucketBounds = _.map(bounds, (coordinate) =>
      cubeSize = 1 << @cube.BUCKET_SIZE_P + bucket.zoomStep
      return (coordinate % cubeSize) >> bucket.zoomStep
    )

    # as the upper bound for bucket coordinates is exclusive, the % cubeSize of it is 0
    # but we want it to be 1 << @cube.BUCKET_SIZE_P
    for i in [3..5]
      bucketBounds[i] = bucketBounds[i] or 1 << @cube.BUCKET_SIZE_P

    return bucketBounds


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
