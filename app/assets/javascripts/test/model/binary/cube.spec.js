/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/*
 * cube.spec.js
 * @flow
 */
import test from "ava";
import mockRequire from "mock-require";
import sinon from "sinon";
import _ from "lodash";
import runAsync from "test/helpers/run-async";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";

mockRequire.stopAll();

const StoreMock = {
  getState: () => ({
    dataset: datasetServerObject,
    tracing: skeletontracingServerObject,
    datasetConfiguration: { fourBit: false },
  }),
  dispatch: sinon.stub(),
  subscribe: sinon.stub(),
};

mockRequire("oxalis/store", StoreMock);

mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});
mockRequire("app", {});
mockRequire("libs/error_handling", {
  assertExists(expr) {
    this.assert(expr != null);
  },
  assert(expr) {
    if (!expr) throw new Error("Assertion failed");
  },
});
mockRequire("libs/toast", { error: _.noop });

// Avoid node caching and make sure all mockRequires are applied
const Cube = mockRequire.reRequire("oxalis/model/bucket_data_handling/data_cube").default;

test.beforeEach(t => {
  const mockedLayer = {
    resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16], [32, 32, 32]],
  };
  const cube = new Cube([100, 100, 100], 3, 24, mockedLayer);
  const pullQueue = {
    add: sinon.stub(),
    pull: sinon.stub(),
  };
  const pushQueue = {
    insert: sinon.stub(),
    push: sinon.stub(),
  };
  cube.initializeWithQueues(pullQueue, pushQueue);

  // workaround, which shouldn't be necessary after this landed:
  // https://github.com/avajs/ava/pull/1344
  const context = ((t: any).context: any);
  context.cube = cube;
  context.pullQueue = pullQueue;
  context.pushQueue = pushQueue;
});

test("GetBucket should return a NullBucket on getBucket()", t => {
  const { cube } = t.context;
  const bucket = cube.getBucket([0, 0, 0, 0]);
  t.is(bucket.type, "null");
  t.is(cube.bucketCount, 0);
});

test("GetBucket should create a new bucket on getOrCreateBucket()", t => {
  const { cube } = t.context;
  t.is(cube.bucketCount, 0);

  const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
  t.is(bucket.type, "data");
  t.is(cube.bucketCount, 1);
});

test("GetBucket should only create one bucket on getOrCreateBucket()", t => {
  const { cube } = t.context;
  const bucket1 = cube.getOrCreateBucket([0, 0, 0, 0]);
  const bucket2 = cube.getOrCreateBucket([0, 0, 0, 0]);
  t.is(bucket1, bucket2);
  t.is(cube.bucketCount, 1);
});

test("Voxel Labeling should request buckets when temporal buckets are created", t => {
  const { cube, pullQueue } = t.context;
  cube.labelVoxel([1, 1, 1], 42);

  t.plan(2);
  return runAsync([
    () => {
      t.true(
        pullQueue.add.calledWith({
          bucket: [0, 0, 0, 0],
          priority: -1,
        }),
      );
      t.true(pullQueue.pull.called);
    },
  ]);
});

test("Voxel Labeling should push buckets after they were pulled", t => {
  const { cube, pushQueue } = t.context;
  cube.labelVoxel([1, 1, 1], 42);

  t.plan(3);
  let bucket;
  return runAsync([
    () => {
      t.is(pushQueue.insert.called, false);
    },
    () => {
      bucket = cube.getBucket([0, 0, 0, 0]);
      bucket.pull();
      bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3));
      t.pass();
    },
    () => {
      t.true(pushQueue.insert.calledWith(bucket));
    },
  ]);
});

test("Voxel Labeling should push buckets immediately if they are pulled already", t => {
  const { cube, pushQueue } = t.context;
  const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
  bucket.pull();
  bucket.receiveData(new Uint8Array(32 * 32 * 32 * 3));

  cube.labelVoxel([0, 0, 0], 42);

  t.plan(1);
  return runAsync([
    () => {
      t.true(pushQueue.insert.calledWith(bucket));
    },
  ]);
});

