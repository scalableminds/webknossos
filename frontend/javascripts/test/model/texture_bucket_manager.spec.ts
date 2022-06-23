import * as THREE from "three";
import mock from "mock-require";
import test, { ExecutionContext } from "ava";
import { Vector4 } from "oxalis/constants";

const formatToChannelCount = new Map([
  [THREE.LuminanceFormat, 1],
  [THREE.LuminanceAlphaFormat, 2],
  [THREE.RGBFormat, 3],
  [THREE.RGBAFormat, 4],
]);
// @ts-ignore
global.performance = {
  now: () => Date.now(),
};
mock("libs/window", {
  requestAnimationFrame: () => {},
  document: {
    getElementById: () => null,
  },
});
mock(
  "libs/UpdatableTexture",
  class UpdatableTexture {
    texture: Uint8Array = new Uint8Array();
    width: number = 0;
    height: number = 0;
    channelCount: number;

    constructor(_width: number, _height: number, format: any) {
      this.channelCount = formatToChannelCount.get(format) || 0;
    }

    update(src: Float32Array | Uint8Array, x: number, y: number, _width: number, _height: number) {
      this.texture.set(src, y * this.width + x);
    }

    setRenderer() {}

    setSize(width: number, height: number) {
      this.texture = new Uint8Array(width * height * this.channelCount);
      this.width = width;
      this.height = height;
    }

    isInitialized() {
      return true;
    }
  },
);

const temporalBucketManagerMock = {
  addBucket: () => {},
};
const mockedCube = {
  isSegmentation: false,
};

const {
  default: TextureBucketManager,
  CuckooTable,
  channelCountForLookupBuffer,
} = mock.reRequire("oxalis/model/bucket_data_handling/texture_bucket_manager");
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

// test("TextureBucketManager: basic functionality", t => {
//   const tbm = new TextureBucketManager(2048, 1, 1);

//   tbm.setupDataTextures(1);
//   const activeBuckets = [
//     buildBucket([1, 1, 1, 0], 100),
//     buildBucket([1, 1, 2, 0], 101),
//     buildBucket([1, 2, 1, 0], 102),
//   ];

//   setActiveBucketsAndWait(tbm, activeBuckets, [1, 1, 1, 0]);

//   expectBucket(t, tbm, activeBuckets[0], 100);
//   expectBucket(t, tbm, activeBuckets[1], 101);
//   expectBucket(t, tbm, activeBuckets[2], 102);
// });

// test("TextureBucketManager: changing active buckets", t => {
//   const tbm = new TextureBucketManager(2048, 2, 1);

//   tbm.setupDataTextures(1);
//   const activeBuckets = [
//     buildBucket([0, 0, 0, 0], 100),
//     buildBucket([0, 0, 1, 0], 101),
//     buildBucket([0, 1, 0, 0], 102),
//     buildBucket([1, 0, 0, 0], 200),
//     buildBucket([1, 0, 1, 0], 201),
//     buildBucket([1, 1, 0, 0], 202),
//   ];

//   setActiveBucketsAndWait(tbm, activeBuckets.slice(0, 3), [0, 0, 0, 0]);
//   setActiveBucketsAndWait(tbm, activeBuckets.slice(3, 6), [1, 0, 0, 0]);

//   expectBucket(t, tbm, activeBuckets[3], 200);
//   expectBucket(t, tbm, activeBuckets[4], 201);
//   expectBucket(t, tbm, activeBuckets[5], 202);
// });

function generateRandomEntry() {
  return [
    [
      Math.floor(Math.random() * 100),
      Math.floor(Math.random() * 100),
      Math.floor(Math.random() * 100),
      Math.floor(Math.random() * 5),
    ],
    Math.floor(Math.random() * 1000),
  ];
}

function generateRandomEntrySet() {
  const count = 1000;
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push(generateRandomEntry());
  }
  return entries;
}

test("CuckooTable", (t) => {
  const ct = new CuckooTable();
  const entries = generateRandomEntrySet();
  console.time("start");

  for (const entry of entries) {
    debugger;
    ct.setEntry(entry[0], entry[1]);
    t.is(entry[1], ct.getValue(entry[0]));
  }

  for (const entry of entries) {
    t.is(entry[1], ct.getValue(entry[0]));
  }

  // ct.setEntry([1, 10, 3, 4], 1337);
  // console.log(ct.getValue([1, 10, 3, 4]));
  // ct.setEntry([1, 10, 3, 4], 1336);
  // console.log(ct.getValue([1, 10, 3, 4]));
  // ct.setEntry([1, 10, 2, 4], 1);
  // ct.getValue([1, 10, 2, 4]);
  // ct.setEntry([1, 10, 3, 4], 1);

  // ct.setEntry([1, 34, 3, 4], 1);
  console.timeEnd("start");

  console.log("ct.table", ct.table);

  t.is(true, true);
});
