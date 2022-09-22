import mock from "mock-require";
import test, { ExecutionContext } from "ava";
import { Vector4 } from "oxalis/constants";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";

const temporalBucketManagerMock = {
  addBucket: () => {},
};
const mockedCube = {
  isSegmentation: false,
};
const { default: TextureBucketManager, channelCountForLookupBuffer } = mock.reRequire(
  "oxalis/model/bucket_data_handling/texture_bucket_manager",
);
const { DataBucket, NULL_BUCKET } = mock.reRequire("oxalis/model/bucket_data_handling/bucket");

const buildBucket = (zoomedAddress: Vector4, firstByte: number) => {
  const bucket = new DataBucket("uint8", zoomedAddress, temporalBucketManagerMock, mockedCube);
  bucket._fallbackBucket = NULL_BUCKET;
  bucket.markAsPulled();
  const data = new Uint8Array(32 ** 3);
  data[0] = firstByte;
  bucket.receiveData(data);
  return bucket;
};

const setActiveBucketsAndWait = (
  tbm: typeof TextureBucketManager,
  // @ts-expect-error ts-migrate(2749) FIXME: 'DataBucket' refers to a value, but is being used ... Remove this comment to see the full error message
  activeBuckets: DataBucket[],
  anchorPoint: Vector4,
) => {
  tbm.setActiveBuckets(activeBuckets, anchorPoint);
  // Depending on timing, processWriterQueue has to be called n times in the slowest case
  activeBuckets.forEach(() => tbm.processWriterQueue());

  tbm._refreshLookUpBuffer();
};

const expectBucket = (
  t: ExecutionContext<unknown>,
  tbm: typeof TextureBucketManager,
  bucket: typeof DataBucket,
  expectedFirstByte: number,
) => {
  const bucketIdx = tbm._getBucketIndex(bucket.zoomedAddress);

  const bucketLocation =
    tbm.getPackedBucketSize() * tbm.lookUpBuffer[channelCountForLookupBuffer * bucketIdx];
  t.is(tbm.dataTextures[0].texture[bucketLocation], expectedFirstByte);
};

test("TextureBucketManager: basic functionality", (t) => {
  const tbm = new TextureBucketManager(2048, 1, 1, "uint8");
  tbm.setupDataTextures(1);
  const activeBuckets = [
    buildBucket([1, 1, 1, 0], 100),
    buildBucket([1, 1, 2, 0], 101),
    buildBucket([1, 2, 1, 0], 102),
  ];
  setActiveBucketsAndWait(tbm, activeBuckets, [1, 1, 1, 0]);
  expectBucket(t, tbm, activeBuckets[0], 100);
  expectBucket(t, tbm, activeBuckets[1], 101);
  expectBucket(t, tbm, activeBuckets[2], 102);
});

test("TextureBucketManager: changing active buckets", (t) => {
  const tbm = new TextureBucketManager(2048, 2, 1, "uint8");
  tbm.setupDataTextures(1);
  const activeBuckets = [
    buildBucket([0, 0, 0, 0], 100),
    buildBucket([0, 0, 1, 0], 101),
    buildBucket([0, 1, 0, 0], 102),
    buildBucket([1, 0, 0, 0], 200),
    buildBucket([1, 0, 1, 0], 201),
    buildBucket([1, 1, 0, 0], 202),
  ];
  setActiveBucketsAndWait(tbm, activeBuckets.slice(0, 3), [0, 0, 0, 0]);
  setActiveBucketsAndWait(tbm, activeBuckets.slice(3, 6), [1, 0, 0, 0]);
  expectBucket(t, tbm, activeBuckets[3], 200);
  expectBucket(t, tbm, activeBuckets[4], 201);
  expectBucket(t, tbm, activeBuckets[5], 202);
});
