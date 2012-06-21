### define
model/binary/cube : Cube
model/game : Game
libs/simple_array_buffer_socket : SimpleArrayBufferSocket
###

PullQueue = 

  # Constants
  PULL_DOWNLOAD_LIMIT : 10

  priorities : [
    240, 239, 238, 237, 236, 235, 234, 233, 232, 231, 230, 229, 228, 227, 226, 225, 288,
    241, 182, 181, 180, 179, 178, 177, 176, 175, 174, 173, 172, 171, 170, 169, 224, 287,
    242, 183, 132, 131, 130, 129, 128, 127, 126, 125, 124, 123, 122, 121, 168, 223, 286,
    243, 184, 133,  90,  89,  88,  87,  86,  85,  84,  83,  82,  81, 120, 167, 222, 285,
    244, 185, 134,  91,  56,  55,  54,  53,  52,  51,  50,  49,  80, 119, 166, 221, 284,
    245, 186, 135,  92,  57,  30,  29,  28,  27,  26,  25,  48,  79, 118, 165, 220, 283,
    246, 187, 136,  93,  58,  31,  12,  11,  10,   9,  24,  47,  78, 117, 164, 219, 282,
    247, 188, 137,  94,  59,  32,  13,   2,   1,   8,  23,  46,  77, 116, 163, 218, 281,
    248, 189, 138,  95,  60,  33,  14,   3,   0,   7,  22,  45,  76, 115, 162, 217, 280,
    249, 190, 139,  96,  61,  34,  15,   4,   5,   6,  21,  44,  75, 114, 161, 216, 279,
    250, 191, 140,  97,  62,  35,  16,  17,  18,  19,  20,  43,  74, 113, 160, 215, 278,
    251, 192, 141,  98,  63,  36,  37,  38,  39,  40,  41,  42,  73, 112, 159, 214, 277,
    252, 193, 142,  99,  64,  65,  66,  67,  68,  69,  70,  71,  72, 111, 158, 213, 276,
    253, 194, 143, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 157, 212, 275,
    254, 195, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 211, 274,
    255, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 273,
    256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272]

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

    b = { "bucket" : bucket, "priority" : priority }
    queue.push(b)
    @siftUp(queue.length - 1)
    return

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
    { queue, pullLoadingCount, PULL_DOWNLOAD_LIMIT } = @

    while pullLoadingCount < PULL_DOWNLOAD_LIMIT and queue.length

      [x, y, z, zoomStep] = @removeFirst()

      unless Cube.isBucketSetByAddress3(x, y, z, zoomStep)
        @pullBucket(x, y, z, zoomStep)

  pullBucket : (bucket_x, bucket_y, bucket_z, zoomStep) ->

    pullLoadingCount = @pullLoadingCount

    console.log "requesting: ", [bucket_x, bucket_y, bucket_z]
    Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, Cube.LOADING_PLACEHOLDER_OBJECT)
    pullLoadingCount++

    @loadBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep).then(

      (colors) =>
        Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, colors)
        $(window).trigger("bucketloaded", [[bucket_x, bucket_y, bucket_z]])

      =>
        Cube.setBucketByAddress3(bucket_x, bucket_y, bucket_z, zoomStep, null)

    ).always =>
      pullLoadingCount--
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
