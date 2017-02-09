/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import _ from "lodash";
import mockRequire from "mock-require";
import sinon from "sinon";
import runAsync from "test/helpers/run-async";
import { DataBucket, BucketStateEnum } from "oxalis/model/binary/bucket";

mockRequire.stopAll();

const RequestMock = {
  always: (promise, func) => promise.then(func, func),
};
mockRequire("libs/request", RequestMock);

const PullQueue = require("oxalis/model/binary/pullqueue").default;

describe("PullQueue", () => {
  const layer = {
    url: "url",
    name: "layername",
    category: "color",
    requestFromStore: sinon.stub(),
  };
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

  let pullQueue;
  let buckets;

  beforeEach(() => {
    pullQueue = new PullQueue(cube, layer, connectionInfo, datastoreInfo);

    buckets = [
      new DataBucket(8, [0, 0, 0, 0], null),
      new DataBucket(8, [1, 1, 1, 1], null),
    ];

    for (const bucket of buckets) {
      pullQueue.add({ bucket: bucket.zoomedAddress, priority: 0 });
      cube.getBucket.withArgs(bucket.zoomedAddress).returns(bucket);
      cube.getOrCreateBucket.withArgs(bucket.zoomedAddress).returns(bucket);
    }
  });

  describe("Successful pulling", () => {
    const bucketData1 = _.range(0, 32 * 32 * 32).map(i => i % 256);
    const bucketData2 = _.range(0, 32 * 32 * 32).map(i => (2 * i) % 256);

    beforeEach(() => {
      const responseBuffer = new Uint8Array(bucketData1.concat(bucketData2));
      layer.requestFromStore = sinon.stub();
      layer.requestFromStore.returns(Promise.resolve(responseBuffer));
    });


    it("should receive the correct data", (done) => {
      pullQueue.pull();

      runAsync([
        () => {
          expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
          expect(buckets[1].state).toBe(BucketStateEnum.LOADED);
          expect(buckets[0].getData()).toEqual(new Uint8Array(bucketData1));
          expect(buckets[1].getData()).toEqual(new Uint8Array(bucketData2));
          done();
        },
      ]);
    });
  });

  describe("Request Failure", () => {
    beforeEach(() => {
      layer.requestFromStore = sinon.stub();
      layer.requestFromStore.onFirstCall().returns(Promise.reject());
      layer.requestFromStore.onSecondCall().returns(
        Promise.resolve(new Uint8Array(32 * 32 * 32)),
      );
    });


    it("should not request twice if not bucket dirty", (done) => {
      pullQueue.pull();

      runAsync([
        () => {
          expect(layer.requestFromStore.callCount).toBe(1);
          expect(buckets[0].state).toBe(BucketStateEnum.UNREQUESTED);
          expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
          done();
        },
      ]);
    });

    it("should reinsert dirty buckets", (done) => {
      buckets[0].dirty = true;
      buckets[0].data = new Uint8Array(32 * 32 * 32);
      pullQueue.pull();

      runAsync([
        () => {
          expect(layer.requestFromStore.callCount).toBe(2);
          expect(buckets[0].state).toBe(BucketStateEnum.LOADED);
          expect(buckets[1].state).toBe(BucketStateEnum.UNREQUESTED);
          done();
        },
      ]);
    });
  });
});
