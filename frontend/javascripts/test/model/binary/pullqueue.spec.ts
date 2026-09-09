import ErrorHandling from "libs/error_handling";
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

type AdditionalAxesMock = Record<string, { name: string; bounds: [number, number]; index: number }>;

// The mocked cube stores its buckets keyed on the address including the "t" coordinate's
// *value* but not its `length` — snapToTBatchAddress adds a `length` to the wire address
// only, so the primary's original address still has to resolve to the same bucket, while
// distinct timepoints must map to distinct buckets.
function bucketKey(address: BucketAddress): string {
  const t = address[4]?.find((coord) => coord.name === "t")?.value ?? 0;
  return `${address[0]},${address[1]},${address[2]},${address[3]},${t}`;
}

// A t-batched request addresses one bucket per timepoint, so tests need a cube mock that can
// *create* buckets on demand (the real DataCube.getOrCreateBucket does) rather than looking
// them up in a fixed list. Deliberately does not enforce additionalAxes bounds, so that the
// bounds filtering in getTBatchSiblingAddresses is what the bounds test actually pins.
function createMockedCubeAndQueue(
  options: {
    isTRecyclingEligible?: boolean;
    additionalAxes?: AdditionalAxesMock;
    effectiveBucketVoxelCount?: number;
  } = {},
) {
  const bucketsByKey = new Map<string, DataBucket>();
  const buckets: DataBucket[] = [];

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
    getEffectiveBucketVoxelCount: () => options.effectiveBucketVoxelCount ?? 32 ** 3,
    isTRecyclingEligible: options.isTRecyclingEligible ?? false,
    additionalAxes: options.additionalAxes ?? ({} as AdditionalAxesMock),
    // Will be set later:
    pullQueue: null as PullQueue | null,
  };
  const datastoreInfo = {
    typ: "webknossos-store",
  };
  const pullQueue = new PullQueue(mockedCube as any, "layername", datastoreInfo as any);
  mockedCube.pullQueue = pullQueue;

  const createBucket = (address: BucketAddress) => {
    const bucket = new DataBucket(
      "uint8",
      address,
      null as any,
      { type: "full" },
      mockedCube as any,
    );
    bucketsByKey.set(bucketKey(address), bucket);
    buckets.push(bucket);
    return bucket;
  };

  mockedCube.getBucket.mockImplementation((address: BucketAddress) =>
    bucketsByKey.get(bucketKey(address)),
  );
  mockedCube.getOrCreateBucket.mockImplementation(
    (address: BucketAddress) => bucketsByKey.get(bucketKey(address)) ?? createBucket(address),
  );

  return {
    pullQueue,
    buckets,
    createBucket,
    findBucket: (t: number) => bucketsByKey.get(bucketKey(tAddress(t))),
  };
}

// A z-degenerate layer with a t axis, i.e. one whose buckets are fetched in aligned
// 32-timepoint batches. One t-slice is 32*32 voxels, so a single 32^3 wire buffer holds
// exactly BUCKET_WIDTH of them.
const T_SLICE_VOXEL_COUNT = 32 * 32;
function createTRecyclingCubeAndQueue(tBounds: [number, number] = [0, 1000]) {
  return createMockedCubeAndQueue({
    isTRecyclingEligible: true,
    additionalAxes: { t: { name: "t", bounds: tBounds, index: 3 } },
    effectiveBucketVoxelCount: T_SLICE_VOXEL_COUNT,
  });
}

const tAddress = (t: number): BucketAddress => [0, 0, 0, 0, [{ name: "t", value: t }]];

