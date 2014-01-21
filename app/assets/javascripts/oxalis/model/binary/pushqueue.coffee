### define
../../../libs/array_buffer_socket : ArrayBufferSocket
../../../libs/unit8array_builder : Uint8ArrayBuilder
###

class PushQueue

  BATCH_LIMIT : 6
  BATCH_SIZE : 3


  constructor : (@dataSetName, @cube, @dataLayerName, @tracingId, @sendData = true) ->

    @queue = []
    @batchCount = 0


  insert : (bucket) ->

    @queue.push( bucket )
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


  push : ->

    unless @sendData
      return

    while @batchCount < @BATCH_LIMIT and @queue.length
      
      batch = []

      while batch.length < @BATCH_SIZE and @queue.length
        
        bucket = @queue.splice(0, 1)[0]
        batch.push bucket
        #console.log "sent: ", bucket

      @pushBatch(batch) if batch.length > 0


  pushBatch : (batch) ->

#    Used for testing
#    if @alreadyPushed?
#      return

#    @alreadyPushed = true
#    transmitBuffer = []

#    for i in [0...2]
#      transmitBuffer.push(0, 0, 0, 0, 0, 0, 0, 67, 0, 0, 0, 67, 0, 0, 0, 0)

#      for x in [0...32]
#        for y in [0...32]
#          for z in [0...32]
#            transmitBuffer.push(x, y)

#    console.log transmitBuffer

#    @getSendSocket().send(transmitBuffer)
#    return

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

    console.log( "transmitBuffer:", transmitBufferBuilder.build() )

    @getSendSocket().send(transmitBufferBuilder.build())
      .pipe(

        (responseBuffer) =>

          # TODO: define action

        =>
          
          #for bucket in batch
          #  @insert(bucket)
    
    ).always =>

      @batchCount--
      @push()


  getSendSocket : ->

    if @socket? then @socket else @socket = new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.XmlHttpRequest("/datasets/#{@dataSetName}/layers/#{@dataLayerName}/data?cubeSize=#{1 << @cube.BUCKET_SIZE_P}&annotationId=#{@tracingId}", "PUT")
      ]
      requestBufferType : Uint8Array
      responseBufferType : Uint8Array
    )