test("Voxel Labeling should only create one temporal bucket", t => {
  const { cube } = t.context;
  // Creates temporal bucket
  cube.labelVoxel([0, 0, 0], 42);
  // Uses existing temporal bucket
  cube.labelVoxel([1, 0, 0], 43);

  const data = cube.getBucket([0, 0, 0, 0]).getData();

  // Both values should be in the bucket, at positions 0 and 3 because of
  // the bit(depth of 2function() {
  t.is(data[0], 42);
  t.is(data[3], 43);
});

test("Voxel Labeling should merge incoming buckets", t => {
  const { cube } = t.context;
  const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);

  const oldData = new Uint8Array(32 * 32 * 32 * 3);
  // First voxel should be overwritten by new data
  oldData[0] = 1;
  oldData[1] = 2;
  oldData[2] = 3;
  // Second voxel should be merged into new data
  oldData[3] = 4;
  oldData[4] = 5;
  oldData[5] = 6;

  cube.labelVoxel([0, 0, 0], 42);

  bucket.pull();
  bucket.receiveData(oldData);

  const newData = bucket.getData();
  t.is(newData[0], 42);
  t.is(newData[1], 0);
  t.is(newData[2], 0);
  t.is(newData[3], 4);
  t.is(newData[4], 5);
  t.is(newData[5], 6);
});

test("getDataValue() should return the raw value without a mapping", t => {
  const { cube } = t.context;
  const value = 1 * (1 << 16) + 2 * (1 << 8) + 3;
  cube.labelVoxel([0, 0, 0], value);

  t.is(cube.getDataValue([0, 0, 0]), value);
});

test("getDataValue() should return the mapping value if available", t => {
  const { cube } = t.context;
  cube.labelVoxel([0, 0, 0], 42);
  cube.labelVoxel([1, 1, 1], 43);

  const mapping = [];
  mapping[42] = 1;

  t.is(cube.getDataValue([0, 0, 0], mapping), 1);
  t.is(cube.getDataValue([1, 1, 1], mapping), 43);
});

test("Garbage Collection should only keep 3 buckets", t => {
  const { cube } = t.context;
  cube.MAXIMUM_BUCKET_COUNT = 3;
  cube.buckets = new Array(cube.MAXIMUM_BUCKET_COUNT);

  cube.getOrCreateBucket([0, 0, 0, 0]);
  cube.getOrCreateBucket([1, 1, 1, 0]);
  cube.getOrCreateBucket([2, 2, 2, 0]);
  cube.getOrCreateBucket([3, 3, 3, 0]);

  t.is(cube.bucketCount, 3);
});

test("Garbage Collection should not collect buckets with shouldCollect() == false", t => {
  const { cube } = t.context;
  cube.MAXIMUM_BUCKET_COUNT = 3;
  cube.buckets = new Array(cube.MAXIMUM_BUCKET_COUNT);

  const b1 = cube.getOrCreateBucket([0, 0, 0, 0]);
  b1.pull();

  cube.getOrCreateBucket([1, 1, 1, 0]);
  cube.getOrCreateBucket([2, 2, 2, 0]);
  cube.getOrCreateBucket([3, 3, 3, 0]);

  t.is(b1.shouldCollect(), false);

  const addresses = cube.buckets.map(b => b.zoomedAddress);
  t.deepEqual(addresses, [[0, 0, 0, 0], [3, 3, 3, 0], [2, 2, 2, 0]]);
});

test("Garbage Collection should throw an exception if no bucket is collectable", t => {
  const { cube } = t.context;
  cube.MAXIMUM_BUCKET_COUNT = 3;
  cube.buckets = new Array(cube.MAXIMUM_BUCKET_COUNT);

  cube.getOrCreateBucket([0, 0, 0, 0]).pull();
  cube.getOrCreateBucket([1, 1, 1, 0]).pull();
  cube.getOrCreateBucket([2, 2, 2, 0]).pull();

  t.throws(() => cube.getOrCreateBucket([3, 3, 3, 0]));
});
