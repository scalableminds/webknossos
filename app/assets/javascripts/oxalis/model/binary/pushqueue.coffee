Cube              = require("./cube")
Request           = require("../../../libs/request")
MultipartData     = require("../../../libs/multipart_data")

class PushQueue

  BATCH_LIMIT : 1
  BATCH_SIZE : 32
  DEBOUNCE_TIME : 1000
  MESSAGE_TIMEOUT : 10000


  constructor : (@dataSetName, @cube, @layer, @tracingId, @updatePipeline, @sendData = true) ->

    @url = "#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?cubeSize=#{1 << @cube.BUCKET_SIZE_P}&annotationId=#{@tracingId}&token=#{@layer.token}"
    @queue = []

    @push = _.debounce @pushImpl, @DEBOUNCE_TIME


  stateSaved : ->

    return @queue.length == 0 and
           @cube.temporalBucketManager.getCount() == 0 and
           not @updatePipeline.isBusy()


  insert : (bucket) ->

    @queue.push( bucket )
    @removeDuplicates()
    @push()


  insertFront : (bucket) ->

    @queue.unshift( bucket )
    @removeDuplicates()
    @push()


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

    return @cube.temporalBucketManager.getAllLoadedPromise().then =>

      unless @sendData
        return Promise.resolve()

      while @queue.length

        batchSize = Math.min(@BATCH_SIZE, @queue.length)
        batch = @queue.splice(0, batchSize)
        @pushBatch(batch)

      return @updatePipeline.getLastActionPromise()


  pushBatch : (batch) ->

    getBucketData = (bucket) => @cube.getBucket(bucket).getData()
    return @layer.sendToStore(batch, getBucketData)


module.exports = PushQueue
