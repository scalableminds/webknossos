/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";
import runAsync from "test/helpers/run-async";
import { DataBucket } from "oxalis/model/binary/bucket";
import TemporalBucketManager from "oxalis/model/binary/temporal_bucket_manager";

mockRequire.stopAll();

mockRequire("jquery", { fn: {} });
mockRequire("libs/request", null);
require("libs/core_ext");


describe("TemporalBucketManager", () => {
  let pullQueue = null;
  let pushQueue = null;
  let manager = null;


  beforeEach(() => {
    pullQueue = {
      add: sinon.stub(),
      pull: sinon.stub(),
    };

    pushQueue = {
      insert: sinon.stub(),
      push: sinon.stub(),
    };

    manager = new TemporalBucketManager(pullQueue, pushQueue);
  });


  describe("Add / Remove", () => {
    it("should be added when bucket has not been requested", () => {
      const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
      bucket.label(_.noop);
      expect(manager.getCount()).toBe(1);
    });

    it("should be added when bucket has not been received", () => {
      const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
      bucket.pull();
      expect(bucket.needsRequest()).toBe(false);

      bucket.label(_.noop);
      expect(manager.getCount()).toBe(1);
    });

    it("should not be added when bucket has been received", () => {
      const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
      bucket.pull();
      bucket.receiveData(new Uint8Array(1 << 15));
      expect(bucket.isLoaded()).toBe(true);

      bucket.label(_.noop);
      expect(manager.getCount()).toBe(0);
    });

    it("should be removed once it is loaded", () => {
      const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
      bucket.label(_.noop);
      bucket.pull();
      bucket.receiveData(new Uint8Array(1 << 15));

      expect(manager.getCount()).toBe(0);
    });
  });

  describe("Make Loaded Promise", () => {
    let bucket1 = null;
    let bucket2 = null;

    beforeEach(() => {
      // Insert two buckets into manager
      bucket1 = new DataBucket(8, [0, 0, 0, 0], manager);
      bucket2 = new DataBucket(8, [1, 0, 0, 0], manager);
      for (const bucket of [bucket1, bucket2]) {
        bucket.label(_.noop);
        bucket.pull();
      }
    });


    it("should be initially unresolved", (done) => {
      let resolved = false;
      manager.getAllLoadedPromise().then(() => { resolved = true; });
      runAsync([
        () => {
          expect(resolved).toBe(false);
          done();
        },
      ]);
    });

    it("should be unresolved when only one bucket is loaded", (done) => {
      let resolved = false;
      manager.getAllLoadedPromise().then(() => { resolved = true; });
      bucket1.receiveData(new Uint8Array(1 << 15));

      runAsync([
        () => {
          expect(resolved).toBe(false);
          done();
        },
      ]);
    });

    it("should be resolved when both buckets are loaded", (done) => {
      let resolved = false;
      manager.getAllLoadedPromise().then(() => { resolved = true; });
      bucket1.receiveData(new Uint8Array(1 << 15));
      bucket2.receiveData(new Uint8Array(1 << 15));

      runAsync([
        () => {
          expect(resolved).toBe(true);
          done();
        },
      ]);
    });
  });
});
