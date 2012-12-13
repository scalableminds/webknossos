### define
./cube : Cube
../../../libs/array_buffer_socket : ArrayBufferSocket
###

class PullQueue

  # Constants
  BATCH_LIMIT : 6
  BATCH_SIZE : 2
  ROUND_TRIP_TIME_SMOOTHER : .125
  BUCKET_TIME_SMOOTHER : .125

  cube : null
  queue : []
  socket : null
  socket4Bit : null
  socket8Bit : null

  dataSetId : ""

  batchCount : 0
  roundTripTime : 0

  
  constructor : (@dataSetId, @cube) ->
    
    @initializeLoadBuckets()


  swap : (a, b) ->

    queue = @queue

    tmp = queue[a]
    queue[a] = queue[b]
    queue[b] = tmp


  siftUp :(pos) ->

    queue = @queue

    while pos and queue[pos].priority < queue[(pos - 1) >> 1].priority
      parent = (pos - 1) >> 1
      @swap(pos, parent)
      pos = parent


  siftDown : (pos) ->

    queue = @queue

    while (pos << 1) + 1 < queue.length
      child = (pos << 1) + 1
      child++ if child + 1 < queue.length and queue[child].priority > queue[child + 1].priority
      break if queue[pos].priority < queue[child].priority
      @swap(pos, child)
      pos = child


  insert : (bucket, priority) ->

    # Buckets with a negative priority are not loaded
    return unless priority >= 0
    
    # Checking whether bucket is already loaded
    if @cube.getWorstRequestedZoomStepByZoomedAddress(bucket) > bucket[3]
      @queue.push( { "bucket" : bucket, "priority" : priority } )
      @siftUp(@queue.length - 1)


  removeFirst : ->

    # No buckets in the queue
    return null unless @queue.length

    # Receive and remove first itemfrom queue
    first = @queue.splice(0, 1, @queue[@queue.length - 1])[0]
    @queue.pop()
    @siftDown(0)

    first.bucket


  clear : ->

    @queue.length = 0


  # Starting to download some buckets
  pull : ->

    while @batchCount < @BATCH_LIMIT and @queue.length
      
      batch = []

      while batch.length < @BATCH_SIZE and @queue.length
        
        bucket = @removeFirst()

        # Making sure bucket is still not loaded
        continue if @cube.getWorstRequestedZoomStepByZoomedAddress(bucket) <= bucket[3]

        batch.push bucket
        @cube.setRequestedZoomStepByZoomedAddress(bucket)
        #console.log "Requested: ", bucket

      @pullBatch(batch) if batch.length > 0


  # Loading a bunch of buckets
  pullBatch : (batch) ->

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

    @socket.send(transmitBuffer)
      .pipe(

        (responseBuffer) =>

          @updateConnectionInfo(new Date() - roundTripBeginTime, batch.length)
          if responseBuffer?
            for bucket, i in batch

              if @fourBit
                bucketData = @decode(responseBuffer.subarray(i * (@cube.BUCKET_LENGTH >> 1), (i + 1) * (@cube.BUCKET_LENGTH >> 1)))
              else
                bucketData = responseBuffer.subarray(i * @cube.BUCKET_LENGTH, (i + 1) * @cube.BUCKET_LENGTH)

              #console.log "Success: ", bucket
              @cube.setBucketByZoomedAddress(bucket, bucketData)

        =>
          
          for bucket in batch

            @cube.setBucketByZoomedAddress(bucket, null)
            #console.log "Failed: ", bucket
    
    ).always =>

      @batchCount--
      @pull()

  updateConnectionInfo : (roundTripTime, bucketCount) ->

    if @roundTripTime? and @bucketTime?
      @roundTripTime = (1 - @ROUND_TRIP_TIME_SMOOTHER) * @roundTripTime + @ROUND_TRIP_TIME_SMOOTHER * roundTripTime
      @bucketTime = (1 - @BUCKET_TIME_SMOOTHER) * @bucketTime + @BUCKET_TIME_SMOOTHER * (new Date() - @lastReceiveTime) / bucketCount
    else
      @roundTripTime = roundTripTime
      @bucketTime = roundTripTime / bucketCount

    @bucketsPerSecond = 1000 / @bucketTime
    @lastReceiveTime = new Date()


  set4Bit : (@fourBit) ->

    @socket.close() if @socket?
    @socket = if @fourBit then @socket4Bit else @socket8Bit
    @socket.open()


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

  initializeLoadBuckets : ->

    @socket4Bit = new ArrayBufferSocket(
      senders : [
        # new ArrayBufferSocket.WebWorker("ws://#{document.location.host}/binary/ws?dataSetId=#{@dataSetId}&halfByte=1&cubeSize=#{1 << @cube.BUCKET_SIZE_P}")
        # new ArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{@dataSetId}&halfByte=1&cubeSize=#{1 << @cube.BUCKET_SIZE_P}")
        new ArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{@dataSetId}&halfByte=1&cubeSize=#{1 << @cube.BUCKET_SIZE_P}")
      ]
      requestBufferType : Float32Array
      responseBufferType : Uint8Array
    )

    @socket8Bit = new ArrayBufferSocket(
      senders : [
        # new ArrayBufferSocket.WebWorker("ws://#{document.location.host}/binary/ws?dataSetId=#{@dataSetId}&halfByte=0&cubeSize=#{1 << @cube.BUCKET_SIZE_P}")
        # new ArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{@dataSetId}&halfByte=0&cubeSize=#{1 << @cube.BUCKET_SIZE_P}")
        new ArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{@dataSetId}&halfByte=0&cubeSize=#{1 << @cube.BUCKET_SIZE_P}")
      ]
      requestBufferType : Float32Array
      responseBufferType : Uint8Array
    )
