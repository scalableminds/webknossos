import "test/mocks/updatable_texture.mock";
import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import type { Vector4 } from "viewer/constants";
import { DataBucket, NULL_BUCKET } from "viewer/model/bucket_data_handling/bucket";
import {
  LAYER_POOL_TEXTURE_WIDTH,
  LayerPool,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import PoolTextureManager from "viewer/model/bucket_data_handling/pool_texture_manager";
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

const mockedCube = {
  isSegmentation: false,
  triggerRenderedBucketDataChanged: () => {},
};

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

const createTbm = (dataTextureCount: number) => {
  const pool = new PoolTextureManager(LayerPool.U8, dataTextureCount);
  const tbm = new TextureBucketManager(LAYER_POOL_TEXTURE_WIDTH, dataTextureCount, "uint8", {
    poolTextureManager: pool,
    baseSlice: 0,
    bucketCapacity: Number.POSITIVE_INFINITY,
  });
  tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);
  return { tbm, pool };
};

const expectBucket = (
  tbm: TextureBucketManager,
  pool: PoolTextureManager,
  bucket: DataBucket,
  expectedFirstByte: number,
) => {
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
  expect(pool.textureArray.texture[bucketLocation]).toBe(expectedFirstByte);
};

describe("TextureBucketManager", () => {
  beforeEach(() => {
    // Reset the texture mock data for each test
    textureMockDataStore.data.fill(0);
    textureMockDataStore.addressMapping.clear();
  });

  it("basic functionality", () => {
    const { tbm, pool } = createTbm(1);

    const activeBuckets = [
      buildBucket([1, 1, 1, 0], 100),
      buildBucket([1, 1, 2, 0], 101),
      buildBucket([1, 2, 1, 0], 102),
    ];
    setActiveBucketsAndWait(tbm, activeBuckets);

    expectBucket(tbm, pool, activeBuckets[0], 100);
    expectBucket(tbm, pool, activeBuckets[1], 101);
    expectBucket(tbm, pool, activeBuckets[2], 102);
  });

  it("changing active buckets", () => {
    const { tbm, pool } = createTbm(2);

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

    expectBucket(tbm, pool, activeBuckets[3], 200);
    expectBucket(tbm, pool, activeBuckets[4], 201);
    expectBucket(tbm, pool, activeBuckets[5], 202);
  });

  it("pooled mode writes into the shared pool texture, offset by baseSlice", () => {
    const pool = new PoolTextureManager(LayerPool.U8, /* depth */ 4);
    const baseSlice = 2; // simulates another layer already having reserved slices 0-1
    const tbm = new TextureBucketManager(LAYER_POOL_TEXTURE_WIDTH, 2, "uint8", {
      poolTextureManager: pool,
      baseSlice,
      bucketCapacity: 1024,
    });
    tbm.setupDataTextures(new CuckooTableVec5(CUCKOO_TEXTURE_WIDTH), LAYER_INDEX);

    const bucket = buildBucket([1, 1, 1, 0], 100);
    setActiveBucketsAndWait(tbm, [bucket]);

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

    const bucketsPerTexture =
      (LAYER_POOL_TEXTURE_WIDTH * LAYER_POOL_TEXTURE_WIDTH) / tbm.getPackedBucketSize();
    // The stored address includes the layer's baseSlice.
    expect(bucketAddress).toBeGreaterThanOrEqual(baseSlice * bucketsPerTexture);
    expect(bucketAddress).toBeLessThan((baseSlice + 1) * bucketsPerTexture);

    // The layer's first bucket lands in the pool texture's baseSlice-th slice.
    const sliceByteOffset = baseSlice * LAYER_POOL_TEXTURE_WIDTH * LAYER_POOL_TEXTURE_WIDTH;
    // @ts-expect-error - texture is available in our mock but not in the real type
    expect(pool.textureArray.texture[sliceByteOffset]).toBe(100);
  });

  it("pooled mode caps the capacity at bucketCapacity", () => {
    const pool = new PoolTextureManager(LayerPool.U8, /* depth */ 2);
    // Two uint8 slices could hold 1024 buckets.
    const tbm = new TextureBucketManager(LAYER_POOL_TEXTURE_WIDTH, 2, "uint8", {
      poolTextureManager: pool,
      baseSlice: 0,
      bucketCapacity: 600,
    });
    expect(tbm.maximumCapacity).toBe(600);
  });
});
