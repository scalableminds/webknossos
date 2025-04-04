import _ from "lodash";
import mockRequire from "mock-require";
import "test/mocks/lz4";
import runAsync from "test/helpers/run-async";
import sinon from "sinon";
import anyTest, { type TestFn } from "ava";
import type PullQueueType from "oxalis/model/bucket_data_handling/pullqueue";

const RequestMock = {
  always: (promise: Promise<unknown>, func: () => void) => promise.then(func, func),
};
mockRequire("oxalis/model/sagas/root_saga", function* () {
  yield;
});
mockRequire("oxalis/model", {
  getLayerRenderingManagerByName: () => ({
    currentBucketPickerTick: 0,
  }),
});
mockRequire("libs/request", RequestMock);
const WkstoreAdapterMock = {
  requestWithFallback: sinon.stub(),
};
mockRequire("oxalis/model/bucket_data_handling/wkstore_adapter", WkstoreAdapterMock);

const mockedCubeTemplate = {
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
const tracingId = "volumeTracingId";
const StoreMock = {
  getState: () => ({
    dataset: {
      dataSource: {
        dataLayers: [layer],
      },
    },
    tracing: {
      volumes: [{ tracingId }],
    },
    datasetConfiguration: {
      renderMissingDataBlack: true,
    },
  }),
  dispatch: sinon.stub(),
  subscribe: sinon.stub(),
};
mockRequire("oxalis/store", StoreMock);
// Avoid node caching and make sure all mockRequires are applied
const PullQueue: typeof PullQueueType = mockRequire.reRequire(
  "oxalis/model/bucket_data_handling/pullqueue",
).default;
const { DataBucket, BucketStateEnum } = mockRequire.reRequire(
  "oxalis/model/bucket_data_handling/bucket",
);

// Ava's recommendation for Typescript types
// https://github.com/avajs/ava/blob/main/docs/recipes/typescript.md#typing-tcontext
const test = anyTest as TestFn<{
  buckets: Array<typeof DataBucket>;
  pullQueue: Record<string, any>;
}>;

test.beforeEach((t) => {
  const cube = {
    getBucket: sinon.stub(),
    getOrCreateBucket: sinon.stub(),
    boundingBox: {
      containsBucket: sinon.stub().returns(true),
      removeOutsideArea: sinon.stub(),
    },
    shouldEagerlyMaintainUsedValueSet: () => false,
  };
  const datastoreInfo = {
    typ: "webknossos-store",
  };
  const pullQueue = new PullQueue(cube as any, layer.name, datastoreInfo as any);
  const mockedCube = {
    ...mockedCubeTemplate,
    pullQueue,
  };
  const buckets = [
    new DataBucket("uint8", [0, 0, 0, 0], null, mockedCube),
    new DataBucket("uint8", [1, 1, 1, 1], null, mockedCube),
  ];

  for (const bucket of buckets) {
    cube.getBucket.withArgs(bucket.zoomedAddress).returns(bucket);
    cube.getOrCreateBucket.withArgs(bucket.zoomedAddress).returns(bucket);
    pullQueue.add({
      bucket: bucket.zoomedAddress,
      priority: 0,
    });
  }

  t.context = {
    buckets,
    pullQueue,
  };
});
test.serial("Successful pulling: should receive the correct data", (t) => {
  const { pullQueue, buckets } = t.context;

  const bucketData1 = _.range(0, 32 * 32 * 32).map((i) => i % 256);

  const bucketData2 = _.range(0, 32 * 32 * 32).map((i) => (2 * i) % 256);

  WkstoreAdapterMock.requestWithFallback = sinon.stub();
  WkstoreAdapterMock.requestWithFallback.returns(
    Promise.resolve([new Uint8Array(bucketData1), new Uint8Array(bucketData2)]),
  );
  pullQueue.pull();
  return runAsync([
    () => {
      t.is(buckets[0].state, BucketStateEnum.LOADED);
      t.is(buckets[1].state, BucketStateEnum.LOADED);
      t.deepEqual(buckets[0].getData(), new Uint8Array(bucketData1));
      t.deepEqual(buckets[1].getData(), new Uint8Array(bucketData2));
    },
  ]);
});

function prepare() {
  WkstoreAdapterMock.requestWithFallback = sinon.stub();
  WkstoreAdapterMock.requestWithFallback
    .onFirstCall()
    .returns(Promise.reject(new Error("Expected promise rejection in tests. Can be ignored.")));
  WkstoreAdapterMock.requestWithFallback
    .onSecondCall()
    .returns(Promise.resolve([new Uint8Array(32 * 32 * 32)]));
}

test.serial("Request Failure: should not request twice if not bucket dirty", (t) => {
  const { pullQueue, buckets } = t.context;
  prepare();
  pullQueue.pull();
  return runAsync([
    () => {
      t.is(WkstoreAdapterMock.requestWithFallback.callCount, 1);
      t.is(buckets[0].state, BucketStateEnum.UNREQUESTED);
      t.is(buckets[1].state, BucketStateEnum.UNREQUESTED);
    },
  ]);
});
test.serial("Request Failure: should reinsert dirty buckets", (t) => {
  const { pullQueue, buckets } = t.context;
  prepare();
  buckets[0].dirty = true;
  buckets[0].data = new Uint8Array(32 * 32 * 32);
  pullQueue.pull();
  return runAsync([
    () => {
      t.is(WkstoreAdapterMock.requestWithFallback.callCount, 2);
      t.is(buckets[0].state, BucketStateEnum.LOADED);
      t.is(buckets[1].state, BucketStateEnum.UNREQUESTED);
    },
  ]);
});
