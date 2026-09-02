import "test/mocks/updatable_texture.mock";
import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import type { Vector4 } from "viewer/constants";
import { DataBucket, NULL_BUCKET } from "viewer/model/bucket_data_handling/bucket";
import { getBucketHeightInTexture } from "viewer/model/bucket_data_handling/data_rendering_logic";
import TextureBucketManager from "viewer/model/bucket_data_handling/texture_bucket_manager";
import { beforeEach, describe, expect, it } from "vitest";

// Mock storage for texture data
const textureMockDataStore = {
  data: new Uint8Array(2048),
  addressMapping: new Map(),
};

const LAYER_INDEX = 0;
const CUCKOO_TEXTURE_WIDTH = 64;

const temporalBucketManagerMock = {
  addBucket: () => {},
  pullQueue: { size: 0 },
  pushQueue: { size: 0 },
  loadedPromises: {},
  getCount: () => 0,
  areAllBucketsLoaded: () => true,
  getPromise: () => Promise.resolve(),
  isEmpty: () => true,
};

function makeMockCube(overrides: Partial<ReturnType<typeof makeMockCubeBase>> = {}) {
  return { ...makeMockCubeBase(), ...overrides };
}
function makeMockCubeBase() {
  return {
    isSegmentation: false,
    triggerRenderedBucketDataChanged: () => {},
    effectiveBucketDepth: 32,
    additionalAxes: {} as Record<string, { bounds: [number, number]; index: number; name: string }>,
    getEffectiveBucketVoxelCount: () => 32 ** 3,
  };
}

const mockedCube = makeMockCube();

const buildBucket = (zoomedAddress: Vector4, firstByte: number) => {
  const bucket = new DataBucket(
    "uint8",
    zoomedAddress,
    temporalBucketManagerMock as any,
    { type: "full" },
    mockedCube as any,
  );
  bucket._fallbackBucket = NULL_BUCKET;
  bucket.markAsRequested();
  const data = new Uint8Array(32 ** 3);
  data[0] = firstByte;
  bucket.receiveData(data);
  return bucket;
};

const setActiveBucketsAndWait = (tbm: TextureBucketManager, activeBuckets: DataBucket[]) => {
  tbm.setActiveBuckets(activeBuckets);
  // Depending on timing, processWriterQueue has to be called n times in the slowest case
  activeBuckets.forEach(() => {
    tbm.processWriterQueue();
  });
};

const expectBucket = (tbm: TextureBucketManager, bucket: DataBucket, expectedFirstByte: number) => {
  const bucketAddress = tbm.lookUpCuckooTable.get([
    bucket.zoomedAddress[0],
    bucket.zoomedAddress[1],
    bucket.zoomedAddress[2],
    bucket.zoomedAddress[3],
    LAYER_INDEX,
  ]);

  if (bucketAddress == null) {
    throw new Error("Bucket address is null");
  }

  const bucketLocation = tbm.getPackedBucketSize() * bucketAddress;
  // @ts-expect-error - texture is available in our mock but not in the real type
  expect(tbm.dataTextures[0].texture[bucketLocation]).toBe(expectedFirstByte);
};

