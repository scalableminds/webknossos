/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";
import runAsync from "test/helpers/run-async";

mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});
mockRequire("libs/window", {});
mockRequire("jquery", { fn: {} });
mockRequire("libs/request", null);
require("libs/core_ext");

const { DataBucket } = mockRequire.reRequire("oxalis/model/binary/bucket");
const TemporalBucketManager = mockRequire.reRequire("oxalis/model/binary/temporal_bucket_manager")
  .default;

test.beforeEach(t => {
  const pullQueue = {
    add: sinon.stub(),
    pull: sinon.stub(),
  };

  const pushQueue = {
    insert: sinon.stub(),
    push: sinon.stub(),
  };

  const manager = new TemporalBucketManager(pullQueue, pushQueue);

  t.context.manager = manager;
});

test("Add / Remove should be added when bucket has not been requested", t => {
  const { manager } = t.context;
  const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
  bucket.label(_.noop);
  t.is(manager.getCount(), 1);
});

test("Add / Remove should be added when bucket has not been received", t => {
  const { manager } = t.context;
  const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
  bucket.pull();
  t.is(bucket.needsRequest(), false);

  bucket.label(_.noop);
  t.is(manager.getCount(), 1);
});

test("Add / Remove should not be added when bucket has been received", t => {
  const { manager } = t.context;
  const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
  bucket.pull();
  bucket.receiveData(new Uint8Array(1 << 15));
  t.is(bucket.isLoaded(), true);

  bucket.label(_.noop);
  t.is(manager.getCount(), 0);
});

test("Add / Remove should be removed once it is loaded", t => {
  const { manager } = t.context;
  const bucket = new DataBucket(8, [0, 0, 0, 0], manager);
  bucket.label(_.noop);
  bucket.pull();
  bucket.receiveData(new Uint8Array(1 << 15));

  t.is(manager.getCount(), 0);
});

function prepareBuckets(manager) {
  // Insert two buckets into manager
  const bucket1 = new DataBucket(8, [0, 0, 0, 0], manager);
  const bucket2 = new DataBucket(8, [1, 0, 0, 0], manager);
  for (const bucket of [bucket1, bucket2]) {
    bucket.label(_.noop);
    bucket.pull();
  }
  return { bucket1, bucket2 };
}

test("Make Loaded Promise should be initially unresolved", t => {
  const { manager } = t.context;
  prepareBuckets(manager);
  let resolved = false;
  manager.getAllLoadedPromise().then(() => {
    resolved = true;
  });
  return runAsync([
    () => {
      t.is(resolved, false);
    },
  ]);
});

test("Make Loaded Promise should be unresolved when only one bucket is loaded", t => {
  const { manager } = t.context;
  const { bucket1 } = prepareBuckets(manager);
  let resolved = false;
  manager.getAllLoadedPromise().then(() => {
    resolved = true;
  });
  bucket1.receiveData(new Uint8Array(1 << 15));

  return runAsync([
    () => {
      t.is(resolved, false);
    },
  ]);
});

test("Make Loaded Promise should be resolved when both buckets are loaded", t => {
  const { manager } = t.context;
  const { bucket1, bucket2 } = prepareBuckets(manager);
  let resolved = false;
  manager.getAllLoadedPromise().then(() => {
    resolved = true;
  });
  bucket1.receiveData(new Uint8Array(1 << 15));
  bucket2.receiveData(new Uint8Array(1 << 15));

  return runAsync([
    () => {
      t.is(resolved, true);
    },
  ]);
});
