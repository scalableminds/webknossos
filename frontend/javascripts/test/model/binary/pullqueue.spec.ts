import isEqual from "lodash-es/isEqual";
import range from "lodash-es/range";
import PullQueue from "viewer/model/bucket_data_handling/pullqueue";
import { requestWithFallback } from "viewer/model/bucket_data_handling/wkstore_adapter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "viewer/model";
import { sleep } from "libs/utils";
import type { BucketAddress } from "viewer/constants";
import { BucketStateEnum, DataBucket } from "viewer/model/bucket_data_handling/bucket";

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
                mags: [{ mag: [1, 1, 1] }],
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
      triggerRenderedBucketDataChanged: () => {},
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
      return buckets.find((bucket) => isEqual(bucket.zoomedAddress, address));
    });
    mockedCube.getOrCreateBucket.mockImplementation((address: BucketAddress) => {
      return buckets.find((bucket) => isEqual(bucket.zoomedAddress, address));
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

  it<TestContext>("Successful pulling: should receive the correct data", async ({
    pullQueue,
    buckets,
  }) => {
    const bucketData1 = range(0, 32 * 32 * 32).map((i) => i % 256);
    const bucketData2 = range(0, 32 * 32 * 32).map((i) => (2 * i) % 256);

    vi.mocked(requestWithFallback).mockResolvedValue([
      { type: "data", data: new Uint8Array(bucketData1) },
      { type: "data", data: new Uint8Array(bucketData2) },
    ]);
    pullQueue.pull();

    await sleep(0); // sleep a bit so that the event loop can process the fetches

    expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
    expect(buckets[1].state).toBe(BucketStateEnum.LOADED);
    expect(buckets[0].getData()).toEqual(new Uint8Array(bucketData1));
    expect(buckets[1].getData()).toEqual(new Uint8Array(bucketData2));
  });

  function prepare() {
    vi.mocked(requestWithFallback)
      .mockReset()
      .mockRejectedValueOnce(new Error("Expected promise rejection in tests. Can be ignored."))
      .mockResolvedValueOnce([{ type: "data", data: new Uint8Array(32 ** 3) }]);
  }

  it<TestContext>("Request Failure: should not request twice if not bucket dirty", async ({
    pullQueue,
    buckets,
  }) => {
    prepare();
    pullQueue.pull();

    await sleep(0); // sleep a bit so that the event loop can process the fetches

    expect(requestWithFallback).toHaveBeenCalledTimes(1);
    expect(buckets[0].state).toBe(BucketStateEnum.UNREQUESTED);
    expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
  });

  it<TestContext>("Request Failure: should reinsert dirty buckets", async ({
    pullQueue,
    buckets,
  }) => {
    prepare();
    buckets[0].dirty = true;
    buckets[0].data = new Uint8Array(32 * 32 * 32);
    pullQueue.pull();

    await sleep(50); // sleep a bit so that the event loop can process the fetches

    expect(requestWithFallback).toHaveBeenCalledTimes(2);
    expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
    expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
  });

  it<TestContext>("Discarded bucket: data of an in-flight request must be dropped", async ({
    pullQueue,
    buckets,
  }) => {
    // Reproduces the reload race: a request is in flight when a reload discards the affected
    // buckets (via DataCube.removeBucket). By the time the result arrives, it is outdated and
    // must not be written into the discarded bucket (a fresh bucket now owns that address).
    vi.mocked(requestWithFallback)
      .mockReset()
      .mockResolvedValue([
        { type: "data", data: new Uint8Array(32 ** 3) },
        { type: "data", data: new Uint8Array(32 ** 3) },
      ]);
    pullQueue.pull();
    expect(buckets[0].state).toBe(BucketStateEnum.REQUESTED);

    buckets[0].markAsDiscarded();

    await sleep(0); // sleep a bit so that the event loop can process the fetches

    expect(buckets[0].state).toBe(BucketStateEnum.DISCARDED);
    expect(buckets[0].hasData()).toBe(false);
    // The other bucket of the same batch is unaffected.
    expect(buckets[1].state).toBe(BucketStateEnum.LOADED);
  });

  it<TestContext>("Discarded bucket: failure of an in-flight request must not re-request it", async ({
    pullQueue,
    buckets,
  }) => {
    // A reload aborts in-flight requests, so the rejection below is the common case. The
    // discarded bucket must stay discarded instead of being reset to UNREQUESTED (which
    // would mark a detached bucket as requestable again).
    vi.mocked(requestWithFallback)
      .mockReset()
      .mockRejectedValue(new Error("Expected promise rejection in tests. Can be ignored."));
    pullQueue.pull();
    expect(buckets[0].state).toBe(BucketStateEnum.REQUESTED);

    buckets[0].markAsDiscarded();

    await sleep(0); // sleep a bit so that the event loop can process the fetches

    expect(buckets[0].state).toBe(BucketStateEnum.DISCARDED);
    // The other bucket of the same batch is failed (i.e. reset to UNREQUESTED) as usual.
    expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
  });

  it<TestContext>("Partial failure: failure results are retried, empty results are not", async ({
    pullQueue,
    buckets,
  }) => {
    // A single response can now contain successfully read data, genuinely empty buckets
    // and buckets that failed to be read. Failures must be retried (reset to UNREQUESTED),
    // while empty buckets are terminal (here rendered black because renderMissingDataBlack
    // is enabled in the mocked store, leading to LOADED).
    vi.mocked(requestWithFallback)
      .mockReset()
      .mockResolvedValueOnce([{ type: "failure" }, { type: "empty" }]);
    pullQueue.pull();

    await sleep(0); // sleep a bit so that the event loop can process the fetches

    expect(buckets[0].state).toBe(BucketStateEnum.UNREQUESTED);
    expect(buckets[1].state).toBe(BucketStateEnum.LOADED);
  });
});
