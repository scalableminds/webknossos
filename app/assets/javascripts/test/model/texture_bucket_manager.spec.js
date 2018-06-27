// @flow

/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import mock from "mock-require";

global.performance = {
  now: () => Date.now(),
};
mock("libs/window", { requestAnimationFrame: () => {} });
mock(
  "libs/UpdatableTexture",
  class UpdatableTexture {
    texture: Uint8Array;
    width: number;
    height: number;

    update(src, x, y, _width, _height) {
      this.texture.set(src, y * this.width + x);
    }
    setRenderer() {}
    setSize(width, height) {
      this.texture = new Uint8Array(width * height);
      this.width = width;
      this.height = height;
    }
  },
);

const temporalBucketManagerMock = {
  addBucket: () => {},
};

const { default: TextureBucketManager } = mock.reRequire(
  "oxalis/model/bucket_data_handling/texture_bucket_manager",
);
const { DataBucket } = mock.reRequire("oxalis/model/bucket_data_handling/bucket");

const buildBucket = (zoomedAddress, firstByte) => {
  const bucket = new DataBucket(8, zoomedAddress, temporalBucketManagerMock);
  bucket.pull();
  const data = new Uint8Array(32 ** 3);
  data[0] = firstByte;
  bucket.receiveData(data);
  return bucket;
};

const setActiveBucketsAndWait = (tbm, activeBuckets, anchorPoint, fallbackAnchorPoint) => {
  tbm.setActiveBuckets(activeBuckets, anchorPoint, fallbackAnchorPoint);
  // Depending on timing, processWriterQueue has to be called n times in the slowest case
  activeBuckets.forEach(() => tbm.processWriterQueue());
  tbm._refreshLookUpBuffer();
};

const expectBucket = (t, tbm, bucket, expectedFirstByte) => {
  const bucketIdx = tbm._getBucketIndex(bucket);
  const bucketLocation = tbm.getPackedBucketSize() * tbm.lookUpBuffer[bucketIdx];
  t.is(tbm.dataTextures[0].texture[bucketLocation], expectedFirstByte);
};

test("TextureBucketManager: basic functionality", t => {
  const tbm = new TextureBucketManager(5, 2048, 1, 1);

  tbm.setupDataTextures(1);
  const activeBuckets = [
    buildBucket([1, 1, 1, 0], 100),
    buildBucket([1, 1, 2, 0], 101),
    buildBucket([1, 2, 1, 0], 102),
  ];

  setActiveBucketsAndWait(tbm, activeBuckets, [1, 1, 1, 0], [0, 0, 0, 1]);

  expectBucket(t, tbm, activeBuckets[0], 100);
  expectBucket(t, tbm, activeBuckets[1], 101);
  expectBucket(t, tbm, activeBuckets[2], 102);
});

test("TextureBucketManager: changing active buckets", t => {
  const tbm = new TextureBucketManager(5, 2048, 2, 1);

  tbm.setupDataTextures(1);
  const activeBuckets = [
    buildBucket([0, 0, 0, 0], 100),
    buildBucket([0, 0, 1, 0], 101),
    buildBucket([0, 1, 0, 0], 102),
    buildBucket([1, 0, 0, 0], 200),
    buildBucket([1, 0, 1, 0], 201),
    buildBucket([1, 1, 0, 0], 202),
  ];

  setActiveBucketsAndWait(tbm, activeBuckets.slice(0, 3), [0, 0, 0, 0], [0, 0, 0, 1]);
  setActiveBucketsAndWait(tbm, activeBuckets.slice(3, 6), [1, 0, 0, 0], [0, 0, 0, 1]);

  expectBucket(t, tbm, activeBuckets[3], 200);
  expectBucket(t, tbm, activeBuckets[4], 201);
  expectBucket(t, tbm, activeBuckets[5], 202);
});
