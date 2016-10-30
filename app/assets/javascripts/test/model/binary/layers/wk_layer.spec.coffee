mockRequire = require("mock-require")
sinon = require("sinon")

mockRequire.stopAll()

MultipartData = require("../../../../libs/multipart_data")
# FileReader is not available in node context
# -> Mock MultipartData to just return the data string
MultipartData::dataPromise = ->
  return Promise.resolve(this.data)
# Mock random boundary
MultipartData::randomBoundary = ->
  return "--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--"
mockRequire("../../../../libs/multipart_data", MultipartData)

RequestMock = {
  always : (promise, func) -> promise.then(func, func)
  sendArraybufferReceiveArraybuffer : sinon.stub()
  receiveJSON : sinon.stub()
}
mockRequire("../../../../libs/request", RequestMock)
mockRequire.reRequire("../../../../libs/request")
mockRequire.reRequire("../../../../oxalis/model/binary/layers/layer")

WkLayer = require("../../../../oxalis/model/binary/layers/wk_layer")

describe "WkLayer", ->

  dataSetName = "dataSet"
  layerInfo = {
    name : "layername"
    category : "color"
    elementClass : "uint16"
  }
  dataStoreInfo = {
    typ : "webknossos-store"
    url : "url"
  }
  tokenResponse = {token : "token"}

  layer = null

  beforeEach ->

    RequestMock.receiveJSON = sinon.stub()
    RequestMock.receiveJSON.returns(Promise.resolve(tokenResponse))

    layer = new WkLayer(layerInfo, dataSetName, dataStoreInfo)


  describe "Initialization", ->

    it "should set the attributes correctly", ->

      expect(layer.name).toBe("layername")
      expect(layer.category).toBe("color")
      expect(layer.bitDepth).toBe(16)


  describe "requestFromStore", ->

    batch = [[0, 0, 0, 0], [1, 1, 1, 1]]
    bucketData1 = (i % 256 for i in [0...(32 * 32 * 32)])
    bucketData2 = ((2 * i) % 256 for i in [0...(32 * 32 * 32)])
    responseBuffer = bucketData1.concat(bucketData2)

    beforeEach ->

      RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub()
      RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve(responseBuffer))


    describe "Token Handling", ->

      it "should request a token first", (done) ->

        layer.tokenPromise.then((token) ->
          expect(RequestMock.receiveJSON.callCount).toBe(1)

          [url] = RequestMock.receiveJSON.getCall(0).args
          expect(url).toBe("/dataToken/generate?dataSetName=dataSet&dataLayerName=layername")

          expect(token).toBe("token")
          done()
        )

      it "should re-request a token when it's invalid", (done) ->

        RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub()
        RequestMock.sendArraybufferReceiveArraybuffer
            .onFirstCall().returns(Promise.reject({status : 403}))
            .onSecondCall().returns(Promise.resolve(responseBuffer))

        RequestMock.receiveJSON = sinon.stub()
        RequestMock.receiveJSON.returns(Promise.resolve({token : "token2"}))

        layer.tokenPromise.then((token) ->
          expect(token).toBe("token")
          return layer.requestFromStore(batch)
        ).then((result) ->
          expect(result).toEqual(responseBuffer)

          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(2)

          [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args
          expect(url).toBe("url/data/datasets/dataSet/layers/layername/data?token=token")

          [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(1).args
          expect(url).toBe("url/data/datasets/dataSet/layers/layername/data?token=token2")

          return layer.tokenPromise
        ).then((token) ->
          expect(token).toBe("token2")
          done()
        )


    describe "Request Handling", ->

      it "should pass the correct request parameters", (done) ->

        layer.setFourBit(true)

        expectedUrl = "url/data/datasets/dataSet/layers/layername/data?token=token"
        expectedOptions = {
          data: [
            '----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n',
            'X-Bucket: {"position":[0,0,0],"zoomStep":0,"cubeSize":32,"fourBit":true}\r\n',
            '\r\n',
            '\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n',
            'X-Bucket: {"position":[64,64,64],"zoomStep":1,"cubeSize":32,"fourBit":true}\r\n',
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

        layer.requestFromStore(batch).then((result) ->
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(1)

          [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args
          expect(url).toBe(expectedUrl)
          expect(options).toEqual(expectedOptions)

          done()
        )

  describe "sendToStore", ->

    batch = [[0, 0, 0, 0], [1, 1, 1, 1]]

    beforeEach ->

      RequestMock.sendArraybufferReceiveArraybuffer = sinon.stub()
      RequestMock.sendArraybufferReceiveArraybuffer.returns(Promise.resolve())

    describe "Request Handling", ->

      it "should send the correct request parameters", (done) ->

        data = new Uint8Array(2)
        getBucketData = sinon.stub()
        getBucketData.returns(data)

        expectedUrl = "url/data/datasets/dataSet/layers/layername/data?token=token"
        expectedOptions = {
          method: "PUT"
          data: [
            '----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n',
            'X-Bucket: {"position":[0,0,0],"zoomStep":0,"cubeSize":32,"fourBit":false}\r\n',
            '\r\n',
            data,
            '\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n',
            'X-Bucket: {"position":[64,64,64],"zoomStep":1,"cubeSize":32,"fourBit":false}\r\n',
            '\r\n',
            data,
            '\r\n----multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--\r\n'
          ]
          headers: {
            'Content-Type': 'multipart/mixed; boundary=--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--'
          }
          timeout: 10000
          compress: true
          doNotCatch: true
        }

        layer.sendToStore(batch, getBucketData).then((result) ->
          expect(RequestMock.sendArraybufferReceiveArraybuffer.callCount).toBe(1)

          [url, options] = RequestMock.sendArraybufferReceiveArraybuffer.getCall(0).args
          expect(url).toBe(expectedUrl)
          expect(options).toEqual(expectedOptions)

          expect(getBucketData.callCount).toBe(2)
          expect(getBucketData.getCall(0).args[0]).toEqual([0, 0, 0, 0])
          expect(getBucketData.getCall(1).args[0]).toEqual([1, 1, 1, 1])

          done()
        )


