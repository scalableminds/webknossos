### define
../../../libs/array_buffer_socket : ArrayBufferSocket
###

class PushQueue

  BATCH_LIMIT : 6
  BATCH_SIZE : 3


  constructor : (@dataSetName, @cube, @dataLayerName, { @tracingId, @tracingType }, @sendData = true) ->

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

    @batchCount++

    console.log "Pushing batch", batch

    transmitBuffer = []
    for bucket in batch
      zoomStep = bucket[3]
      # TODO: define transmit buffer
      transmitBuffer.push(
        zoomStep
        if @fourBit and zoomStep == 0 then 1 else 0
        bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
        bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
      )

    @getSendSocket().send(transmitBuffer)
      .pipe(

        (responseBuffer) =>

          # TODO: define action

        =>
          
          for bucket in batch
            @insert(bucket)
    
    ).always =>

      @batchCount--
      @push()


  getSendSocket : ->

    if @socket? then @socket else @socket = new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.XmlHttpRequest("/datasets/#{@dataSetName}/layers/#{@dataLayerName}/data?cubeSize=#{1 << @cube.BUCKET_SIZE_P}&annotationTyp=#{@tracingType}&annotationId=#{@tracingId}", "POST")
      ]
      requestBufferType : Uint8Array
      responseBufferType : Uint8Array
    )