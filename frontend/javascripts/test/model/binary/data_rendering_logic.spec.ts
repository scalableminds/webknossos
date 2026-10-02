import range from "lodash-es/range";
import type { ElementClass } from "types/api_types";
import constants, { getEffectiveBucketDepth, usesTRecycling } from "viewer/constants";
import {
  computeLayerPoolAssignments,
  computeLayerPoolPlan,
  getBucketCapacity,
  getBucketCountSoftLimitPerLayer,
  getBucketHeightInTexture,
  getGpuBucketVoxelCountForLayer,
  getRequiredBucketCapacityPerLayer,
  LayerPool,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { describe, expect, it } from "vitest";

const { GPU_FACTOR_MULTIPLIER, DEFAULT_GPU_MEMORY_FACTOR } = constants;
const DEFAULT_REQUIRED_BUCKET_CAPACITY = GPU_FACTOR_MULTIPLIER * DEFAULT_GPU_MEMORY_FACTOR;

describe("2D (degenerate-depth) layer bucket sizing", () => {
  it("getEffectiveBucketDepth shrinks only non-editable degenerate-depth layers", () => {
    expect(getEffectiveBucketDepth(1, false)).toBe(1);
    expect(getEffectiveBucketDepth(0, false)).toBe(1);
    expect(getEffectiveBucketDepth(2, false)).toBe(constants.BUCKET_WIDTH);
    expect(getEffectiveBucketDepth(1000, false)).toBe(constants.BUCKET_WIDTH);
    // An editable layer's buckets are sent back to the tracingstore, whose storage format
    // is fixed at bucketLength^3, so they must keep the full depth.
    expect(getEffectiveBucketDepth(1, true)).toBe(constants.BUCKET_WIDTH);
    expect(getEffectiveBucketDepth(1000, true)).toBe(constants.BUCKET_WIDTH);
  });

  it("a 2D layer needs fewer pool slices than a regular layer", () => {
    const layer = {
      name: "a",
      elementClass: "uint8" as const,
      category: "color" as const,
      additionalAxes: null,
    };
    const slicesFor = (depth: number) =>
      computeLayerPoolAssignments(
        [{ ...layer, boundingBox: { depth } }],
        DEFAULT_REQUIRED_BUCKET_CAPACITY,
      ).poolDepths[LayerPool.U8];
    expect(slicesFor(1)).toBeLessThan(slicesFor(1000));
  });

  it("getBucketHeightInTexture clamps to a whole row when a bucket is smaller than the texture width", () => {
    const packingDegree = 4; // uint8
    const twoDBucketVoxelCount = 32 * 32 * 1;
    // packedBucketSize = 1024 / 4 = 256, well below a typical texture width.
    expect(getBucketHeightInTexture(2048, packingDegree, twoDBucketVoxelCount)).toBe(1);
    // The non-shrunk case stays unclamped (packedBucketSize = 8192 >= 4096).
    expect(getBucketHeightInTexture(4096, packingDegree, constants.BUCKET_SIZE)).toBe(2);
  });

  it("reserves enough pool slices for requiredBucketCapacity buckets, despite whole-row padding", () => {
    for (const elementClass of ["uint8", "uint16", "uint32", "uint64"] as ElementClass[]) {
      for (const depth of [1, 1000]) {
        for (const requiredBucketCapacity of [512, 1024, DEFAULT_REQUIRED_BUCKET_CAPACITY]) {
          const { assignmentByLayerName } = computeLayerPoolAssignments(
            [
              {
                name: "a",
                elementClass,
                category: "color",
                boundingBox: { depth },
                additionalAxes: null,
              },
            ],
            requiredBucketCapacity,
          );
          const { dataTextureCount, bucketsPerSlice } = assignmentByLayerName.get("a")!;
          expect(
            dataTextureCount * bucketsPerSlice,
            `${elementClass}, depth=${depth}, required=${requiredBucketCapacity}`,
          ).toBeGreaterThanOrEqual(requiredBucketCapacity);
        }
      }
    }
  });

  it("usesTRecycling requires a degenerate depth, a t axis, and a non-editable layer", () => {
    // The happy case: 2D + t, read-only.
    expect(usesTRecycling(1, true, false)).toBe(true);
    // A real z extent leaves no dimension to recycle.
    expect(usesTRecycling(1000, true, false)).toBe(false);
    // Without a t axis there is nothing to cache; the plain shrink applies instead.
    expect(usesTRecycling(1, false, false)).toBe(false);
    // An editable (volume tracing) layer's locally created data has no shared batch
    // buffer to render a whole batch out of, so it must keep one bucket per t.
    expect(usesTRecycling(1, true, true)).toBe(false);
  });

  it("getGpuBucketVoxelCountForLayer uses full-depth buckets only for t-recycling layers", () => {
    const shrunkBucketVoxelCount = constants.BUCKET_SIZE_2D;
    const tAxis = [{ name: "t", bounds: [0, 100] as [number, number], index: 3 }];
    const base = { elementClass: "uint8" as const, category: "color" as const };
    // 2D + t, read-only: recycles, so the GPU keeps the full bucket footprint.
    expect(
      getGpuBucketVoxelCountForLayer({ ...base, boundingBox: { depth: 1 }, additionalAxes: tAxis }),
    ).toBe(constants.BUCKET_SIZE);
    // 2D + t, but editable: neither t-recycling nor the shrink applies, because its buckets
    // are sent back to the tracingstore at the full bucketLength^3.
    expect(
      getGpuBucketVoxelCountForLayer({
        ...base,
        category: "segmentation" as const,
        boundingBox: { depth: 1 },
        additionalAxes: tAxis,
        tracingId: "some-tracing-id",
      }),
    ).toBe(constants.BUCKET_SIZE);
    // Plain 2D, editable: same reason, no shrink.
    expect(
      getGpuBucketVoxelCountForLayer({
        ...base,
        category: "segmentation" as const,
        boundingBox: { depth: 1 },
        additionalAxes: null,
        tracingId: "some-tracing-id",
      }),
    ).toBe(constants.BUCKET_SIZE);
    // 2D without a t axis, read-only: plain shrink.
    expect(
      getGpuBucketVoxelCountForLayer({ ...base, boundingBox: { depth: 1 }, additionalAxes: null }),
    ).toBe(shrunkBucketVoxelCount);
    // Ordinary 3D layer: unchanged.
    expect(
      getGpuBucketVoxelCountForLayer({
        ...base,
        boundingBox: { depth: 1000 },
        additionalAxes: tAxis,
      }),
    ).toBe(constants.BUCKET_SIZE);
  });

  it("getBucketCapacity accounts for whole-row clamping so the reported capacity matches the real, addressable atlas space", () => {
    const packingDegree = 4;
    const twoDBucketVoxelCount = 32 * 32 * 1;
    const textureWidth = 2048;
    const capacity = getBucketCapacity(1, textureWidth, packingDegree, twoDBucketVoxelCount);
    // With clamping, each bucket occupies one full row, so capacity is bounded by
    // the number of rows (textureWidth), not by the much larger naive division
    // (textureWidth**2 / packedBucketSize = 16_384).
    expect(capacity).toBe(textureWidth);
  });
});

describe("getRequiredBucketCapacityPerLayer", () => {
  it("is unchanged for up to 4 layers", () => {
    expect(getRequiredBucketCapacityPerLayer(DEFAULT_GPU_MEMORY_FACTOR, 1)).toBe(
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
    expect(getRequiredBucketCapacityPerLayer(DEFAULT_GPU_MEMORY_FACTOR, 4)).toBe(
      DEFAULT_REQUIRED_BUCKET_CAPACITY,
    );
  });

  it("splits the budget of 4 layers across more layers", () => {
    expect(getRequiredBucketCapacityPerLayer(DEFAULT_GPU_MEMORY_FACTOR, 20)).toBe(
      Math.floor((DEFAULT_REQUIRED_BUCKET_CAPACITY * 4) / 20),
    );
  });

  it("never exceeds the RAM limit per layer", () => {
    for (const gpuFactor of [1, 2, 4, 6, 12, 16]) {
      for (const layerCount of [1, 4, 5, 20, 100]) {
        expect(getRequiredBucketCapacityPerLayer(gpuFactor, layerCount)).toBeLessThanOrEqual(
          getBucketCountSoftLimitPerLayer(layerCount),
        );
      }
    }
  });
});

describe("computeLayerPoolPlan", () => {
  // At the "Ultra" GPU setting, a uint64 layer needs 79 slices, so four of
  // them (all in the U8 pool) need 316.
  const uint64Layers = range(4).map((i) => ({
    name: `segmentation_${i}`,
    elementClass: "uint64" as ElementClass,
    category: "segmentation" as const,
    boundingBox: { depth: 1000 },
    additionalAxes: null,
  }));
  const ultraCapacity = getRequiredBucketCapacityPerLayer(16, uint64Layers.length);

  it("keeps the capacity if all pools fit", () => {
    const plan = computeLayerPoolPlan(uint64Layers, ultraCapacity, 2048);
    expect(plan.bucketCapacity).toBe(ultraCapacity);
    expect(Math.max(...Object.values(plan.poolDepths))).toBe(316);
  });

  it("lowers the capacity until the deepest pool fits", () => {
    const plan = computeLayerPoolPlan(uint64Layers, ultraCapacity, 256);
    expect(plan.bucketCapacity).toBeLessThan(ultraCapacity);
    expect(Math.max(...Object.values(plan.poolDepths))).toBeLessThanOrEqual(256);
  });

  it("lowers the capacity until every bucket address fits into 21 bits", () => {
    // A 2D uint8 layer (2048 buckets per slice) placed behind a deep uint64 layer.
    const layers = [
      { ...uint64Layers[0], name: "deep" },
      {
        name: "flat",
        elementClass: "uint8" as ElementClass,
        category: "color" as const,
        boundingBox: { depth: 1 },
        additionalAxes: null,
      },
    ];
    const requiredBucketCapacity = 70000;
    const plan = computeLayerPoolPlan(layers, requiredBucketCapacity, 4096);
    expect(plan.bucketCapacity).toBeLessThan(requiredBucketCapacity);
    for (const {
      baseSlice,
      dataTextureCount,
      bucketsPerSlice,
    } of plan.assignmentByLayerName.values()) {
      expect((baseSlice + dataTextureCount) * bucketsPerSlice).toBeLessThanOrEqual(2 ** 21 - 1);
    }
  });
});
