### define
libs/array_buffer_socket : ArrayBufferSocket
libs/unit8array_builder : Uint8ArrayBuilder
gzip : gzip
###

class PushQueue

  BATCH_LIMIT : 1
  BATCH_SIZE : 15
  THROTTLE_TIME : 2000


  constructor : (@dataSetName, @cube, @dataLayerName, @tracingId, @updatePipeline, @sendData = true) ->

    @queue = []
    @batchCount = 0

    @getParams =
      cubeSize : 1 << @cube.BUCKET_SIZE_P
      annotationId : tracingId

    @push = _.throttle @pushImpl, @THROTTLE_TIME


  insert : (bucket) ->

    @queue.push( bucket )
    @removeDuplicates()


  insertFront : (bucket) ->

    @queue.unshift( bucket )
    @removeDuplicates()


  clear : ->

    @queue = []


  removeDuplicates : ->

    @queue.sort( @comparePositions )

    i = 0
    while i < @queue.length - 1
      if @comparePositions( @queue[i], @queue[i+1] ) == 0
        @queue.splice( i, 1 )
      else
        i++


  comparePositions : ([x1, y1, z1], [x2, y2, z2]) ->

      return (x1 - x2) || (y1 - y2) || (z1 - z2)


  print : ->

    for e in @queue
      console.log(e)


  pushImpl : =>

    unless @sendData
      return

    while @batchCount < @BATCH_LIMIT and @queue.length

      batch = []

      while batch.length < @BATCH_SIZE and @queue.length

        bucket = @queue.splice(0, 1)[0]
        batch.push bucket

      @pushBatch(batch) if batch.length > 0


  pushBatch : (batch) ->

    @batchCount++

    console.log "Pushing batch", batch

    transmitBufferBuilder = new Uint8ArrayBuilder()
    for bucket in batch
      zoomStep = bucket[3]
      transmitBufferBuilder.push(
        new Float32Array([
          zoomStep
          bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
          bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
          bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
        ])
      )
      transmitBufferBuilder.push(
        @cube.getBucketDataByZoomedAddress( bucket ))

    transmitBuffer = transmitBufferBuilder.build()

    #console.log( "uncompressed transmitBuffer:", transmitBuffer.length, transmitBuffer )

    gzip = new Zlib.Gzip( transmitBuffer )
    transmitBuffer = gzip.compress()

    #console.log( "compressed transmitBuffer:", transmitBuffer.length, transmitBuffer )

    @updatePipeline.executePassAlongAction =>

      @getSendSocket().send( transmitBuffer )
        .then(

          (responseBuffer) =>

            # TODO: define action

          =>

            for bucket in batch
              @insertFront(bucket)

      ).always =>

        @batchCount--
        @push()


  getSendSocket : ->

    cubeSize = 1 << @cube.BUCKET_SIZE_P

    if @socket? then @socket else @socket = new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.XmlHttpRequest(
          "/datasets/#{@dataSetName}/layers/#{@dataLayerName}/data",
          @getParams,
          "PUT", "gzip"
        )
      ]
      requestBufferType : Uint8Array
      responseBufferType : Uint8Array
    )
