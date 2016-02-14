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

    unless @sendData
      return

    while @queue.length

      batchSize = Math.min(@BATCH_SIZE, @queue.length)
      batch = @queue.splice(0, batchSize)
      @pushBatch(batch)


  pushBatch : (batch) ->

    transmitData = new MultipartData()

    for bucket in batch
      zoomStep = bucket[3]

      transmitData.addPart(
          "X-Bucket": JSON.stringify(
            position: [
              bucket[0] << (zoomStep + @cube.BUCKET_SIZE_P)
              bucket[1] << (zoomStep + @cube.BUCKET_SIZE_P)
              bucket[2] << (zoomStep + @cube.BUCKET_SIZE_P)
            ]
            zoomStep: zoomStep
            cubeSize: 1 << @cube.BUCKET_SIZE_P),
          @cube.getBucketByZoomedAddress(bucket).getData())

    @updatePipeline.executePassAlongAction( =>

      transmitData.dataPromise().then((data) =>
        Request.sendArraybufferReceiveArraybuffer("#{@layer.url}/data/datasets/#{@dataSetName}/layers/#{@layer.name}/data?token=#{@layer.token}",
          method : "PUT"
          data : data
          headers :
            "Content-Type" : "multipart/mixed; boundary=#{transmitData.boundary}"
          timeout : @MESSAGE_TIMEOUT
          compress : true
        )
      )
    ).fail(-> throw new Error("Uploading data failed."))


module.exports = PushQueue
