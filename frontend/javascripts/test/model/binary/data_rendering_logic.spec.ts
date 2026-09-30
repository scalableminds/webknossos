import range from "lodash-es/range";
import type { ElementClass } from "types/api_types";
import constants from "viewer/constants";
import {
  computeLayerPoolPlan,
  getBucketCountSoftLimitPerLayer,
  getRequiredBucketCapacityPerLayer,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { describe, expect, it } from "vitest";

const { GPU_FACTOR_MULTIPLIER, DEFAULT_GPU_MEMORY_FACTOR } = constants;
const DEFAULT_REQUIRED_BUCKET_CAPACITY = GPU_FACTOR_MULTIPLIER * DEFAULT_GPU_MEMORY_FACTOR;
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
});