describe("TextureBucketManager", () => {
  beforeEach(() => {
    // Reset the texture mock data for each test
    textureMockDataStore.data.fill(0);
    textureMockDataStore.addressMapping.clear();
  });

  it("basic functionality", () => {
    const tbm = new TextureBucketManager(2048, 1, "uint8", mockedCube as any);
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

    const activeBuckets = [
      buildBucket([1, 1, 1, 0], 100),
      buildBucket([1, 1, 2, 0], 101),
      buildBucket([1, 2, 1, 0], 102),
    ];
    setActiveBucketsAndWait(tbm, activeBuckets);

    expectBucket(tbm, activeBuckets[0], 100);
    expectBucket(tbm, activeBuckets[1], 101);
    expectBucket(tbm, activeBuckets[2], 102);
  });

  it("changing active buckets", () => {
    const tbm = new TextureBucketManager(2048, 2, "uint8", mockedCube as any);
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

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

    expectBucket(tbm, activeBuckets[3], 200);
    expectBucket(tbm, activeBuckets[4], 201);
    expectBucket(tbm, activeBuckets[5], 202);
  });

  it("supports a shrunk bucket footprint (e.g., 2D datasets)", () => {
    const textureWidth = 2048;
    const bucketVoxelCount = 32 * 32 * 1; // z-degenerate (2D) layer, no t-axis
    const shrunkMockedCube = makeMockCube({
      effectiveBucketDepth: 1,
      getEffectiveBucketVoxelCount: () => bucketVoxelCount,
    });
    const buildShrunkBucket = (zoomedAddress: Vector4, firstByte: number) => {
      const bucket = new DataBucket(
        "uint8",
        zoomedAddress,
        temporalBucketManagerMock as any,
        { type: "full" },
        shrunkMockedCube as any,
      );
      bucket._fallbackBucket = NULL_BUCKET;
      bucket.markAsRequested();
      // The wire format always delivers a full 32^3 cube; DataBucket.receiveData
      // slices it down to the layer's effective (here: shrunk) footprint.
      const data = new Uint8Array(32 ** 3);
      data[0] = firstByte;
      bucket.receiveData(data);
      return bucket;
    };

    const tbm = new TextureBucketManager(textureWidth, 1, "uint8", shrunkMockedCube as any);
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

    const activeBuckets = [
      buildShrunkBucket([1, 1, 1, 0], 100),
      buildShrunkBucket([1, 1, 2, 0], 101),
    ];
    setActiveBucketsAndWait(tbm, activeBuckets);

    const bucketHeightInTexture = getBucketHeightInTexture(
      textureWidth,
      tbm.packingDegree,
      bucketVoxelCount,
    );
    // Sanity-check that this test actually exercises the whole-row-clamped path
    // (packedBucketSize = 1024 / 4 = 256, well below the 2048-wide texture).
    expect(bucketHeightInTexture).toBe(1);

    for (const [bucket, expectedFirstByte] of [
      [activeBuckets[0], 100],
      [activeBuckets[1], 101],
    ] as const) {
      const bucketAddress = tbm.lookUpCuckooTable.get([
        bucket.zoomedAddress[0],
        bucket.zoomedAddress[1],
        bucket.zoomedAddress[2],
        bucket.zoomedAddress[3],
        LAYER_INDEX,
      ]);

      if (bucketAddress == null) {
        throw new Error("Bucket address is null");
      }

      const bucketLocation = bucketHeightInTexture * textureWidth * bucketAddress;
      // @ts-expect-error - texture is available in our mock but not in the real type
      expect(tbm.dataTextures[0].texture[bucketLocation]).toBe(expectedFirstByte);
    }
  });

  it("t-recycling: places a t-slice at its z-sub-slot, addressed via the t-batch (Stage A)", () => {
    // Row-alignment guard requires textureWidth <= (32^2 / packingDegree) = 256 for uint8.
    const textureWidth = 256;
    const t = 45; // batch index = floor(45/32) = 1, zSlot = 45 % 32 = 13
    const tRecyclingMockedCube = makeMockCube({
      effectiveBucketDepth: 1,
      additionalAxes: { t: { name: "t", bounds: [0, 1000], index: 3 } },
      // CPU-side data for a t-recycling-eligible layer stays shrunk to one z-slice.
      getEffectiveBucketVoxelCount: () => 32 * 32 * 1,
    });

    const bucket = new DataBucket(
      "uint8",
      [1, 1, 0, 0, [{ name: "t", value: t }]] as any,
      temporalBucketManagerMock as any,
      { type: "full" },
      tRecyclingMockedCube as any,
    );
    bucket._fallbackBucket = NULL_BUCKET;
    bucket.markAsRequested();
    const data = new Uint8Array(32 ** 3); // full wire payload; receiveData slices it down
    data[0] = 77;
    bucket.receiveData(data);

    const tbm = new TextureBucketManager(textureWidth, 1, "uint8", tRecyclingMockedCube as any);
    expect(tbm.isTRecyclingEnabled).toBe(true);
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

    setActiveBucketsAndWait(tbm, [bucket]);

    // Looked up via the t-batch index (1), not the bucket's real (always-0) z.
    const bucketAddress = tbm.lookUpCuckooTable.get([1, 1, 1, 0, LAYER_INDEX]);
    if (bucketAddress == null) {
      throw new Error("Bucket address is null");
    }

    const bucketHeightInTexture = getBucketHeightInTexture(
      textureWidth,
      tbm.packingDegree,
      tbm.bucketVoxelCount,
    );
    expect(bucketHeightInTexture).toBe(32); // full-depth atlas geometry, not shrunk
    const writeHeight = bucketHeightInTexture / 32;
    const zSlot = t % 32;
    const bucketLocation =
      (bucketHeightInTexture * bucketAddress + writeHeight * zSlot) * textureWidth;
    // @ts-expect-error - texture is available in our mock but not in the real type
    expect(tbm.dataTextures[0].texture[bucketLocation]).toBe(77);
  });
});
