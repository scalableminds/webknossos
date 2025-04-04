import "test/mocks/lz4";
import _ from "lodash";
import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import { sleep } from "libs/utils";
import anyTest, { type TestFn } from "ava";
import datasetServerObject from "test/fixtures/dataset_server_object";
import mockRequire from "mock-require";
import runAsync from "test/helpers/run-async";
import sinon from "sinon";
import { MagInfo } from "oxalis/model/helpers/mag_info";
import type { Vector3, Vector4 } from "oxalis/constants";
import { assertNonNullBucket, type DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type DataCubeType from "oxalis/model/bucket_data_handling/data_cube";

const StoreMock = {
  getState: () => ({
    dataset: datasetServerObject,
    annotation: {
      skeleton: skeletontracingServerObject,
    },
    datasetConfiguration: {
      fourBit: false,
    },
  }),
  dispatch: sinon.stub(),
  subscribe: sinon.stub(),
};
mockRequire("oxalis/store", StoreMock);
mockRequire("oxalis/model/sagas/root_saga", function* () {
  yield;
});
mockRequire("app", {});
mockRequire("libs/error_handling", {
  assertExists(expr: any) {
    // @ts-ignore
    this.assert(expr != null);
  },

  assert(expr: boolean) {
    if (!expr) throw new Error("Assertion failed");
  },

  notify() {},
});
mockRequire("libs/toast", {
  error: _.noop,
});
// Avoid node caching and make sure all mockRequires are applied
const DataCube: typeof DataCubeType = mockRequire.reRequire(
  "oxalis/model/bucket_data_handling/data_cube",
).default;

// Ava's recommendation for Typescript types
// https://github.com/avajs/ava/blob/main/docs/recipes/typescript.md#typing-tcontext
const test = anyTest as TestFn<{
  cube: DataCubeType;
  pullQueue: Record<string, any>;
  pushQueue: Record<string, any>;
}>;
test.beforeEach((t) => {
  const mockedLayer = {
    resolutions: [
      [1, 1, 1],
      [2, 2, 2],
      [4, 4, 4],
      [8, 8, 8],
      [16, 16, 16],
      [32, 32, 32],
    ] as Vector3[],
  };
  const magInfo = new MagInfo(mockedLayer.resolutions);
  const cube = new DataCube(
    new BoundingBox({ min: [0, 0, 0], max: [100, 100, 100] }),
    [],
    magInfo,
    "uint32",
    false,
    "layerName",
  );

  class PullQueueMock {
    queue: Array<{ bucket: Vector4 }> = [];
    processedQueue: Array<{ bucket: Vector4 }> = [];

    add(item: { bucket: Vector4 }) {
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
          bucket.markAsRequested();
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
  cube.initializeWithQueues(pullQueue as any, pushQueue as any);
  t.context = {
    cube,
    pullQueue,
    pushQueue,
  };
});
test("GetBucket should return a NullBucket on getBucket()", (t) => {
  const { cube } = t.context;
  const bucket = cube.getBucket([0, 0, 0, 0, []]);
  t.is(bucket.type, "null");
  t.is(cube.buckets.length, 0);
});
test("GetBucket should create a new bucket on getOrCreateBucket()", (t) => {
  const { cube } = t.context;
  t.is(cube.buckets.length, 0);
  const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
  t.is(bucket.type, "data");
  t.is(cube.buckets.length, 1);
});
test("GetBucket should only create one bucket on getOrCreateBucket()", (t) => {
  const { cube } = t.context;
  const bucket1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
  const bucket2 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
  t.is(bucket1, bucket2);
  t.is(cube.buckets.length, 1);
});
test("Voxel Labeling should request buckets when temporal buckets are created", (t) => {
  const { cube, pullQueue } = t.context;

  cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 42, 0, null);

  t.plan(1);
  return runAsync([
    () => {
      t.deepEqual(pullQueue.processedQueue[0], {
        bucket: [0, 0, 0, 0, []],
        priority: -1,
      });
    },
  ]);
});
test("Voxel Labeling should push buckets after they were pulled", async (t) => {
  const { cube, pushQueue } = t.context;
  await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 42, 0, null);
  t.plan(1);
  const bucket = cube.getBucket([0, 0, 0, 0, []]);
  return runAsync([
    () => {
      t.true(pushQueue.insert.calledWith(bucket));
    },
  ]);
});
test("Voxel Labeling should push buckets immediately if they are pulled already", async (t) => {
  const { cube, pushQueue } = t.context;
  const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
  assertNonNullBucket(bucket);
  bucket.markAsRequested();
  bucket.receiveData(new Uint8Array(4 * 32 ** 3));
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);
  t.plan(1);
  return runAsync([
    () => {
      t.true(pushQueue.insert.calledWith(bucket));
    },
  ]);
});
test("Voxel Labeling should only instantiate one bucket when labelling the same bucket twice", async (t) => {
  const { cube } = t.context;
  // Creates bucket
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);
  // Uses existing bucket
  await cube._labelVoxelInResolution_DEPRECATED([1, 0, 0], null, 43, 0, null);
  const data = cube.getBucket([0, 0, 0, 0, []]).getData();
  t.is(data[0], 42);
  t.is(data[1], 43);
});
test("getDataValue() should return the raw value without a mapping", async (t) => {
  const { cube } = t.context;
  const value = 1 * (1 << 16) + 2 * (1 << 8) + 3;
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, value, 0, null);
  t.is(cube.getDataValue([0, 0, 0], null, null), value);
});
test("getDataValue() should return the mapping value if available", async (t) => {
  const { cube } = t.context;
  await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);
  await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 43, 0, null);
  const mapping = new Map();
  mapping.set(42, 1);
  t.is(cube.getDataValue([0, 0, 0], null, mapping), 1);
  t.is(cube.getDataValue([1, 1, 1], null, mapping), 43);
});
test("Garbage Collection should only keep 3 buckets when possible", (t) => {
  const { cube } = t.context;
  cube.BUCKET_COUNT_SOFT_LIMIT = 3;
  cube.getOrCreateBucket([0, 0, 0, 0, []]);
  cube.getOrCreateBucket([1, 1, 1, 0]);
  cube.getOrCreateBucket([2, 2, 2, 0]);
  cube.getOrCreateBucket([3, 3, 3, 0]);
  t.is(cube.buckets.length, 3);
});
test("Garbage Collection should not collect buckets with mayBeGarbageCollected() == false", (t) => {
  const { cube } = t.context;
  cube.BUCKET_COUNT_SOFT_LIMIT = 3;
  const b1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
  assertNonNullBucket(b1);
  b1.markAsRequested();
  cube.getOrCreateBucket([1, 1, 1, 0]);
  cube.getOrCreateBucket([2, 2, 2, 0]);
  cube.getOrCreateBucket([3, 3, 3, 0]);
  t.is(b1.mayBeGarbageCollected(true), false);
  const addresses = cube.buckets.map((b: DataBucket) => b.zoomedAddress);
  t.deepEqual(addresses, [
    [0, 0, 0, 0, []],
    [3, 3, 3, 0],
    [2, 2, 2, 0],
  ]);
});
test("Garbage Collection should grow beyond soft limit if necessary", (t) => {
  const { cube } = t.context;
  cube.BUCKET_COUNT_SOFT_LIMIT = 3;
  const b1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
  const b2 = cube.getOrCreateBucket([1, 1, 1, 0]);
  const b3 = cube.getOrCreateBucket([2, 2, 2, 0]);
  // No bucket may be collected.
  [b1, b2, b3].map((b) => {
    assertNonNullBucket(b);
    b.markAsRequested();
  });
  // Allocate a 4th one which should still be possible (will exceed BUCKET_COUNT_SOFT_LIMIT)
  cube.getOrCreateBucket([3, 3, 3, 0]);
  const addresses = cube.buckets.map((b: DataBucket) => b.zoomedAddress);
  t.deepEqual(addresses, [
    [0, 0, 0, 0, []],
    [1, 1, 1, 0],
    [2, 2, 2, 0],
    [3, 3, 3, 0],
  ]);
});
test("getVoxelIndexByVoxelOffset should return the correct index of a position within a bucket", (t) => {
  const { cube } = t.context;
  let index = cube.getVoxelIndexByVoxelOffset([0, 0, 0]);
  t.is(index, 0);
  index = cube.getVoxelIndexByVoxelOffset([10, 10, 10]);
  t.is(index, 10570);
});
