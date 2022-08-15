import * as THREE from "three";
import mock from "mock-require";
import test, { ExecutionContext } from "ava";
import _ from "lodash";
import { Vector2, Vector4 } from "oxalis/constants";
import { CuckooTable } from "oxalis/model/bucket_data_handling/cuckoo_table";
/*
 * Note that RGB textures are currently not tested in this spec.
 * If tests were added, the following Map would not be sufficient, anymore,
 * since RGBAFormat is also used for 3 channels which would make the key not unique.
 */
const formatToChannelCount = new Map([
  [THREE.RedFormat, 1],
  [THREE.RGFormat, 2],
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
      if (this.channelCount === 0) {
        throw new Error("Format could not be converted to channel count");
      }
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

function generateRandomEntry(): [Vector4, Vector2] {
  return [
    [
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
    ],
    [Math.floor(Math.random() * 1000), Math.floor(Math.random() * 1000)],
  ];
}

function generateRandomEntrySet() {
  const count = 1600;
  const set = new Set();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const entry = generateRandomEntry();
    const entryKey = entry[0].join("-");
    if (set.has(entryKey)) {
      i--;
      continue;
    }
    set.add(entryKey);
    entries.push(entry);
  }
  return entries;
}

function isValueEqual(t: ExecutionContext<any>, val1: Vector2, val2: Vector2) {
  t.true(val1[0] === val2[0]);
  t.true(val1[1] === val2[1]);
}

test.serial("CuckooTable", (t) => {
  const entries = generateRandomEntrySet();
  const ct = new CuckooTable(entries.length);
  console.time("simple");

  let n = 0;
  for (const entry of entries) {
    // console.log(`! write n=${n}   entry=${entry}`);

    ct.set(entry[0], entry[1]);
    const readValue = ct.get(entry[0]);
    isValueEqual(t, entry[1], readValue);
    // if (entry[1][0] != readValue[0]) {
    //   console.log("key:", entry[0]);
    //   console.log("value:", entry[1]);
    //   console.log("retrieved value: ", ct.get(entry[0]));
    //   throw new Error("failed");
    // }
    let nn = 0;
    for (const entry of entries) {
      if (nn > n) {
        break;
      }
      isValueEqual(t, entry[1], ct.get(entry[0]));
      // if (entry[1] != ct.get(entry[0])) {
      //   console.log(`? nn=${nn}  expected=${entry}    retrieved=${ct.get(entry[0])}`);
      //   throw new Error("failed");
      // }
      nn++;
    }
    n++;
  }

  // ct.set([1, 10, 3, 4], 1337);
  // console.log(ct.get([1, 10, 3, 4]));
  // ct.set([1, 10, 3, 4], 1336);
  // console.log(ct.get([1, 10, 3, 4]));
  // ct.set([1, 10, 2, 4], 1);
  // ct.get([1, 10, 2, 4]);
  // ct.set([1, 10, 3, 4], 1);

  // ct.set([1, 34, 3, 4], 1);
  console.timeEnd("simple");
});

test.serial("CuckooTable speed", (t) => {
  const RUNS = 1000;
  const hashSets = _.range(RUNS).map(() => generateRandomEntrySet());

  const cts = _.range(RUNS).map(() => new CuckooTable(hashSets[0].length));

  console.time("many runs");

  const durations = [];
  for (let idx = 0; idx < RUNS; idx++) {
    const ct = cts[idx];
    // console.log("******************************************************", idx);
    const entries = hashSets[idx];
    for (const entry of entries) {
      const then = performance.now();
      ct.set(entry[0], entry[1]);
      const now = performance.now();
      durations.push(now - then);
    }
  }
  console.timeEnd("many runs");
  console.log("durations", _.reverse(durations.sort((a, b) => a - b)));
  console.log("_.max(durations)", _.max(durations));
  console.log("_.mean(durations)", _.mean(durations));

  // ct.set([1, 10, 3, 4], 1337);
  // console.log(ct.get([1, 10, 3, 4]));
  // ct.set([1, 10, 3, 4], 1336);
  // console.log(ct.get([1, 10, 3, 4]));
  // ct.set([1, 10, 2, 4], 1);
  // ct.get([1, 10, 2, 4]);
  // ct.set([1, 10, 3, 4], 1);

  // ct.set([1, 34, 3, 4], 1);
  t.true(true);
});
