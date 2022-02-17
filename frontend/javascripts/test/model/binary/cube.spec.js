// @flow
import _ from "lodash";

import { ResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import { sleep } from "libs/utils";
import anyTest, { type TestInterface } from "ava";
import datasetServerObject from "test/fixtures/dataset_server_object";
import mockRequire from "mock-require";
import runAsync from "test/helpers/run-async";
import sinon from "sinon";

mockRequire.stopAll();

const StoreMock = {
  getState: () => ({
    dataset: datasetServerObject,
    tracing: { skeleton: skeletontracingServerObject },
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
  notify() {},
});
mockRequire("libs/toast", { error: _.noop });

// Avoid node caching and make sure all mockRequires are applied
const Cube = mockRequire.reRequire("oxalis/model/bucket_data_handling/data_cube").default;

// Ava's recommendation for Flow types
// https://github.com/avajs/ava/blob/master/docs/recipes/flow.md#typing-tcontext
const test: TestInterface<{
  cube: typeof Cube,
  pullQueue: Object,
  pushQueue: Object,
}> = (anyTest: any);

test.beforeEach(t => {
  const mockedLayer = {
    resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16], [32, 32, 32]],
  };
  const resolutionInfo = new ResolutionInfo(mockedLayer.resolutions);
  const cube = new Cube([100, 100, 100], resolutionInfo, "uint32", false);

  class PullQueueMock {
    queue = [];
    processedQueue = [];
    add(item) {
      this.queue.push(item);
    }

    async pull() {
      // If the pull happens synchronously, the bucketLoaded promise
      // in Bucket.ensureLoaded() is created too late. Therefore,
      // we put a small sleep in here (this mirrors the behavior when
      // actually downloading data).
      await sleep(10);
      for (const item of this.queue) {
        const bucket = cube.getBucket(item.bucket, true);
        if (bucket.type === "data") {
          bucket.markAsPulled();
          bucket.receiveData(new Uint8Array(4 * 32 ** 3));
        }
      }
      this.processedQueue = this.queue;
      this.queue = [];
    }
  }

  const pullQueue = new PullQueueMock();
  const pushQueue = {
    insert: sinon.stub(),
    push: sinon.stub(),
  };
  cube.initializeWithQueues(pullQueue, pushQueue);

  t.context = {
    cube,
    pullQueue,
    pushQueue,
  };
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

  cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], 42, 0);

  t.plan(1);
  return runAsync([
    () => {
      t.deepEqual(pullQueue.processedQueue[0], {
        bucket: [0, 0, 0, 0],
        priority: -1,
      });
    },
  ]);
});

test("Voxel Labeling should push buckets after they were pulled", async t => {
  const { cube, pushQueue } = t.context;
  await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], 42, 0);

  t.plan(1);
  const bucket = cube.getBucket([0, 0, 0, 0]);

  return runAsync([
    () => {
      t.true(pushQueue.insert.calledWith(bucket));
    },
  ]);
});

test("Voxel Labeling should push buckets immediately if they are pulled already", async t => {
  const { cube, pushQueue } = t.context;
  const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
  bucket.markAsPulled();
  bucket.receiveData(new Uint8Array(4 * 32 ** 3));

  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], 42, 0);

  t.plan(1);
  return runAsync([
    () => {
      t.true(pushQueue.insert.calledWith(bucket));
    },
  ]);
});

test("Voxel Labeling should only instantiate one bucket when labelling the same bucket twice", async t => {
  const { cube } = t.context;
  // Creates bucket
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], 42, 0);
  // Uses existing bucket
  await cube._labelVoxelInResolution_DEPRECATED([1, 0, 0], 43, 0);

  const data = cube.getBucket([0, 0, 0, 0]).getData();

  t.is(data[0], 42);
  t.is(data[1], 43);
});

test("getDataValue() should return the raw value without a mapping", async t => {
  const { cube } = t.context;
  const value = 1 * (1 << 16) + 2 * (1 << 8) + 3;
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], value, 0);

  t.is(cube.getDataValue([0, 0, 0]), value);
});

test("getDataValue() should return the mapping value if available", async t => {
  const { cube } = t.context;
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], 42, 0);
  await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], 43, 0);

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
  b1.markAsPulled();

  cube.getOrCreateBucket([1, 1, 1, 0]);
  cube.getOrCreateBucket([2, 2, 2, 0]);
  cube.getOrCreateBucket([3, 3, 3, 0]);

  t.is(b1.shouldCollect(), false);

  const addresses = cube.buckets.map(b => b.zoomedAddress);
  t.deepEqual(addresses, [[0, 0, 0, 0], [3, 3, 3, 0], [2, 2, 2, 0]]);
});

test("getVoxelIndexByVoxelOffset should return the correct index of a position within a bucket", t => {
  const { cube } = t.context;
  let index = cube.getVoxelIndexByVoxelOffset([0, 0, 0]);
  t.is(index, 0);
  index = cube.getVoxelIndexByVoxelOffset([10, 10, 10]);
  t.is(index, 10570);
});
