### define
./cube : Cube
../../libs/array_buffer_socket : ArrayBufferSocket
###

class PullQueue

  # Constants
  BATCH_LIMIT : 10
  BATCH_SIZE : 2
  ROUND_TRIP_TIME_SMOOTHER : .125
  BUCKET_TIME_SMOOTHER : .125
  BUCKET_SIZE_P : 5

  cube : null
  queue : []

  dataSetId : ""

  batchCount : 0
  roundTripTime : 0

  currentTest : 0
  
  constructor : (@dataSetId, @cube) ->

    @bucketCount = 0
    @roundTripTimes = []
    @tests = [
      { batchSize: 1, batchLimit: 1, socket: @getLoadBucketWebsocket(), desc: "Websocket 1/1" }
      { batchSize: 100, batchLimit: 1, socket: @getLoadBucketWebsocket(), desc: "Websocket 100/1" }
      { batchSize: 1, batchLimit: 100, socket: @getLoadBucketWebsocket(), desc: "Websocket 1/100" }
      { batchSize: 10, batchLimit: 10, socket: @getLoadBucketWebsocket(), desc: "Websocket 10/10" }
      { batchSize: 5, batchLimit: 5, socket: @getLoadBucketWebsocket(), desc: "Websocket 5/5" }
      { batchSize: 1, batchLimit: 1, socket: @getLoadBucketAjax(), desc: "Ajax 1/1" }
      { batchSize: 100, batchLimit: 1, socket: @getLoadBucketAjax(), desc: "Ajax 100/1" }
      { batchSize: 1, batchLimit: 100, socket: @getLoadBucketAjax(), desc: "Ajax 1/100" }
      { batchSize: 10, batchLimit: 10, socket: @getLoadBucketAjax(), desc: "Ajax 10/10" }
      { batchSize: 5, batchLimit: 5, socket: @getLoadBucketAjax(), desc: "Ajax 5/5" }
    ]

  fillQueue : ->

    @queue = []
    for x in [10...20]
      for y in [10...20]
        for z in [10...20]
          @queue.push([x, y, z, 0], 1)

  perfTest : ->

    if @tests.length > @currentTest
      @fillQueue()
      console.log "TEST:", @tests[@currentTest].desc
      console.time "pull"
      @pull(@tests[@currentTest].batchSize, @tests[@currentTest].batchLimit, @tests[@currentTest].socket)
      @currentTest++
    
  # Starting to download some buckets
  pull : (batchSize, batchLimit, socket) ->

    while @batchCount < batchLimit and @queue.length
      
      batch = @queue.splice(0, batchSize)
      @pullBatch(batchSize, batchLimit, batch, socket) if batch.length > 0


  # Loading a bunch of buckets
  pullBatch : (size, limit, batch, socket) ->

    @batchCount++

    transmitBuffer = []

    for bucket in batch

      zoomStep = bucket[3]
      transmitBuffer.push(
        zoomStep
        bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P),
        bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P),
        bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
      )

    # Measuring the time until response arrives to select appropriate preloading strategy 
    roundTripBeginTime = new Date()

    socket.send(transmitBuffer)
      .pipe(

        (responseBuffer) =>

          @updateConnectionInfo(new Date() - roundTripBeginTime, batch.length)

    ).always =>

      @batchCount--
      @pull(size, limit, socket)


  updateConnectionInfo : (roundTripTime, bucketCount) ->

    @roundTripTimes.push roundTripTime
    @bucketCount += bucketCount

    if @bucketCount == 1000
      sum = 0
      for t in @roundTripTimes
        sum += t

      avg = sum / @roundTripTimes.length
      console.timeEnd "pull"
      console.log "ping - min:", _.min(@roundTripTimes), "max:", _.max(@roundTripTimes), "avg:", avg

      @bucketCount = 0
      @roundTripTimes = []

      @perfTest()

  getLoadBucketWebsocket : _.once ->
    
    new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{@dataSetId}&cubeSize=#{1 << @BUCKET_SIZE_P}")
      ]
      requestBufferType : Float32Array
      responseBufferType : Uint8Array
    )

  getLoadBucketAjax : _.once ->
    
    new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{@dataSetId}&cubeSize=#{1 << @BUCKET_SIZE_P}")
      ]
      requestBufferType : Float32Array
      responseBufferType : Uint8Array
    )
