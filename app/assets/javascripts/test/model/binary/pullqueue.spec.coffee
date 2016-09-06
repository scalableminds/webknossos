mockRequire = require("mock-require")
sinon = require("sinon")
runAsync = require("../../helpers/run-async")
{Bucket} = require("../../../oxalis/model/binary/bucket")

mockRequire.stopAll()

MultipartData = require("../../../libs/multipart_data")
# FileReader is not available in node context
# -> Mock MultipartData to just return the data string
MultipartData::dataPromise = ->
  return Promise.resolve(this.data)
# Mock random boundary
MultipartData::randomBoundary = ->
  return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--"
mockRequire("../../../libs/request", MultipartData)

RequestMock = {
  always : (promise, func) -> promise.then(func, func)
  sendArraybufferReceiveArraybuffer : sinon.stub()
}
mockRequire("../../../libs/request", RequestMock)

PullQueue = require("../../../oxalis/model/binary/pullqueue")

describe "PullQueue", ->

  dataSetName = "dataset"
  layer = {
    url : "url"
    name : "layername"
    token : "token"
    tokenPromise : Promise.resolve()
    category : "color"
  }
  cube = {
    BUCKET_SIZE_P : 5
    BUCKET_LENGTH : 32 * 32 * 32
    getBucket : sinon.stub()
    getOrCreateBucket : sinon.stub()
    boundingBox : {
      containsBucket : sinon.stub().returns(true)
      removeOutsideArea : sinon.stub()
    }
  }
  connectionInfo = {
    log : sinon.stub()
  }
  datastoreInfo = {
    typ : "webknossos-store"
  }

  pullQueue = null
  buckets = null

  beforeEach ->

    pullQueue = new PullQueue(dataSetName, cube, layer, connectionInfo, datastoreInfo)

    buckets = [new Bucket(8, [0, 0, 0, 0], null), new Bucket(8, [1, 1, 1, 1], null)]
    for bucket in buckets
      pullQueue.add({bucket: bucket.zoomedAddress, priority : 0})
      cube.getBucket.withArgs(bucket.zoomedAddress).returns(bucket)
      cube.getOrCreateBucket.withArgs(bucket.zoomedAddress).returns(bucket)


  describe "Successful pulling", ->

    bucketData1 = (i % 256 for i in [0...(32 * 32 * 32)])
    bucketData2 = ((2 * i) % 256 for i in [0...(32 * 32 * 32)])

    beforeEach ->

      responseBuffer = bucketData1.concat(bucketData2)
      RequestMock.sendArraybufferReceiveArraybuffer.reset()
      RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve(responseBuffer))


    it "should pass the correct request parameters", (done) ->

      expectedUrl = "url/data/datasets/dataset/layers/layername/data?token=token"
      expectedOptions = {
        data: [
          '----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n',
          'X-Bucket: {"position":[0,0,0],"zoomStep":0,"cubeSize":32}\r\n',
          '\r\n',
          '\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n',
          'X-Bucket: {"position":[64,64,64],"zoomStep":1,"cubeSize":32}\r\n',
          '\r\n',
          '\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n'
        ]
        headers: {
          'Content-Type': 'multipart/mixed; boundary=--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--'
        }
        timeout: 10000
        compress: true
        doNotCatch: true
      }

      pullQueue.pull()

      runAsync([
        ->
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(1)

          [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args
          expect(url).toBe(expectedUrl)
          expect(options).toEqual(expectedOptions)

          done()
      ])

    it "should receive the correct data", (done) ->

      pullQueue.pull()

      runAsync([
        ->
          expect(buckets[0].state).toBe(Bucket::STATE_LOADED)
          expect(buckets[1].state).toBe(Bucket::STATE_LOADED)
          expect(buckets[0].getData()).toEqual(bucketData1)
          expect(buckets[1].getData()).toEqual(bucketData2)
          done()
      ])

  describe "Request Failure", ->

    beforeEach ->

      RequestMock.sendArraybufferReceiveArraybuffer.reset()
      RequestMock.sendArraybufferReceiveArraybuffer.onFirstCall().returns(Promise.reject())
      RequestMock.sendArraybufferReceiveArraybuffer.onSecondCall().returns(
          Promise.resolve(new Uint8Array(32 * 32 * 32)))


    it "should not request twice if not bucket dirty", (done) ->

      pullQueue.pull()

      runAsync([
        ->
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(1)
          expect(buckets[0].state).toBe(Bucket::STATE_UNREQUESTED)
          expect(buckets[1].state).toBe(Bucket::STATE_UNREQUESTED)
          done()
      ])

    it "should reinsert dirty buckets", (done) ->

      buckets[0].dirty = true
      buckets[0].data = new Uint8Array(32 * 32 * 32)
      pullQueue.pull()

      runAsync([
        ->
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(2)
          expect(buckets[0].state).toBe(Bucket::STATE_LOADED)
          expect(buckets[1].state).toBe(Bucket::STATE_UNREQUESTED)
          done()
      ])
