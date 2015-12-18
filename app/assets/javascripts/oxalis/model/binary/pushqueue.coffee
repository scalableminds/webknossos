### define
underscore : _
libs/unit8array_builder : Uint8ArrayBuilder
libs/request : Request
gzip : gzip
###

class PushQueue

  BATCH_LIMIT : 1
  BATCH_SIZE : 10
  THROTTLE_TIME : 10000


  constructor : (@dataSetName, @cube, @layer, @tracingId, @updatePipeline, @sendData = true) ->

    @url = "#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?cubeSize=#{1 << @cube.BUCKET_SIZE_P}&annotationId=#{@tracingId}&token=#{@layer.token}"
    @queue = []

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

    while @queue.length

      batchSize = Math.min(@BATCH_SIZE, @queue.length)
      batch = @queue.splice(0, batchSize)
      @pushBatch(batch)


  pushBatch : (batch) ->

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

    @updatePipeline.executePassAlongAction =>

      console.log "Pushing batch", batch
      gzip = new Zlib.Gzip(transmitBuffer)
      transmitBuffer = gzip.compress()

      Request.$(Request.sendArraybufferReceiveArraybuffer(
        @url
        data: transmitBuffer
        method: "PUT"
        headers:
          "Content-Encoding": "gzip"
      ))
