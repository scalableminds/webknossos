mockRequire = require("mock-require")
sinon = require("sinon")
runAsync = require("../../helpers/run-async")

mockRequire.stopAll()

mockRequire("../../../oxalis/model/binary/pullqueue", {
  prototype : {
    PRIORITY_HIGHEST: 123
  }
})

Cube = require("../../../oxalis/model/binary/cube")

describe "Cube", ->

  cube = null
  pullQueue = {
    add : sinon.stub()
    pull : sinon.stub()
  }
  pushQueue = {
    insert : sinon.stub()
    push : sinon.stub()
  }

  beforeEach ->

    cube = new Cube([100, 100, 100], 3, 24)
    cube.initializeWithQueues(pullQueue, pushQueue)


  describe "Volume Annotation Handling", ->

    describe "Voxel Labeling", ->

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
          ->
            bucket = cube.getBucketByZoomedAddress([0, 0, 0, 0])
            bucket.pull()
            bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3))
          ->
            expect(pushQueue.insert.calledWith(
              [0, 0, 0, 0]
            )).toBe(true)
            done()
        ])

      it "should push buckets immediately if they are pulled already", (done) ->

        bucket = cube.getBucketByZoomedAddress([0, 0, 0, 0])
        bucket.pull()
        bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3))

        cube.labelVoxel([0, 0, 0], 42)

        runAsync([
          ->
            expect(pushQueue.insert.calledWith(
              [0, 0, 0, 0]
            )).toBe(true)
            done()
        ])

      it "should only create one temporal bucket", ->

        # Creates temporal bucket
        cube.labelVoxel([0, 0, 0], 42)
        # Uses existing temporal bucket
        cube.labelVoxel([1, 0, 0], 43)

        data = cube.getBucketByZoomedAddress([0, 0, 0, 0]).getData()

        # Both values should be in the bucket, at positions 0 and 3 because of
        # the bit depth of 24.
        expect(data[0]).toBe(42)
        expect(data[3]).toBe(43)

      it "should merge incoming buckets", ->

        bucket = cube.getBucketByZoomedAddress([0, 0, 0, 0])

        oldData = new Uint8Array(32 * 32 * 32 * 3)
        # First voxel should be overwritten by new data
        oldData[0] = 1
        oldData[1] = 2
        oldData[2] = 3
        # Second voxel should be merged into new data
        oldData[3] = 4
        oldData[4] = 5
        oldData[5] = 6

        cube.labelVoxel([0, 0, 0], 42)

        bucket.pull()
        bucket.receiveData(oldData)

        newData = bucket.getData()
        expect(newData[0]).toBe(42)
        expect(newData[1]).toBe(0)
        expect(newData[2]).toBe(0)
        expect(newData[3]).toBe(4)
        expect(newData[4]).toBe(5)
        expect(newData[5]).toBe(6)

    describe "getDataValue()", ->

      it "should return the raw value without a mapping", ->

        value = 1 * (1 << 16) + 2 * (1 << 8) + 3
        cube.labelVoxel([0, 0, 0], value)

        expect(cube.getDataValue([0, 0, 0])).toBe(value)

      it "should return the mapping value if available", ->

        cube.labelVoxel([0, 0, 0], 42)
        cube.labelVoxel([1, 1, 1], 43)

        mapping = {42 : 1}

        expect(cube.getDataValue([0, 0, 0], mapping)).toBe(1)
        expect(cube.getDataValue([1, 1, 1], mapping)).toBe(43)

    describe "Garbage Collection", ->

      beforeEach ->

        Cube::MAXIMUM_BUCKET_COUNT = 3

      it "should only keep 3 buckets", ->

        cube.getBucketByZoomedAddress([0, 0, 0, 0])
        cube.getBucketByZoomedAddress([1, 1, 1, 0])
        cube.getBucketByZoomedAddress([2, 2, 2, 0])
        cube.getBucketByZoomedAddress([3, 3, 3, 0])

        expect(cube.bucketCount).toBe(3)

      it "should not collect buckets with shouldCollect() == false", ->

        b1 = cube.getBucketByZoomedAddress([0, 0, 0, 0])
        b1.pull()
        b2 = cube.getBucketByZoomedAddress([1, 1, 1, 0])
        b3 = cube.getBucketByZoomedAddress([2, 2, 2, 0])
        b4 = cube.getBucketByZoomedAddress([3, 3, 3, 0])

        expect(b1.shouldCollect()).toBe(false)

        addresses = cube.buckets.map((b) -> b.zoomedAddress)
        expect(addresses).toEqual([[0, 0, 0, 0], [3, 3, 3, 0], [2, 2, 2, 0]])

      it "should throw an exception if no bucket is collectable", ->

        cube.getBucketByZoomedAddress([0, 0, 0, 0]).pull()
        cube.getBucketByZoomedAddress([1, 1, 1, 0]).pull()
        cube.getBucketByZoomedAddress([2, 2, 2, 0]).pull()

        expect(-> cube.getBucketByZoomedAddress([3, 3, 3, 0])).toThrow()

