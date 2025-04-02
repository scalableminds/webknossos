import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import { sleep } from "libs/utils";
import { describe, it, expect, beforeEach, vi } from "vitest";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { MagInfo } from "oxalis/model/helpers/mag_info";
import type { Vector3, Vector4 } from "oxalis/constants";
import { assertNonNullBucket, type DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import DataCube from "oxalis/model/bucket_data_handling/data_cube";
import runAsync from "test/helpers/run-async";

vi.mock("oxalis/store", () => ({
  default: {
    getState: () => ({
      dataset: datasetServerObject,
      annotation: {
        skeleton: skeletontracingServerObject,
      },
      datasetConfiguration: {
        fourBit: false,
      },
    }),
    dispatch: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock("oxalis/model/sagas/root_saga", () => ({
  default: function* () {
    yield;
  },
}));

vi.mock("app", () => ({}));

describe("DataCube", () => {
  // Define test context
  interface TestContext {
    cube: DataCube;
    pullQueue: {
      queue: Array<{ bucket: Vector4 }>;
      processedQueue: Array<{ bucket: Vector4 }>;
      add: (item: { bucket: Vector4 }) => void;
      pull: () => Promise<void>;
    };
    pushQueue: {
      insert: ReturnType<typeof vi.fn>;
      push: ReturnType<typeof vi.fn>;
    };
  }

  beforeEach<TestContext>(async (context) => {
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
      insert: vi.fn(),
      push: vi.fn(),
    };
    cube.initializeWithQueues(pullQueue as any, pushQueue as any);

    context.cube = cube;
    context.pullQueue = pullQueue;
    context.pushQueue = pushQueue;
  });

  it<TestContext>("GetBucket should return a NullBucket on getBucket()", ({ cube }) => {
    const bucket = cube.getBucket([0, 0, 0, 0, []]);
    expect(bucket.type).toBe("null");
    expect(cube.buckets.length).toBe(0);
  });

  it<TestContext>("GetBucket should create a new bucket on getOrCreateBucket()", ({ cube }) => {
    expect(cube.buckets.length).toBe(0);
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    expect(bucket.type).toBe("data");
    expect(cube.buckets.length).toBe(1);
  });

  it<TestContext>("GetBucket should only create one bucket on getOrCreateBucket()", ({ cube }) => {
    const bucket1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    const bucket2 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    expect(bucket1).toBe(bucket2);
    expect(cube.buckets.length).toBe(1);
  });

  it<TestContext>("Voxel Labeling should request buckets when temporal buckets are created", async ({
    cube,
    pullQueue,
  }) => {
    cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 42, 0, null);

    return runAsync([
      () => {
        expect(pullQueue.processedQueue[0]).toEqual({
          bucket: [0, 0, 0, 0, []],
          priority: -1,
        });
      },
    ]);
  });

  it<TestContext>("Voxel Labeling should push buckets after they were pulled", async ({
    cube,
    pushQueue,
  }) => {
    await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 42, 0, null);

    const bucket = cube.getBucket([0, 0, 0, 0, []]);

    return runAsync([
      () => {
        expect(pushQueue.insert).toHaveBeenCalledWith(bucket);
      },
    ]);
  });

  it<TestContext>("Voxel Labeling should push buckets immediately if they are pulled already", async ({
    cube,
    pushQueue,
  }) => {
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(bucket);
    bucket.markAsPulled();
    bucket.receiveData(new Uint8Array(4 * 32 ** 3));
    await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);

    return runAsync([
      () => {
        expect(pushQueue.insert).toHaveBeenCalledWith(bucket);
      },
    ]);
  });

  it<TestContext>("Voxel Labeling should only instantiate one bucket when labelling the same bucket twice", async ({
    cube,
  }) => {
    // Creates bucket
    await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);
    // Uses existing bucket
    await cube._labelVoxelInResolution_DEPRECATED([1, 0, 0], null, 43, 0, null);
    const data = cube.getBucket([0, 0, 0, 0, []]).getData();
    expect(data[0]).toBe(42);
    expect(data[1]).toBe(43);
  });

  it<TestContext>("getDataValue() should return the raw value without a mapping", async ({
    cube,
  }) => {
    const value = 1 * (1 << 16) + 2 * (1 << 8) + 3;
    await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, value, 0, null);
    expect(cube.getDataValue([0, 0, 0], null, null)).toBe(value);
  });

  it<TestContext>("getDataValue() should return the mapping value if available", async ({
    cube,
  }) => {
    await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);
    await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 43, 0, null);
    const mapping = new Map();
    mapping.set(42, 1);
    expect(cube.getDataValue([0, 0, 0], null, mapping)).toBe(1);
    expect(cube.getDataValue([1, 1, 1], null, mapping)).toBe(43);
  });

  it<TestContext>("Garbage Collection should only keep 3 buckets when possible", ({ cube }) => {
    cube.BUCKET_COUNT_SOFT_LIMIT = 3;
    cube.getOrCreateBucket([0, 0, 0, 0, []]);
    cube.getOrCreateBucket([1, 1, 1, 0]);
    cube.getOrCreateBucket([2, 2, 2, 0]);
    cube.getOrCreateBucket([3, 3, 3, 0]);
    expect(cube.buckets.length).toBe(3);
  });

  it<TestContext>("Garbage Collection should not collect buckets with shouldCollect() == false", ({
    cube,
  }) => {
    cube.BUCKET_COUNT_SOFT_LIMIT = 3;
    const b1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(b1);
    b1.markAsPulled();
    cube.getOrCreateBucket([1, 1, 1, 0]);
    cube.getOrCreateBucket([2, 2, 2, 0]);
    cube.getOrCreateBucket([3, 3, 3, 0]);
    expect(b1.shouldCollect()).toBe(false);
    const addresses = cube.buckets.map((b: DataBucket) => b.zoomedAddress);
    expect(addresses).toEqual([
      [0, 0, 0, 0, []],
      [3, 3, 3, 0],
      [2, 2, 2, 0],
    ]);
  });

  it<TestContext>("Garbage Collection should grow beyond soft limit if necessary", ({ cube }) => {
    cube.BUCKET_COUNT_SOFT_LIMIT = 3;
    const b1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    const b2 = cube.getOrCreateBucket([1, 1, 1, 0]);
    const b3 = cube.getOrCreateBucket([2, 2, 2, 0]);
    // No bucket may be collected.
    [b1, b2, b3].map((b) => {
      assertNonNullBucket(b);
      b.markAsPulled();
    });
    // Allocate a 4th one which should still be possible (will exceed BUCKET_COUNT_SOFT_LIMIT)
    cube.getOrCreateBucket([3, 3, 3, 0]);
    const addresses = cube.buckets.map((b: DataBucket) => b.zoomedAddress);
    expect(addresses).toEqual([
      [0, 0, 0, 0, []],
      [1, 1, 1, 0],
      [2, 2, 2, 0],
      [3, 3, 3, 0],
    ]);
  });

  it<TestContext>("getVoxelIndexByVoxelOffset should return the correct index of a position within a bucket", ({
    cube,
  }) => {
    let index = cube.getVoxelIndexByVoxelOffset([0, 0, 0]);
    expect(index).toBe(0);
    index = cube.getVoxelIndexByVoxelOffset([10, 10, 10]);
    expect(index).toBe(10570);
  });
});
