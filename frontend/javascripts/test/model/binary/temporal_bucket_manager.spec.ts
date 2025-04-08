import { describe, it, expect, beforeEach, vi } from "vitest";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import runAsync from "test/helpers/run-async";

// Mock dependencies
vi.mock("oxalis/model/sagas/root_saga", () => {
  return {
    default: function* () {
      yield;
    },
  };
});

// Mock libs/request
vi.mock("libs/request");

interface TestContext {
  cube: any;
  manager: TemporalBucketManager;
}

describe("TemporalBucketManager", () => {
  beforeEach<TestContext>(async (context) => {
    const pullQueue = {
      add: vi.fn(),
      pull: vi.fn(),
    };
    const pushQueue = {
      insert: vi.fn(),
      push: vi.fn(),
    };
    const mockedCube = {
      isSegmentation: true,
      pushQueue,
      pullQueue,
      triggerBucketDataChanged: vi.fn(),
    };

    const manager = new TemporalBucketManager(pullQueue as any, pushQueue as any);

    context.cube = mockedCube;
    context.manager = manager;
  });

  // Helper function to fake labeling
  function fakeLabel(bucket: any) {
    // To simulate some labeling on the bucket's data,
    // we simply use the start and end mutation methods
    // without any action in between.
    bucket.startDataMutation();
    bucket.endDataMutation();
  }

  it<TestContext>("should be added when bucket has not been requested", ({ manager, cube }) => {
    const bucket = new DataBucket("uint8", [0, 0, 0, 0], manager, cube);

    fakeLabel(bucket);
    expect(manager.getCount()).toBe(1);
  });

  it<TestContext>("should be added when bucket has not been received", ({ manager, cube }) => {
    const bucket = new DataBucket("uint8", [0, 0, 0, 0], manager, cube);

    bucket.markAsRequested();
    expect(bucket.needsRequest()).toBe(false);

    fakeLabel(bucket);
    expect(manager.getCount()).toBe(1);
  });

  it<TestContext>("should not be added when bucket has been received", ({ manager, cube }) => {
    const bucket = new DataBucket("uint8", [0, 0, 0, 0], manager, cube);
    bucket.markAsRequested();
    bucket.receiveData(new Uint8Array(1 << 15));

    expect(bucket.isLoaded()).toBe(true);

    fakeLabel(bucket);
    expect(manager.getCount()).toBe(0);
  });

  it<TestContext>("should be removed once it is loaded", ({ manager, cube }) => {
    const bucket = new DataBucket("uint8", [0, 0, 0, 0], manager, cube);
    fakeLabel(bucket);

    bucket.markAsRequested();
    bucket.receiveData(new Uint8Array(1 << 15));

    expect(manager.getCount()).toBe(0);
  });

  // Helper function to prepare buckets
  function prepareBuckets(manager: TemporalBucketManager, cube: any) {
    // Insert two buckets into manager
    const bucket1 = new DataBucket("uint8", [0, 0, 0, 0], manager, cube);
    const bucket2 = new DataBucket("uint8", [1, 0, 0, 0], manager, cube);

    for (const bucket of [bucket1, bucket2]) {
      bucket.startDataMutation();
      bucket.endDataMutation();
      bucket.markAsRequested();
    }

    return {
      bucket1,
      bucket2,
    };
  }

  it<TestContext>("Make Loaded Promise should be initially unresolved", async ({
    manager,
    cube,
  }) => {
    prepareBuckets(manager, cube);
    let resolved = false;
    manager.getAllLoadedPromise().then(() => {
      resolved = true;
    });

    return runAsync([
      () => {
        expect(resolved).toBe(false);
      },
    ]);
  });

  it<TestContext>("Make Loaded Promise should be unresolved when only one bucket is loaded", async ({
    manager,
    cube,
  }) => {
    const { bucket1 } = prepareBuckets(manager, cube);
    let resolved = false;
    manager.getAllLoadedPromise().then(() => {
      resolved = true;
    });
    bucket1.receiveData(new Uint8Array(1 << 15));

    return runAsync([
      () => {
        expect(resolved).toBe(false);
      },
    ]);
  });

  it<TestContext>("Make Loaded Promise should be resolved when both buckets are loaded", async ({
    manager,
    cube,
  }) => {
    const { bucket1, bucket2 } = prepareBuckets(manager, cube);
    let resolved = false;
    manager.getAllLoadedPromise().then(() => {
      resolved = true;
    });
    bucket1.receiveData(new Uint8Array(1 << 15));
    bucket2.receiveData(new Uint8Array(1 << 15));

    return runAsync([
      () => {
        expect(resolved).toBe(true);
      },
    ]);
  });
});