describe("PullQueue", () => {
  beforeEach<TestContext>(async (context) => {
    // The default cube is *not* t-recycling-eligible, so these buckets exercise the plain,
    // non-batched path.
    const { pullQueue, buckets, createBucket } = createMockedCubeAndQueue();

    for (const address of [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
    ] as BucketAddress[]) {
      createBucket(address);
      pullQueue.add({
        bucket: address,
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

  describe("t-batched requests (see DataCube.isTRecyclingEligible)", () => {
    // Fills a whole-batch wire buffer so that each t-slice starts with a distinguishable
    // marker, which pins the (t % BUCKET_WIDTH) * effectiveVoxelCount offset each sibling
    // is handed.
    function makeBatchBuffer() {
      const buffer = new Uint8Array(32 ** 3);
      for (let t = 0; t < 32; t++) {
        buffer[t * T_SLICE_VOXEL_COUNT] = t + 1;
      }
      return buffer;
    }

    it("fans one response out to every t in the batch", async () => {
      const { pullQueue, buckets, findBucket } = createTRecyclingCubeAndQueue();
      const batchBuffer = makeBatchBuffer();
      vi.mocked(requestWithFallback)
        .mockReset()
        .mockResolvedValue([{ type: "data", data: batchBuffer }]);

      // Only the one bucket that is actually needed is requested.
      pullQueue.add({ bucket: tAddress(5), priority: 0 });
      pullQueue.pull();
      await sleep(0);

      // The wire request is widened to the aligned batch (see snapToTBatchAddress).
      expect(requestWithFallback).toHaveBeenCalledTimes(1);
      const wireBatch = vi.mocked(requestWithFallback).mock.calls[0][1];
      expect(wireBatch).toHaveLength(1);
      expect(wireBatch[0][4]).toEqual([{ name: "t", value: 0, length: 32 }]);

      // Every t in the batch received its own slice, not just the requested one.
      expect(buckets).toHaveLength(32);
      for (const t of [0, 5, 31]) {
        const bucket = findBucket(t);
        expect(bucket?.state).toBe(BucketStateEnum.LOADED);
        expect(bucket?.getData()[0]).toBe(t + 1);
      }
      // All siblings are views into the very same wire buffer (see DataBucket.rawBucketData).
      expect(findBucket(31)?.rawBucketData?.buffer).toBe(findBucket(0)?.rawBucketData?.buffer);
    });

    it("clips the fan-out to the t axis bounds", async () => {
      const { pullQueue, buckets, findBucket } = createTRecyclingCubeAndQueue([0, 10]);
      vi.mocked(requestWithFallback)
        .mockReset()
        .mockResolvedValue([{ type: "data", data: makeBatchBuffer() }]);

      pullQueue.add({ bucket: tAddress(5), priority: 0 });
      pullQueue.pull();
      await sleep(0);

      // t=10..31 are outside the axis, so no bucket is even created for them.
      expect(buckets).toHaveLength(10);
      expect(findBucket(9)?.state).toBe(BucketStateEnum.LOADED);
      expect(findBucket(10)).toBeUndefined();
    });

    it("rolls back a sibling it transitioned when handing over the data fails", async () => {
      const { pullQueue, buckets, findBucket } = createTRecyclingCubeAndQueue();
      // Too short for a bucket, so DataBucket.receiveData throws. Since the buffer is shared
      // across the batch, it fails for the very first sibling (t=0) — deliberately not the
      // requested bucket (t=5), so this isolates the sibling path from the pre-existing
      // failedBucketAddresses handling of the requested bucket.
      vi.mocked(requestWithFallback)
        .mockReset()
        .mockResolvedValue([{ type: "data", data: new Uint8Array(100) }]);
      vi.mocked(ErrorHandling.notify).mockClear();

      pullQueue.add({ bucket: tAddress(5), priority: 0 });
      pullQueue.pull();
      await sleep(0);

      // A bucket stuck in REQUESTED could never be requested again (pull() only admits
      // UNREQUESTED ones), could never be garbage collected, and would hang any
      // ensureLoaded awaiter forever.
      expect(buckets.filter((bucket) => bucket.state === BucketStateEnum.REQUESTED)).toEqual([]);
      expect(findBucket(0)?.state).toBe(BucketStateEnum.UNREQUESTED);
      expect(findBucket(0)?.mayBeGarbageCollected(true)).toBe(true);
      // The requested bucket is reset by pullBatch's own error handling.
      expect(findBucket(5)?.state).toBe(BucketStateEnum.UNREQUESTED);

      // The loop aborts on the first failure rather than repeating the same error (and its
      // notification) for all 32 siblings.
      expect(ErrorHandling.notify).toHaveBeenCalledTimes(1);
      expect(requestWithFallback).toHaveBeenCalledTimes(1);
    });

    it("resets the requested bucket exactly once when it is the one that fails", async () => {
      const { pullQueue, findBucket } = createTRecyclingCubeAndQueue();
      vi.mocked(requestWithFallback)
        .mockReset()
        .mockResolvedValue([{ type: "data", data: new Uint8Array(100) }]);
      const markAsFailedSpy = vi.spyOn(DataBucket.prototype, "markAsFailed");

      // t=0 is both the requested bucket and the first sibling iterated, so it was already
      // REQUESTED by pull() rather than by the fan-out.
      pullQueue.add({ bucket: tAddress(0), priority: 0 });
      pullQueue.pull();
      await sleep(0);

      const primary = findBucket(0);
      expect(primary?.state).toBe(BucketStateEnum.UNREQUESTED);
      // The fan-out must not also reset it: it does not own that transition, and a second
      // markAsFailed() from a non-REQUESTED state throws.
      expect(
        markAsFailedSpy.mock.instances.filter((instance) => instance === primary),
      ).toHaveLength(1);
      markAsFailedSpy.mockRestore();
    });

    it("leaves a sibling that a concurrent request owns untouched", async () => {
      const { pullQueue, findBucket, createBucket } = createTRecyclingCubeAndQueue();
      vi.mocked(requestWithFallback)
        .mockReset()
        .mockResolvedValue([{ type: "data", data: makeBatchBuffer() }]);

      // Simulate another batch already having this sibling in flight.
      const concurrentlyOwned = createBucket(tAddress(7));
      concurrentlyOwned.markAsRequested();

      const receiveData = DataBucket.prototype.receiveData;
      const receiveDataSpy = vi
        .spyOn(DataBucket.prototype, "receiveData")
        .mockImplementation(function (this: DataBucket, ...args) {
          if (this.getT() === 7) {
            throw new Error("Expected error in tests. Can be ignored.");
          }
          return receiveData.apply(this, args);
        });

      pullQueue.add({ bucket: tAddress(5), priority: 0 });
      pullQueue.pull();
      await sleep(0);

      // Siblings settled before the failure keep their data.
      expect(findBucket(0)?.state).toBe(BucketStateEnum.LOADED);
      expect(findBucket(6)?.state).toBe(BucketStateEnum.LOADED);
      // The requested bucket also settled already, so pullBatch's error handling skips it.
      expect(findBucket(5)?.state).toBe(BucketStateEnum.LOADED);
      // Resetting this one would strand the concurrent request: its own receiveData would
      // then hit an unexpected state.
      expect(concurrentlyOwned.state).toBe(BucketStateEnum.REQUESTED);
      // Siblings after the failure were never transitioned, so they stay requestable.
      expect(findBucket(8)).toBeUndefined();

      receiveDataSpy.mockRestore();
    });
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
