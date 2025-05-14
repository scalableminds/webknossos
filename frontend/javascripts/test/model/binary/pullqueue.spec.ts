import _ from "lodash";
import runAsync from "test/helpers/run-async";
import { describe, it, expect, beforeEach, vi } from "vitest";
import PullQueue from "viewer/model/bucket_data_handling/pullqueue";
import { requestWithFallback } from "viewer/model/bucket_data_handling/wkstore_adapter";
import "viewer/model";
import { DataBucket, BucketStateEnum } from "viewer/model/bucket_data_handling/bucket";
import type { BucketAddress } from "viewer/constants";

vi.mock("viewer/model/sagas/root_saga", function () {
  return function* () {
    yield;
  };
});

vi.mock("viewer/model", function () {
  return {
    reset: vi.fn(),
    getLayerRenderingManagerByName: () => ({
      currentBucketPickerTick: 0,
    }),
  };
});

vi.mock("viewer/model/bucket_data_handling/wkstore_adapter", function () {
  return {
    requestWithFallback: vi.fn(),
  };
});

vi.mock("viewer/store", function () {
  return {
    default: {
      getState: () => ({
        dataset: {
          dataSource: {
            dataLayers: [
              {
                url: "url",
                name: "layername",
                category: "color",
                resolutions: [[1, 1, 1]],
              },
            ],
          },
        },
        tracing: {
          volumes: [{ tracingId: "volumeTracingId" }],
        },
        datasetConfiguration: {
          renderMissingDataBlack: true,
        },
      }),
      dispatch: vi.fn(),
      subscribe: vi.fn(),
    },
  };
});

interface TestContext {
  pullQueue: PullQueue;
  buckets: DataBucket[];
}

describe("PullQueue", () => {
  beforeEach<TestContext>(async (context) => {
    const mockedCube = {
      isSegmentation: true,
      triggerBucketDataChanged: () => {},
      getBucket: vi.fn(),
      getOrCreateBucket: vi.fn(),
      boundingBox: {
        containsBucket: vi.fn().mockReturnValue(true),
        removeOutsideArea: vi.fn(),
      },
      shouldEagerlyMaintainUsedValueSet: () => false,
      // Will be set later:
      pullQueue: null as PullQueue | null,
    };
    const datastoreInfo = {
      typ: "webknossos-store",
    };
    const pullQueue = new PullQueue(mockedCube as any, "layername", datastoreInfo as any);
    mockedCube.pullQueue = pullQueue;
    const buckets = [
      new DataBucket("uint8", [0, 0, 0, 0], null as any, { type: "full" }, mockedCube as any),
      new DataBucket("uint8", [1, 1, 1, 1], null as any, { type: "full" }, mockedCube as any),
    ];

    mockedCube.getBucket.mockImplementation((address: BucketAddress) => {
      return buckets.find((bucket) => _.isEqual(bucket.zoomedAddress, address));
    });
    mockedCube.getOrCreateBucket.mockImplementation((address: BucketAddress) => {
      return buckets.find((bucket) => _.isEqual(bucket.zoomedAddress, address));
    });

    for (const bucket of buckets) {
      pullQueue.add({
        bucket: bucket.zoomedAddress,
        priority: 0,
      });
    }

    context.pullQueue = pullQueue;
    context.buckets = buckets;
  });

  it<TestContext>("Successful pulling: should receive the correct data", ({
    pullQueue,
    buckets,
  }) => {
    const bucketData1 = _.range(0, 32 * 32 * 32).map((i) => i % 256);
    const bucketData2 = _.range(0, 32 * 32 * 32).map((i) => (2 * i) % 256);

    vi.mocked(requestWithFallback).mockResolvedValue([
      new Uint8Array(bucketData1),
      new Uint8Array(bucketData2),
    ]);
    pullQueue.pull();
    return runAsync([
      () => {
        expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
        expect(buckets[1].state).toBe(BucketStateEnum.LOADED);
        expect(buckets[0].getData()).toEqual(new Uint8Array(bucketData1));
        expect(buckets[1].getData()).toEqual(new Uint8Array(bucketData2));
      },
    ]);
  });

  function prepare() {
    vi.mocked(requestWithFallback)
      .mockReset()
      .mockRejectedValueOnce(new Error("Expected promise rejection in tests. Can be ignored."))
      .mockResolvedValueOnce([new Uint8Array(32 ** 3)]);
  }

  it<TestContext>("Request Failure: should not request twice if not bucket dirty", async ({
    pullQueue,
    buckets,
  }) => {
    prepare();
    pullQueue.pull();

    return runAsync([
      async () => {
        expect(requestWithFallback).toHaveBeenCalledTimes(1);
        expect(buckets[0].state).toBe(BucketStateEnum.UNREQUESTED);
        expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
      },
    ]);
  });

  it<TestContext>("Request Failure: should reinsert dirty buckets", ({ pullQueue, buckets }) => {
    prepare();
    buckets[0].dirty = true;
    buckets[0].data = new Uint8Array(32 * 32 * 32);
    pullQueue.pull();

    return runAsync([
      async () => {
        expect(requestWithFallback).toHaveBeenCalledTimes(2);
        expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
        expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
      },
    ]);
  });
});
