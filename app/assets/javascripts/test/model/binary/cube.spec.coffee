mockRequire = require("mock-require")
sinon = require("sinon")
runAsync = require("../../helpers/run-async")

mockRequire("../../../oxalis/model/binary/pullqueue", {
  prototype : {
    PRIORITY_HIGHEST: 123
  }
})

Cube = require("../../../oxalis/model/binary/cube")

describe "Cube", ->

  cube = null
  pullQueue = null
  pushQueue = null

  beforeEach ->

    pullQueue = {
      add : sinon.stub()
      pull : sinon.stub()
    }

    pushQueue = {
      insert : sinon.stub()
      push : sinon.stub()
    }

    cube = new Cube([100, 100, 100], 3, 24)
    cube.setPullQueue(pullQueue)
    cube.setPushQueue(pushQueue)


  describe "Volume Annotation Handling", ->

    it "should request buckets when temporal buckets are created", (done) ->

      cube.labelVoxel([1, 1, 1], 42)

      runAsync([
        ->
          expect(pullQueue.add.calledWith({
              bucket: [0, 0, 0, 0],
              priority: 123})
          ).toBe(true)

          expect(pullQueue.pull.called).toBe(true)

          done()
      ])

    it "should push buckets after they were pulled", (done) ->

      cube.labelVoxel([1, 1, 1], 42)

      runAsync([
        ->
          expect(pushQueue.insert.called).toBe(false)
          expect(pushQueue.push.called).toBe(false)
        ->
          bucket = cube.getBucketByZoomedAddress([0, 0, 0, 0])
          bucket.pull()
          bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3))
        ->
          expect(pushQueue.insert.calledWith(
            [0, 0, 0, 0]
          )).toBe(true)
          expect(pushQueue.push.called).toBe(true)
          done()
      ])

    it "should only create one temporal bucket", ->

      cube.labelVoxel([0, 0, 0], 42)
      cube.labelVoxel([1, 0, 0], 43)

      data = cube.getBucketByZoomedAddress([0, 0, 0, 0]).getData()

      # Both values should be in the bucket, at positions 0 and 3 because of
      # the bit depth of 24.
      expect(data[0]).toBe(42)
      expect(data[3]).toBe(43)
