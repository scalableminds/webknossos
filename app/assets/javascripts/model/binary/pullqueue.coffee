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

  insert : (bucket, priority) ->
    queue = @queue

    # Buckets with negative priority are not loaded
    return unless priority >= 0
    b = { "bucket" : bucket, "priority" : priority }
    queue.push(b)
    @siftUp(queue.length - 1)

  removeFirst : ->
    queue = @queue

    return null unless queue.length
    first = queue.splice(0, 1, queue[queue.length - 1])[0]
    queue.pop()
    @siftDown(0)
    first.bucket

  clear : ->
    queue = @queue

    queue.length = 0

  pull : ->
    { queue, PULL_DOWNLOAD_LIMIT } = @

    while @pullLoadingCount < PULL_DOWNLOAD_LIMIT and queue.length
      [x, y, z, zoomStep] = @removeFirst()

      unless Cube.isBucketSetByAddress3(x, y, z, zoomStep)
        @pullBucket(x, y, z, zoomStep)

  pullBucket : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    @pullLoadingCount++
    #console.log "requesting: ", [bucket_x, bucket_y, bucket_z]
    Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, Cube.LOADING_PLACEHOLDER_OBJECT)

    @loadBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep).then(

      (colors) =>
        console.log "success: ", [bucket_x, bucket_y, bucket_z], zoomStep, colors
        Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, colors)
        $(window).trigger("bucketloaded", [[bucket_x, bucket_y, bucket_z]])

      =>
        #console.log "fail: ", [bucket_x, bucket_y, bucket_z]
        Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, null)

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

  loadBucketByAddress3 : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    transmitBuffer = [ zoomStep, bucket_x << 5, bucket_y << 5, bucket_z << 5 ]
    @loadBucketSocket().pipe (socket) -> socket.send(transmitBuffer)
