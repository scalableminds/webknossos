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
    isTRecyclingEligible: false,
    getEffectiveBucketVoxelCount: () => 32 ** 3,
    // Only exercised by t-recycling's retargetToNewT; default to "no siblings exist"
    // so non-t-recycling tests are unaffected.
    getOrCreateBucket: () => NULL_BUCKET,
    pullQueue: { add: () => {}, pull: () => {} },
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

  it("t-recycling: uploads a bucket's whole shared batch buffer in one shot, addressed via the t-batch", () => {
    const textureWidth = 256;
    const t = 45; // batch index = floor(45/32) = 1, zSlot = 45 % 32 = 13
    const sliceVoxelCount = 32 * 32; // effectiveBucketDepth === 1
    const tRecyclingMockedCube = makeMockCube({
      effectiveBucketDepth: 1,
      additionalAxes: { t: { name: "t", bounds: [0, 1000], index: 3 } },
      isTRecyclingEligible: true,
      // CPU-side data for a t-recycling-eligible layer stays shrunk to one z-slice.
      getEffectiveBucketVoxelCount: () => sliceVoxelCount,
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
    // Simulates a real batched fetch (see PullQueue.handleBatchedBucketResult): the wire
    // payload covers the whole 32-t batch, and this bucket's own t-slice is placed at its
    // corresponding offset within it, not at offset 0.
    const zSlot = t % 32;
    const rawBatchBuffer = new Uint8Array(32 ** 3);
    rawBatchBuffer[zSlot * sliceVoxelCount] = 77;
    bucket.receiveData(rawBatchBuffer, false, zSlot * sliceVoxelCount);

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
    // The whole raw batch buffer is uploaded verbatim (unpacked byte layout, see
    // MockUpdatableTexture.update), so a marker's position within it carries straight
    // through to its position within the bucket's row-aligned region of the atlas.
    const bucketLocation =
      bucketHeightInTexture * bucketAddress * textureWidth + zSlot * sliceVoxelCount;
    // @ts-expect-error - texture is available in our mock but not in the real type
    expect(tbm.dataTextures[0].texture[bucketLocation]).toBe(77);
  });

  it("t-recycling: a batch's whole shared buffer lands on the GPU from just its active (primary) bucket", () => {
    const textureWidth = 256;
    const primaryT = 32; // batch 1, zSlot 0
    const siblingT = 40; // batch 1, zSlot 8
    const sliceVoxelCount = 32 * 32;

    const tRecyclingMockedCube = makeMockCube({
      effectiveBucketDepth: 1,
      additionalAxes: { t: { name: "t", bounds: [0, 1000], index: 3 } },
      isTRecyclingEligible: true,
      getEffectiveBucketVoxelCount: () => sliceVoxelCount,
    });

    // Simulates the real PullQueue flow: one network response for the whole batch,
    // shared verbatim across every t within it (see handleBatchedBucketResult) —
    // both markers below live in the very same buffer.
    const rawBatchBuffer = new Uint8Array(32 ** 3);
    rawBatchBuffer[(primaryT % 32) * sliceVoxelCount] = 11;
    rawBatchBuffer[(siblingT % 32) * sliceVoxelCount] = 22;

    const buildTRecyclingBucket = (t: number) => {
      const bucket = new DataBucket(
        "uint8",
        [1, 1, 0, 0, [{ name: "t", value: t }]] as any,
        temporalBucketManagerMock as any,
        { type: "full" },
        tRecyclingMockedCube as any,
      );
      bucket._fallbackBucket = NULL_BUCKET;
      bucket.markAsRequested();
      bucket.receiveData(rawBatchBuffer, false, (t % 32) * sliceVoxelCount);
      return bucket;
    };

    const primaryBucket = buildTRecyclingBucket(primaryT);
    // Note: this sibling is never passed to setActiveBuckets, nor looked up via
    // getOrCreateBucket by the manager. With the new design that's fine: its data
    // already rode along in the primary's single bulk upload of the shared buffer.
    buildTRecyclingBucket(siblingT);

    const tbm = new TextureBucketManager(textureWidth, 1, "uint8", tRecyclingMockedCube as any);
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

    setActiveBucketsAndWait(tbm, [primaryBucket]);

    const bucketAddress = tbm.lookUpCuckooTable.get([1, 1, 1, 0, LAYER_INDEX]);
    if (bucketAddress == null) {
      throw new Error("Bucket address is null");
    }

    const bucketHeightInTexture = getBucketHeightInTexture(
      textureWidth,
      tbm.packingDegree,
      tbm.bucketVoxelCount,
    );
    for (const [t, expectedFirstByte] of [
      [primaryT, 11],
      [siblingT, 22],
    ] as const) {
      const zSlot = t % 32;
      const bucketLocation =
        bucketHeightInTexture * bucketAddress * textureWidth + zSlot * sliceVoxelCount;
      // @ts-expect-error - texture is available in our mock but not in the real type
      expect(tbm.dataTextures[0].texture[bucketLocation]).toBe(expectedFirstByte);
    }
  });

  it("t-recycling: retargetToNewT reuses an already-resident batch, but re-picks across a batch boundary", () => {
    const textureWidth = 256;
    const primaryT = 32; // batch 1, zSlot 0
    const siblingT = 40; // batch 1, zSlot 8
    const otherBatchT = 64; // batch 2, zSlot 0
    const sliceVoxelCount = 32 * 32;

    const tRecyclingMockedCube = makeMockCube({
      effectiveBucketDepth: 1,
      additionalAxes: { t: { name: "t", bounds: [0, 1000], index: 3 } },
      isTRecyclingEligible: true,
      getEffectiveBucketVoxelCount: () => sliceVoxelCount,
    });

    const batch1Buffer = new Uint8Array(32 ** 3);
    batch1Buffer[(primaryT % 32) * sliceVoxelCount] = 11;
    batch1Buffer[(siblingT % 32) * sliceVoxelCount] = 22;
    const batch2Buffer = new Uint8Array(32 ** 3);
    batch2Buffer[(otherBatchT % 32) * sliceVoxelCount] = 33;

    const buildTRecyclingBucket = (t: number, rawBatchBuffer: Uint8Array<ArrayBuffer>) => {
      const bucket = new DataBucket(
        "uint8",
        [1, 1, 0, 0, [{ name: "t", value: t }]] as any,
        temporalBucketManagerMock as any,
        { type: "full" },
        tRecyclingMockedCube as any,
      );
      bucket._fallbackBucket = NULL_BUCKET;
      bucket.markAsRequested();
      bucket.receiveData(rawBatchBuffer, false, (t % 32) * sliceVoxelCount);
      return bucket;
    };

    const primaryBucket = buildTRecyclingBucket(primaryT, batch1Buffer);
    const siblingBucket = buildTRecyclingBucket(siblingT, batch1Buffer);
    const otherBatchBucket = buildTRecyclingBucket(otherBatchT, batch2Buffer);

    tRecyclingMockedCube.getOrCreateBucket = ((address: [number, number, number, number, any]) => {
      const t = address[4]?.find((coord: { name: string }) => coord.name === "t")?.value;
      if (t === siblingT) return siblingBucket;
      if (t === otherBatchT) return otherBatchBucket;
      return NULL_BUCKET;
    }) as any;

    const tbm = new TextureBucketManager(textureWidth, 1, "uint8", tRecyclingMockedCube as any);
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

    setActiveBucketsAndWait(tbm, [primaryBucket]);
    const originalBucketAddress = tbm.lookUpCuckooTable.get([1, 1, 1, 0, LAYER_INDEX]);
    if (originalBucketAddress == null) {
      throw new Error("Bucket address is null");
    }

    // Retargeting to a t within the SAME batch should be a no-op for the atlas: the
    // group's index is unchanged, and no new upload happens — the whole batch's buffer,
    // including the sibling's slice, already landed via the primary's earlier upload.
    tbm.retargetToNewT([{ name: "t", value: siblingT }]);
    tbm.processWriterQueue();
    expect(tbm.lookUpCuckooTable.get([1, 1, 1, 0, LAYER_INDEX])).toBe(originalBucketAddress);

    const bucketHeightInTexture = getBucketHeightInTexture(
      textureWidth,
      tbm.packingDegree,
      tbm.bucketVoxelCount,
    );
    for (const [t, expectedFirstByte] of [
      [primaryT, 11],
      [siblingT, 22],
    ] as const) {
      const zSlot = t % 32;
      const bucketLocation =
        bucketHeightInTexture * originalBucketAddress * textureWidth + zSlot * sliceVoxelCount;
      // @ts-expect-error - texture is available in our mock but not in the real type
      expect(tbm.dataTextures[0].texture[bucketLocation]).toBe(expectedFirstByte);
    }

    // Retargeting across a batch boundary should evict the old batch's group
    // entirely (cuckoo entry unset) and create/populate a new one.
    tbm.retargetToNewT([{ name: "t", value: otherBatchT }]);
    tbm.processWriterQueue();
    expect(tbm.lookUpCuckooTable.get([1, 1, 1, 0, LAYER_INDEX])).toBeNull();
    const newBucketAddress = tbm.lookUpCuckooTable.get([1, 1, 2, 0, LAYER_INDEX]);
    if (newBucketAddress == null) {
      throw new Error("New bucket address is null");
    }
    const newZSlot = otherBatchT % 32;
    const newBucketLocation =
      bucketHeightInTexture * newBucketAddress * textureWidth + newZSlot * sliceVoxelCount;
    // @ts-expect-error - texture is available in our mock but not in the real type
    expect(tbm.dataTextures[0].texture[newBucketLocation]).toBe(33);
  });
});
