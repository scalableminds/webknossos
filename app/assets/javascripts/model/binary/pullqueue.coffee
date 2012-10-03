### define
model/binary/cube : Cube
libs/array_buffer_socket : ArrayBufferSocket
###

class PullQueue

  queue : []
  cube : null

  dataSetId : null
  batchCount : 0
  roundTripTime : 0


  constructor : (cube, batchLimit = 5, batchSize = 5, roundTripTimeSmoother = 0.125) ->

    @BATCH_LIMIT = batchLimit
    @BATCH_SIZE = batchSize
    @ROUND_TRIP_TIME_SMOOTHER = roundTripTimeSmoother

    @cube = cube


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

    # First attempt to do some preloading
#    if priority > 50 and bucket[3] < 3
#      @insert([bucket[0] >> 1, bucket[1] >> 1, bucket[2] >> 1], bucket[3]+1, priority-50)

    # Buckets with a negative priority are not loaded
    return unless priority >= 0
    
    # Checking whether bucket is already loaded
    if @cube.getWorstRequestedZoomStepOfBucketByZoomedAddress(bucket) > bucket[3]
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

      while batch.length < BATCH_SIZE and @queue.length
        
        bucket = @removeFirst()

        # Making sure bucket is still not loaded
        continue if @cube.getWorstRequestedZoomStepOfBucketByZoomedAddress(bucket) <= bucket[3]

        batch.push bucket

      @pullBatch(batch) if batch.length > 0


  # Loading a bunch of buckets
  pullBatch : (batch) ->

    @batchCount++

    transmitBuffer = []

    for bucket in batch

      @cube.setRequestedZoomStepByZoomedAddress(bucket)
      #console.log "Requested: ", bucket, zoomStep

      zoomStep = bucket[3]
      transmitBuffer.push(
        zoomStep
        bucket[0] << (zoomStep + 5),
        bucket[1] << (zoomStep + 5),
        bucket[2] << (zoomStep + 4)  # TODO
      )

    # Measuring the time until response arrives to select appropriate preloading strategy 
    roundTripBeginTime = new Date()

    @getLoadBucketSocket()
      .send(transmitBuffer)
      .pipe(

        (responseBuffer) =>

          @addRoundTripTime(new Date() - roundTripBeginTime)

          if responseBuffer?
            for bucket, i in batch

              bucketData = responseBuffer.subarray(i * @cube.BUCKET_LENGTH, (i + 1) * @cube.BUCKET_LENGTH)
              @cube.setBucketByZoomedAddress(bucket, bucketData)
              #console.log "Success: ", bucket, zoomStep, colors

        =>
          
          for bucket in batch

            @cube.setZoomStepOfBucketByZoomedAddress(bucket, null)
            #console.log "Failed: ", bucket, zoomStep
    
    ).always =>

      @batchCount--
      @pull()


  addRoundTripTime : (roundTripTime) ->

    @roundTripTime = if @roundTripTime == 0
      roundTripTime
    else
      (1 - @ROUND_TRIP_TIME_SMOOTHER) * @roundTripTime + @ROUND_TRIP_TIME_SMOOTHER * roundTripTime


  getLoadBucketSocket : _.once ->
    
    new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{@cube.dataSetId}&cubeSize={@cube.bucketSize}")
        new ArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{@cube.dataSetId}&cubeSize={@cube.bucketSize}")
      ]
      requestBufferType : Uint32Array
      responseBufferType : Uint8Array
    )