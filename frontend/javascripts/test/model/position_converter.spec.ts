import { describe, it, expect } from "vitest";
import { getBaseBucketsForFallbackBucket } from "oxalis/model/helpers/position_converter";

describe("position_converter", () => {
  it("should calculate base buckets for a given fallback bucket (isotropic)", () => {
    const bucketAddresses = getBaseBucketsForFallbackBucket([1, 2, 3, 1], 1, [
      [1, 1, 1],
      [2, 2, 2],
      [4, 4, 4],
      [8, 8, 8],
    ]);
    const expectedBucketAddresses = [
      [2, 4, 6, 0],
      [2, 4, 7, 0],
      [2, 5, 6, 0],
      [2, 5, 7, 0],
      [3, 4, 6, 0],
      [3, 4, 7, 0],
      [3, 5, 6, 0],
      [3, 5, 7, 0],
    ];
    expect(bucketAddresses).toEqual(expectedBucketAddresses);
  });

  it("should calculate base buckets for a given fallback bucket (anisotropic)", () => {
    const bucketAddresses = getBaseBucketsForFallbackBucket([1, 2, 3, 1], 1, [
      [1, 1, 1],
      [2, 2, 1],
      [4, 4, 4],
      [8, 8, 8],
    ]);
    const expectedBucketAddresses = [
      [2, 4, 3, 0],
      [2, 5, 3, 0],
      [3, 4, 3, 0],
      [3, 5, 3, 0],
    ];
    expect(bucketAddresses).toEqual(expectedBucketAddresses);
  });
});
