/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import _ from "lodash"
import mockRequire from "mock-require"
import sinon from "sinon"
import runAsync from "../../helpers/run-async"

mockRequire.stopAll()

mockRequire("jquery", {fn : {}})
mockRequire("../../../libs/request", null)
require("../../../libs/core_ext")

mockRequire("../../../oxalis/model/binary/pullqueue", {
  prototype : {
    PRIORITY_HIGHEST: 123
  }
})

import {Bucket} from "../../../oxalis/model/binary/bucket"
import TemporalBucketManager from "../../../oxalis/model/binary/temporal_bucket_manager"


describe("TemporalBucketManager", function() {

  let pullQueue = null;
  let pushQueue = null;
  let manager = null;


  beforeEach(function() {

    pullQueue = {
      add : sinon.stub(),
      pull : sinon.stub()
    }

    pushQueue = {
      insert : sinon.stub(),
      push : sinon.stub()
    }

    manager = new TemporalBucketManager(pullQueue, pushQueue);
  })


  describe("Add / Remove", function() {

    it("should be added when bucket has not been requested", function() {

      const bucket = new Bucket(8, [0, 0, 0, 0], manager)
      bucket.label(_.noop)
      expect(manager.getCount()).toBe(1)
    })

    it("should be added when bucket has not been received", function() {

      const bucket = new Bucket(8, [0, 0, 0, 0], manager)
      bucket.pull()
      expect(bucket.needsRequest()).toBe(false)

      bucket.label(_.noop)
      expect(manager.getCount()).toBe(1)
    })

    it("should not be added when bucket has been received", function() {

      const bucket = new Bucket(8, [0, 0, 0, 0], manager)
      bucket.pull()
      bucket.receiveData(new Uint8Array(1 << 15))
      expect(bucket.isLoaded()).toBe(true)

      bucket.label(_.noop)
      expect(manager.getCount()).toBe(0)
    })

    it("should be removed once it is loaded", function() {

      const bucket = new Bucket(8, [0, 0, 0, 0], manager)
      bucket.label(_.noop)
      bucket.pull()
      bucket.receiveData(new Uint8Array(1 << 15))

      expect(manager.getCount()).toBe(0)
    })
  })

  describe("Make Loaded Promise", function() {

    let bucket1 = null;
    let bucket2 = null;

    beforeEach(function() {

      // Insert two buckets into manager
      bucket1 = new Bucket(8, [0, 0, 0, 0], manager)
      bucket2 = new Bucket(8, [1, 0, 0, 0], manager)
      for (const bucket of [bucket1, bucket2]) {
        bucket.label(_.noop)
        bucket.pull()
      }
    })


    it("should be initially unresolved", function(done) {

      let resolved = false
      manager.getAllLoadedPromise().then(() => resolved = true)
      runAsync([
        () => {
          expect(resolved).toBe(false)
          done()
        }
      ])
    })

    it("should be unresolved when only one bucket is loaded", function(done) {

      let resolved = false
      manager.getAllLoadedPromise().then(() => resolved = true)
      bucket1.receiveData(new Uint8Array(1 << 15))

      runAsync([
        () => {
          expect(resolved).toBe(false)
          done()
        }
      ])
    })

    it("should be resolved when both buckets are loaded", function(done) {

      let resolved = false
      manager.getAllLoadedPromise().then(() => resolved = true)
      bucket1.receiveData(new Uint8Array(1 << 15))
      bucket2.receiveData(new Uint8Array(1 << 15))

      runAsync([
        () => {
          expect(resolved).toBe(true)
          done()
        }
      ])
    })
  })
})
