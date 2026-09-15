import { sleep } from "libs/utils";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import type { Vector3, Vector4 } from "viewer/constants";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { assertNonNullBucket, type DataBucket } from "viewer/model/bucket_data_handling/bucket";
import DataCube from "viewer/model/bucket_data_handling/data_cube";
import { MagInfo } from "viewer/model/helpers/mag_info";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("viewer/store", () => ({
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

vi.mock("viewer/model/sagas/root_saga", () => ({
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
      mags: [
        [1, 1, 1],
        [2, 2, 2],
        [4, 4, 4],
        [8, 8, 8],
        [16, 16, 16],
        [32, 32, 32],
      ] as Vector3[],
    };
    const magInfo = new MagInfo(mockedLayer.mags);
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

      abortRequests() {
        // Mirrors the real pull queue: aborting an in-flight request does not synchronously
        // transition the affected bucket out of the REQUESTED state (that only happens later,
        // once the aborted fetch rejects).
      }

      async pull() {
        // If the pull happens synchronously, the bucketLoaded promise
        // in Bucket.ensureLoaded() is created too late. Therefore,
        // we put a small sleep in here (this mirrors the behavior when
        // actually downloading data).
        await sleep(10);

        for (const item of this.queue) {
          const bucket = cube.getBucket(item.bucket);

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

  it<TestContext>("ensureLoaded() should retry and load fresh data after a request failure", async ({
    cube,
  }) => {
    // A request can fail for several reasons (backend failure, network error, or the request
    // being aborted, e.g. because a concurrent reload called pullQueue.abortRequests()). In all
    // of these cases, the bucket falls back to UNREQUESTED (see markAsFailed). Since the caller
    // asked for the bucket to be loaded, ensureLoaded() must not settle for that empty bucket;
    // it has to retry the request (the default PullQueueMock, set up in beforeEach, always
    // succeeds) so that the caller ends up with real data instead of silently reading zeroes.
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(bucket);

    // Simulate the pull queue having requested the bucket...
    bucket.markAsRequested();
    const ensureLoadedPromise = bucket.ensureLoaded();

    // ...and the request failing (e.g. due to an aborted request during a reload).
    bucket.markAsFailed();
    await ensureLoadedPromise;

    expect(bucket.isLoaded()).toBe(true);
    expect(bucket.hasData()).toBe(true);
  });

  it<TestContext>("ensureLoaded() should throw once the retry limit is exceeded", async ({
    cube,
  }) => {
    // If the bucket's request keeps failing (e.g. a persistent backend or network error),
    // ensureLoaded() must not retry forever. It should give up after a bounded number of
    // retries and reject instead of hanging indefinitely.
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(bucket);

    let pullCount = 0;
    const alwaysFailingPullQueue = {
      add: () => {},
      pull: async () => {
        pullCount++;
        // Mirrors the real pull queue: the bucketRequestFailed listeners in ensureLoaded()
        // must already be registered by the time the event fires (see the default
        // PullQueueMock above for the same reasoning).
        await sleep(0);
        if (bucket.needsRequest()) {
          bucket.markAsRequested();
        }
        if (bucket.isRequested()) {
          bucket.markAsFailed();
        }
      },
      abortRequests: () => {},
      clear: () => {},
      destroy: () => {},
    };
    cube.initializeWithQueues(
      alwaysFailingPullQueue as any,
      { insert: vi.fn(), push: vi.fn() } as any,
    );

    // Passing an explicit, small maxRetries (instead of relying on the default) pins down
    // the exact retry boundary and verifies that maxRetries is threaded through the
    // recursive calls: one initial attempt plus exactly one retry, then ensureLoaded()
    // must give up.
    await expect(bucket.ensureLoaded(1)).rejects.toThrow();
    expect(pullCount).toBe(2);
    expect(bucket.hasData()).toBe(false);
  });

  it<TestContext>("Voxel Labeling should request buckets when temporal buckets are created", async ({
    cube,
    pullQueue,
  }) => {
    cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 42, 0, null);

    await sleep(100);
    expect(pullQueue.processedQueue[0]).toEqual({
      bucket: [0, 0, 0, 0, []],
      priority: -1,
    });
  });

  it<TestContext>("Voxel Labeling should push buckets after they were pulled", async ({
    cube,
    pushQueue,
  }) => {
    await cube._labelVoxelInResolution_DEPRECATED([1, 1, 1], null, 42, 0, null);
    const bucket = cube.getBucket([0, 0, 0, 0, []]);

    expect(pushQueue.insert).toHaveBeenCalledWith(bucket);
  });

  it<TestContext>("Voxel Labeling should push buckets immediately if they are pulled already", async ({
    cube,
    pushQueue,
  }) => {
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(bucket);
    bucket.markAsRequested();
    bucket.receiveData(new Uint8Array(4 * 32 ** 3));
    await cube._labelVoxelInResolution_DEPRECATED([0, 0, 0], null, 42, 0, null);

    expect(pushQueue.insert).toHaveBeenCalledWith(bucket);
  });

  it<TestContext>("Voxel Labeling should only instantiate one bucket when labeling the same bucket twice", async ({
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

  it<TestContext>("Garbage Collection should not collect buckets with mayBeGarbageCollected() == false", ({
    cube,
  }) => {
    cube.BUCKET_COUNT_SOFT_LIMIT = 3;
    const b1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(b1);
    b1.markAsRequested();
    cube.getOrCreateBucket([1, 1, 1, 0]);
    cube.getOrCreateBucket([2, 2, 2, 0]);
    cube.getOrCreateBucket([3, 3, 3, 0]);

    expect(b1.mayBeGarbageCollected(true)).toBe(false);
    const addresses = cube.buckets.map((b: DataBucket) => b.zoomedAddress);
    expect(addresses).toEqual([
      [0, 0, 0, 0, []],
      [3, 3, 3, 0],
      [2, 2, 2, 0],
    ]);
  });

  it<TestContext>("removeAllBuckets() should keep a bucket whose request is still in flight", ({
    cube,
  }) => {
    // A reload aborts in-flight pull-queue requests, but abortion only settles asynchronously
    // once the aborted fetch actually rejects. removeAllBuckets() must therefore keep such a
    // bucket around (mayBeGarbageCollected() returns false while REQUESTED) instead of
    // destroying it outright, since a fresh bucket could otherwise be created at the same
    // address while the old request is still in flight.
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    assertNonNullBucket(bucket);
    bucket.markAsRequested();

    expect(bucket.mayBeGarbageCollected(false)).toBe(false);

    cube.removeAllBuckets();

    expect(cube.buckets.length).toBe(1);
    expect(cube.getBucket([0, 0, 0, 0, []])).toBe(bucket);
    expect(bucket.isRequested()).toBe(true);
  });

  it<TestContext>("getLoadedBucket() should retry and return fresh data after a concurrent reload aborts the pending request", async ({
    cube,
  }) => {
    // Reproduces the original race condition: a read is awaiting a bucket that is still
    // REQUESTED when a reload happens. The reload aborts the in-flight request (but keeps the
    // bucket itself, see the test above), so once the aborted request rejects, the very same
    // bucket is marked as failed. ensureLoaded() (used internally by getLoadedBucket()) must not
    // settle for that empty bucket; it has to retry loading it so that the caller ends up with
    // the freshly reloaded data instead of silently reading zeroes.
    const address: Vector4 = [0, 0, 0, 0];
    let requestCount = 0;

    const controllablePullQueue = {
      add: () => {},
      pull: async () => {
        requestCount++;
        const bucket = cube.getBucket(address);
        if (bucket.type !== "data" || !bucket.needsRequest()) {
          return;
        }
        bucket.markAsRequested();
        // Mirrors the real pull queue: the request resolves asynchronously.
        await sleep(0);

        if (requestCount === 1) {
          // Simulate a concurrent reload aborting this (the first) request.
          bucket.markAsFailed();
        } else {
          bucket.receiveData(new Uint8Array(4 * 32 ** 3));
        }
      },
      abortRequests: () => {},
      clear: () => {},
      destroy: () => {},
    };
    cube.initializeWithQueues(
      controllablePullQueue as any,
      { insert: vi.fn(), push: vi.fn() } as any,
    );

    const bucket = await cube.getLoadedBucket(address);
    assertNonNullBucket(bucket);
    // The same bucket object is retried and ends up loaded (there is no need to reload a
    // fresh bucket at that address, since it was never destroyed by the reload).
    expect(bucket).toBe(cube.getBucket(address));
    expect(bucket.hasData()).toBe(true);
    expect(requestCount).toBe(2);
  });

  it<TestContext>("Garbage Collection should grow beyond soft limit if necessary", ({ cube }) => {
    cube.BUCKET_COUNT_SOFT_LIMIT = 3;
    const b1 = cube.getOrCreateBucket([0, 0, 0, 0, []]);
    const b2 = cube.getOrCreateBucket([1, 1, 1, 0]);
    const b3 = cube.getOrCreateBucket([2, 2, 2, 0]);
    // No bucket may be collected.
    [b1, b2, b3].forEach((b) => {
      assertNonNullBucket(b);
      b.markAsRequested();
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

// This is not executed in the tests, but can be activated when needed
// to make performance measurements for getOrCreateBucket
describe.skip("DataCube Benchmark", () => {
  it("Benchmark", () => {
    const mockedLayer = {
      mags: [[1, 1, 1]] as Vector3[],
    };
    const magInfo = new MagInfo(mockedLayer.mags);
    const cube = new DataCube(
      new BoundingBox({ min: [1024, 1024, 1024], max: [2048, 2048, 2048] }),
      [],
      magInfo,
      "uint32",
      false,
      "layerName",
    );

    console.time("outside");
    for (let i = 0; i < 15; i++) {
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          for (let z = 0; z < 32; z++) {
            cube.getOrCreateBucket([x, y, z, 0]);
          }
        }
      }
    }
    console.timeEnd("outside");

    console.time("inside");
    for (let i = 0; i < 15; i++) {
      for (let x = 32; x < 64; x++) {
        for (let y = 32; y < 64; y++) {
          for (let z = 32; z < 64; z++) {
            cube.getOrCreateBucket([x, y, z, 0]);
          }
        }
      }
    }
    console.timeEnd("inside");
  });
});
