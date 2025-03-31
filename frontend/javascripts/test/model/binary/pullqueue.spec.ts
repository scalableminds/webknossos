// @ts-nocheck
import _ from "lodash";
import runAsync from "test/helpers/run-async";
import { describe, it, expect, beforeEach, vi } from "vitest";
import PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import { requestWithFallback } from "oxalis/model/bucket_data_handling/wkstore_adapter";
// import "libs/request";
// import "oxalis/model"
import { DataBucket, BucketStateEnum } from "oxalis/model/bucket_data_handling/bucket";

vi.mock("oxalis/model/sagas/root_saga", function () {
  return function* () {
    yield;
  };
});

vi.mock("oxalis/model", function () {
  return {
    getLayerRenderingManagerByName: () => ({
      currentBucketPickerTick: 0,
    }),
  };
});

vi.mock("libs/request", function () {
  return {
    receiveJSON: vi.fn(),
    always: (promise, func) => promise.then(func, func),
  };
});

vi.mock("oxalis/model/bucket_data_handling/wkstore_adapter", function () {
  return {
    requestWithFallback: vi.fn(),
  };
});

const mockedCube = {
  isSegmentation: true,
  shouldEagerlyMaintainUsedValueSet: () => false,
  triggerBucketDataChanged: () => false,
};
const layer = {
  url: "url",
  name: "layername",
  category: "color",
  resolutions: [[1, 1, 1]],
};

vi.mock("oxalis/store", function () {
  return {
    default: {
      getState: () => ({
        dataset: {
          dataSource: {
            dataLayers: [layer],
          },
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

describe("PullQueue", () => {
  let buckets;
  let pullQueue;

  beforeEach(() => {
    const cube = {
      getBucket: vi.fn(),
      getOrCreateBucket: vi.fn(),
      boundingBox: {
        containsBucket: vi.fn().mockReturnValue(true),
        removeOutsideArea: vi.fn(),
      },
      shouldEagerlyMaintainUsedValueSet: () => false,
    };
    const connectionInfo = {
      log: vi.fn(),
    };
    const datastoreInfo = {
      typ: "webknossos-store",
    };
    pullQueue = new PullQueue(cube, layer.name, connectionInfo, datastoreInfo);
    buckets = [
      new DataBucket("uint8", [0, 0, 0, 0], null, mockedCube),
      new DataBucket("uint8", [1, 1, 1, 1], null, mockedCube),
    ];

    for (const bucket of buckets) {
      cube.getBucket.mockImplementation((address) => bucket);
      cube.getOrCreateBucket.mockImplementation((address) => bucket);
      pullQueue.add({
        bucket: bucket.zoomedAddress,
        priority: 0,
      });
    }
  });

  it("Successful pulling: should receive the correct data", () => {
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
    const mockRequestWithFallback = vi.mocked(requestWithFallback);
    mockRequestWithFallback
      .mockRejectedValueOnce(new Error("Expected promise rejection in tests. Can be ignored."))
      .mockResolvedValueOnce([new Uint8Array(32 * 32 * 32)]);
  }

  it("Request Failure: should not request twice if not bucket dirty", () => {
    prepare();
    pullQueue.pull();
    return runAsync([
      () => {
        expect(vi.mocked(requestWithFallback)).toHaveBeenCalledTimes(1);
        expect(buckets[0].state).toBe(BucketStateEnum.UNREQUESTED);
        expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
      },
    ]);
  });

  it("Request Failure: should reinsert dirty buckets", () => {
    prepare();
    buckets[0].dirty = true;
    buckets[0].data = new Uint8Array(32 * 32 * 32);
    pullQueue.pull();
    return runAsync([
      () => {
        expect(vi.mocked(requestWithFallback)).toHaveBeenCalledTimes(2);
        expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
        expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
      },
    ]);
  });
});
