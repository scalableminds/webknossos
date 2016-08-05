mockRequire = require("mock-require")
sinon = require("sinon")
runAsync = require("../../helpers/run-async")
{Bucket} = require("../../../oxalis/model/binary/bucket")

mockRequire.stopAll()

RequestMock = {
  always : (promise, func) -> promise.then(func, func)
}
mockRequire("../../../libs/request", RequestMock)

PullQueue = require("../../../oxalis/model/binary/pullqueue")

describe "PullQueue", ->

  layer = {
    url : "url"
    name : "layername"
    category : "color"
    requestFromStore : sinon.stub()
  }
  cube = {
    BUCKET_SIZE_P : 5
    BUCKET_LENGTH : 32 * 32 * 32
    getBucketByZoomedAddress : sinon.stub()
  }
  boundingBox = {
    containsBucket : sinon.stub().returns(true)
    removeOutsideArea : sinon.stub()
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

    pullQueue = new PullQueue(cube, layer, boundingBox, connectionInfo, datastoreInfo)

    buckets = [new Bucket(8, [0, 0, 0, 0], null), new Bucket(8, [1, 1, 1, 1], null)]
    for bucket in buckets
      pullQueue.add({bucket: bucket.zoomedAddress, priority : 0})
      cube.getBucketByZoomedAddress.withArgs(bucket.zoomedAddress).returns(bucket)


  describe "Successful pulling", ->

    bucketData1 = (i % 256 for i in [0...(32 * 32 * 32)])
    bucketData2 = ((2 * i) % 256 for i in [0...(32 * 32 * 32)])

    beforeEach ->

      responseBuffer = new Uint8Array(bucketData1.concat(bucketData2))
      layer.requestFromStore = sinon.stub()
      layer.requestFromStore.returns(Promise.resolve(responseBuffer))


    it "should pass the correct parameters to requestFromStore()", ->

      pullQueue.pull()

      expect(layer.requestFromStore.callCount).toBe(1)
      [batch] = layer.requestFromStore.getCall(0).args
      expect(batch).toEqual([
        {position: [0, 0, 0], zoomStep: 0, cubeSize: 32, fourBit: false}
        {position: [64, 64, 64], zoomStep: 1, cubeSize: 32, fourBit: false}
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

      layer.requestFromStore = sinon.stub()
      layer.requestFromStore.onFirstCall().returns(Promise.reject())
      layer.requestFromStore.onSecondCall().returns(
          Promise.resolve(new Uint8Array(32 * 32 * 32)))


    it "should not request twice if not bucket dirty", (done) ->

      pullQueue.pull()

      runAsync([
        ->
          expect(layer.requestFromStore.callCount).toBe(1)
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
          expect(layer.requestFromStore.callCount).toBe(2)
          expect(buckets[0].state).toBe(Bucket::STATE_LOADED)
          expect(buckets[1].state).toBe(Bucket::STATE_UNREQUESTED)
          done()
      ])
