/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import mockRequire from "mock-require"
import sinon from "sinon"
import runAsync from "../../helpers/run-async"

mockRequire.stopAll()

mockRequire("../../../oxalis/model/binary/pullqueue", {
  prototype : {
    PRIORITY_HIGHEST: 123
  }
})

const Cube = require("../../../oxalis/model/binary/cube").default;

describe("Cube", function() {

  let cube = null
  const pullQueue = {
    add : sinon.stub(),
    pull : sinon.stub()
  }
  const pushQueue = {
    insert : sinon.stub(),
    push : sinon.stub()
  }

  beforeEach(function() {
    cube = new Cube(null, [100, 100, 100], 3, 24)
    cube.initializeWithQueues(pullQueue, pushQueue)
  })


  describe("GetBucket", function() {

    it("should return a NullBucket on getBucket()", function() {

      const bucket = cube.getBucket([0, 0, 0, 0])
      expect(bucket.isNullBucket).toBe(true)
      expect(cube.bucketCount).toBe(0)
    })

    it("should create a new bucket on getOrCreateBucket()", function() {

      expect(cube.bucketCount).toBe(0)

      const bucket = cube.getOrCreateBucket([0, 0, 0, 0])
      expect(bucket.isNullBucket).toBe(undefined)
      expect(cube.bucketCount).toBe(1)
    })

    it("should only create one bucket on getOrCreateBucket()", function() {

      const bucket1 = cube.getOrCreateBucket([0, 0, 0, 0])
      const bucket2 = cube.getOrCreateBucket([0, 0, 0, 0])
      expect(bucket1).toBe(bucket2)
      expect(cube.bucketCount).toBe(1)
    })
  })

  describe("Volume Annotation Handling", function() {

    describe("Voxel Labeling", function() {

      it("should request buckets when temporal buckets are created", function(done) {

        cube.labelVoxel([1, 1, 1], 42)

        runAsync([
          () => {
            expect(pullQueue.add.calledWith({
                bucket: [0, 0, 0, 0],
                priority: 123})
            ).toBe(true)

            expect(pullQueue.pull.called).toBe(true)

            done()
          }
        ])
      })

      it("should push buckets after they were pulled", function(done) {

        cube.labelVoxel([1, 1, 1], 42)

        runAsync([
          () => {
            expect(pushQueue.insert.called).toBe(false)
          },
          () => {
            const bucket = cube.getBucket([0, 0, 0, 0])
            bucket.pull()
            bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3))
          },
          () => {
            expect(pushQueue.insert.calledWith(
              [0, 0, 0, 0]
            )).toBe(true)
            done()
          }
        ])
      })

      it("should push buckets immediately if they are pulled already", function(done) {

        const bucket = cube.getOrCreateBucket([0, 0, 0, 0])
        bucket.pull()
        bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3))

        cube.labelVoxel([0, 0, 0], 42)

        runAsync([
          () => {
            expect(pushQueue.insert.calledWith(
              [0, 0, 0, 0]
            )).toBe(true)
            done()
          }
        ])
      })

      it("should only create one temporal bucket", function() {

        // Creates temporal bucket
        cube.labelVoxel([0, 0, 0], 42)
        // Uses existing temporal bucket
        cube.labelVoxel([1, 0, 0], 43)

        const data = cube.getBucket([0, 0, 0, 0]).getData()

        // Both values should be in the bucket, at positions 0 and 3 because of
        // the bit(depth of 2function() {
        expect(data[0]).toBe(42)
        expect(data[3]).toBe(43)
      })

      it("should merge incoming buckets", function() {

        const bucket = cube.getOrCreateBucket([0, 0, 0, 0])

        const oldData = new Uint8Array(32 * 32 * 32 * 3)
        // First voxel should be overwritten by new data
        oldData[0] = 1
        oldData[1] = 2
        oldData[2] = 3
        // Second voxel should be merged into new data
        oldData[3] = 4
        oldData[4] = 5
        oldData[5] = 6

        cube.labelVoxel([0, 0, 0], 42)

        bucket.pull()
        bucket.receiveData(oldData)

        const newData = bucket.getData()
        expect(newData[0]).toBe(42)
        expect(newData[1]).toBe(0)
        expect(newData[2]).toBe(0)
        expect(newData[3]).toBe(4)
        expect(newData[4]).toBe(5)
        expect(newData[5]).toBe(6)
      })
    })

    describe("getDataValue()", function() {

      it("should return the raw value without a mapping", function() {

        const value = 1 * (1 << 16) + 2 * (1 << 8) + 3
        cube.labelVoxel([0, 0, 0], value)

        expect(cube.getDataValue([0, 0, 0])).toBe(value)
      })

      it("should return the mapping value if available", function() {

        cube.labelVoxel([0, 0, 0], 42)
        cube.labelVoxel([1, 1, 1], 43)

        const mapping = {42 : 1}

        expect(cube.getDataValue([0, 0, 0], mapping)).toBe(1)
        expect(cube.getDataValue([1, 1, 1], mapping)).toBe(43)
      })
    })
  })

  describe("Garbage Collection", function() {

    beforeEach(function(){
      Cube.prototype.MAXIMUM_BUCKET_COUNT = 3
    })


    it("should only keep 3 buckets", function() {

      cube.getOrCreateBucket([0, 0, 0, 0])
      cube.getOrCreateBucket([1, 1, 1, 0])
      cube.getOrCreateBucket([2, 2, 2, 0])
      cube.getOrCreateBucket([3, 3, 3, 0])

      expect(cube.bucketCount).toBe(3)
    })

    it("should not collect buckets with shouldCollect() == false", function() {

      const b1 = cube.getOrCreateBucket([0, 0, 0, 0])
      b1.pull()
      const b2 = cube.getOrCreateBucket([1, 1, 1, 0])
      const b3 = cube.getOrCreateBucket([2, 2, 2, 0])
      const b4 = cube.getOrCreateBucket([3, 3, 3, 0])

      expect(b1.shouldCollect()).toBe(false)

      const addresses = cube.buckets.map((b) => b.zoomedAddress)
      expect(addresses).toEqual([[0, 0, 0, 0], [3, 3, 3, 0], [2, 2, 2, 0]])
    })

    it("should throw an exception if no bucket is collectable", function() {

      cube.getOrCreateBucket([0, 0, 0, 0]).pull()
      cube.getOrCreateBucket([1, 1, 1, 0]).pull()
      cube.getOrCreateBucket([2, 2, 2, 0]).pull()

      expect(() => cube.getOrCreateBucket([3, 3, 3, 0])).toThrow()
    })
  })
})
