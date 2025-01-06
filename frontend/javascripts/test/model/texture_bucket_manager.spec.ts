import mock from "mock-require";
import "test/mocks/lz4";
import test, { type ExecutionContext } from "ava";
import type { Vector4 } from "oxalis/constants";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";
import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";

const LAYER_INDEX = 0;
const CUCKOO_TEXTURE_WIDTH = 64;

const temporalBucketManagerMock = {
  addBucket: () => {},
};
const mockedCube = {
  isSegmentation: false,
  triggerBucketDataChanged: () => {},
};
const { default: TextureBucketManager } = mock.reRequire(
  "oxalis/model/bucket_data_handling/texture_bucket_manager",
);
const { DataBucket, NULL_BUCKET } = mock.reRequire("oxalis/model/bucket_data_handling/bucket");

const buildBucket = (zoomedAddress: Vector4, firstByte: number) => {
  const bucket = new DataBucket("uint8", zoomedAddress, temporalBucketManagerMock, mockedCube);
  bucket._fallbackBucket = NULL_BUCKET;
  bucket.markAsRequested();
  const data = new Uint8Array(32 ** 3);
  data[0] = firstByte;
  bucket.receiveData(data);
  return bucket;
};

const setActiveBucketsAndWait = (
  tbm: typeof TextureBucketManager,
  activeBuckets: (typeof DataBucket)[],
) => {
  tbm.setActiveBuckets(activeBuckets);
  // Depending on timing, processWriterQueue has to be called n times in the slowest case
  activeBuckets.forEach(() => tbm.processWriterQueue());
};

const expectBucket = (
  t: ExecutionContext<unknown>,
  tbm: typeof TextureBucketManager,
  bucket: typeof DataBucket,
  expectedFirstByte: number,
) => {
  const bucketAddress = tbm.lookUpCuckooTable.get([
    bucket.zoomedAddress[0],
    bucket.zoomedAddress[1],
    bucket.zoomedAddress[2],
    bucket.zoomedAddress[3],
    LAYER_INDEX,
  ]);

  const bucketLocation = tbm.getPackedBucketSize() * bucketAddress;
  t.is(tbm.dataTextures[0].texture[bucketLocation], expectedFirstByte);
};

test("TextureBucketManager: basic functionality", (t) => {
  const tbm = new TextureBucketManager(2048, 1, 1, "uint8");
  tbm.setupDataTextures(1, new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);
  const activeBuckets = [
    buildBucket([1, 1, 1, 0], 100),
    buildBucket([1, 1, 2, 0], 101),
    buildBucket([1, 2, 1, 0], 102),
  ];
  setActiveBucketsAndWait(tbm, activeBuckets);
  expectBucket(t, tbm, activeBuckets[0], 100);
  expectBucket(t, tbm, activeBuckets[1], 101);
  expectBucket(t, tbm, activeBuckets[2], 102);
});

test("TextureBucketManager: changing active buckets", (t) => {
  const tbm = new TextureBucketManager(2048, 2, 1, "uint8");
  tbm.setupDataTextures(1, new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);
  const activeBuckets = [
    buildBucket([0, 0, 0, 0], 100),
    buildBucket([0, 0, 1, 0], 101),
    buildBucket([0, 1, 0, 0], 102),
    buildBucket([1, 0, 0, 0], 200),
    buildBucket([1, 0, 1, 0], 201),
    buildBucket([1, 1, 0, 0], 202),
  ];
  setActiveBucketsAndWait(tbm, activeBuckets.slice(0, 3));
  setActiveBucketsAndWait(tbm, activeBuckets.slice(3, 6));
  expectBucket(t, tbm, activeBuckets[3], 200);
  expectBucket(t, tbm, activeBuckets[4], 201);
  expectBucket(t, tbm, activeBuckets[5], 202);
});
