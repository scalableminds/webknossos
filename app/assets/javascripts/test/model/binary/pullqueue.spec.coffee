mockRequire = require("mock-require")
sinon = require("sinon")
runAsync = require("../../helpers/run-async")
{Bucket} = require("../../../oxalis/model/binary/bucket")

MultipartData = require("../../../libs/multipart_data")
# FileReader is not available in node context
# -> Mock MultipartData to just return the data string
MultipartData.prototype.dataPromise = ->
  return Promise.resolve(this.data)
# Mock random boundary
MultipartData.prototype.randomBoundary = ->
  return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--"
mockRequire("../../../libs/request", MultipartData)

describe "PullQueue", ->

  RequestMock = null

  dataSetName = "dataset"
  layer = {
    url : "url"
    name : "layername"
    token : "token"
    category : "color"
  }

  cube = null
  boundingBox = null
  pullQueue = null
  connectionInfo = null

  beforeEach ->

    mockRequire.stopAll()
    RequestMock = {
      always : (promise, func) -> promise.then(func, func)
      sendArraybufferReceiveArraybuffer : sinon.stub()
    }
    mockRequire("../../../libs/request", RequestMock)

    PullQueue = require("../../../oxalis/model/binary/pullqueue")

    cube = {
      BUCKET_SIZE_P : 5
      getBucketByZoomedAddress : sinon.stub()
    }
    boundingBox = {
      containsBucket : sinon.stub()
      removeOutsideArea : sinon.stub()
    }
    connectionInfo = {
      log : sinon.stub()
    }
    pullQueue = new PullQueue(dataSetName, cube, layer, boundingBox, connectionInfo)

    boundingBox.containsBucket.returns(true)


  jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000

  describe "Successful pulling", ->

    buckets = [new Bucket(8, [0, 0, 0, 0], null), new Bucket(8, [1, 1, 1, 1], null)]

    beforeEach ->

      pullQueue.add({bucket: buckets[0].zoomedAddress, priority : 0})
      pullQueue.add({bucket: buckets[1].zoomedAddress, priority : 0})

      for bucket in buckets
        cube.getBucketByZoomedAddress.withArgs(bucket.zoomedAddress).returns(bucket)

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
