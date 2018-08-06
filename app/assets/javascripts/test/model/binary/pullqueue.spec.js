/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";
import runAsync from "test/helpers/run-async";

const RequestMock = {
  always: (promise, func) => promise.then(func, func),
};
mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});
mockRequire("libs/request", RequestMock);
const WkstoreAdapterMock = { requestFromStore: sinon.stub() };
mockRequire("oxalis/model/bucket_data_handling/wkstore_adapter", WkstoreAdapterMock);

const layer = {
  url: "url",
  name: "layername",
  category: "color",
  resolutions: [[1, 1, 1]],
};

const StoreMock = {
  getState: () => ({
    dataset: {
      dataSource: { dataLayers: [layer] },
    },
  }),
  dispatch: sinon.stub(),
  subscribe: sinon.stub(),
};

mockRequire("oxalis/store", StoreMock);

// Avoid node caching and make sure all mockRequires are applied
const PullQueue = mockRequire.reRequire("oxalis/model/bucket_data_handling/pullqueue").default;
const { DataBucket, BucketStateEnum } = mockRequire.reRequire(
  "oxalis/model/bucket_data_handling/bucket",
);

test.beforeEach(t => {
  const cube = {
    BUCKET_LENGTH: 32 * 32 * 32,
    getBucket: sinon.stub(),
    getOrCreateBucket: sinon.stub(),
    boundingBox: {
      containsBucket: sinon.stub().returns(true),
      removeOutsideArea: sinon.stub(),
    },
  };
  const connectionInfo = {
    log: sinon.stub(),
  };
  const datastoreInfo = {
    typ: "webknossos-store",
  };

  const pullQueue = new PullQueue(cube, layer.name, connectionInfo, datastoreInfo);

  const buckets = [new DataBucket(8, [0, 0, 0, 0], null), new DataBucket(8, [1, 1, 1, 1], null)];

  for (const bucket of buckets) {
    pullQueue.add({ bucket: bucket.zoomedAddress, priority: 0 });
    cube.getBucket.withArgs(bucket.zoomedAddress).returns(bucket);
    cube.getOrCreateBucket.withArgs(bucket.zoomedAddress).returns(bucket);
  }

  t.context = { buckets, pullQueue };
});

test.serial("Successful pulling: should receive the correct data", t => {
  const { pullQueue, buckets } = t.context;
  const bucketData1 = _.range(0, 32 * 32 * 32).map(i => i % 256);
  const bucketData2 = _.range(0, 32 * 32 * 32).map(i => (2 * i) % 256);
  const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));
  WkstoreAdapterMock.requestFromStore = sinon.stub();
  WkstoreAdapterMock.requestFromStore.returns(Promise.resolve(responseBuffer));

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
  WkstoreAdapterMock.requestFromStore = sinon.stub();
  WkstoreAdapterMock.requestFromStore.onFirstCall().returns(Promise.reject());
  WkstoreAdapterMock.requestFromStore
    .onSecondCall()
    .returns(Promise.resolve(new Uint8Array(32 * 32 * 32)));
}

test.serial("Request Failure: should not request twice if not bucket dirty", t => {
  const { pullQueue, buckets } = t.context;
  prepare();
  pullQueue.pull();

  return runAsync([
    () => {
      t.is(WkstoreAdapterMock.requestFromStore.callCount, 1);
      t.is(buckets[0].state, BucketStateEnum.UNREQUESTED);
      t.is(buckets[1].state, BucketStateEnum.UNREQUESTED);
    },
  ]);
});

test.serial("Request Failure: should reinsert dirty buckets", t => {
  const { pullQueue, buckets } = t.context;
  prepare();
  buckets[0].dirty = true;
  buckets[0].data = new Uint8Array(32 * 32 * 32);
  pullQueue.pull();

  return runAsync([
    () => {
      t.is(WkstoreAdapterMock.requestFromStore.callCount, 2);
      t.is(buckets[0].state, BucketStateEnum.LOADED);
      t.is(buckets[1].state, BucketStateEnum.UNREQUESTED);
    },
  ]);
});
