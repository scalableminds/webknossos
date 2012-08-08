### define
model/binary/cube : Cube
model/game : Game
libs/simple_array_buffer_socket : SimpleArrayBufferSocket
###

PullQueue = 

  # Constants
  PULL_DOWNLOAD_LIMIT : 10

  queue : []
  pullLoadingCount : 0

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


  insert : (bucket, zoomStep, priority) ->

    queue = @queue

    # Buckets with negative priority are not loaded
    return unless priority >= 0
    
    # Checking whether bucket is already loaded
    if Cube.getWorstRequestedZoomStepOfBucketByZoomedAddress(bucket, zoomStep) > zoomStep
      b = { "bucket" : bucket, "zoomStep" : zoomStep, "priority" : priority }
      queue.push(b)
      @siftUp(queue.length - 1)


  removeFirst : ->

    queue = @queue

    return null unless queue.length
    first = queue.splice(0, 1, queue[queue.length - 1])[0]
    queue.pop()
    @siftDown(0)
    first


  clear : ->

    queue = @queue

    queue.length = 0


  pull : ->

    { queue, PULL_DOWNLOAD_LIMIT } = @

    while @pullLoadingCount < PULL_DOWNLOAD_LIMIT and queue.length
      { bucket, zoomStep } = @removeFirst()

      if Cube.getWorstRequestedZoomStepOfBucketByZoomedAddress(bucket, zoomStep) > zoomStep
        @pullBucket(bucket, zoomStep)


  pullBucket : (bucket, zoomStep) ->

    @pullLoadingCount++
    Cube.setRequestedZoomStepByZoomedAddress(bucket, zoomStep)
    #console.log "Requested: ", bucket, zoomStep

    @loadBucketByAddress(bucket, zoomStep).then(

      (colors) =>
        Cube.setBucketByZoomedAddress(bucket, zoomStep, colors)
        #console.log "Success: ", bucket, zoomStep, colors

      =>
        Cube.setBucketByZoomedAddress(bucket, zoomStep, null)
        console.log "Failed: ", bucket, zoomStep

    ).always =>
      @pullLoadingCount--
      @pull()

  loadBucketSocket : _.once ->

    Game.initialize().pipe ->
      dataSetId = Game.dataSet.id
      new SimpleArrayBufferSocket(
        defaultSender : new SimpleArrayBufferSocket.WebSocket("ws://#{document.location.host}/binary/ws?dataSetId=#{dataSetId}&cubeSize=32")
        fallbackSender : new SimpleArrayBufferSocket.XmlHttpRequest("/binary/ajax?dataSetId=#{dataSetId}&cubeSize=32")
        requestBufferType : Float32Array
        responseBufferType : Uint8Array
      )


  loadBucketByAddress : (bucket, zoomStep) ->

    transmitBuffer = [ zoomStep, bucket[0] << (zoomStep + 5), bucket[1] << (zoomStep + 5), bucket[2] << (zoomStep + 4) ]
    @loadBucketSocket().pipe (socket) -> socket.send(transmitBuffer)
