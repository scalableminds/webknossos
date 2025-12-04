import { describe, it, expect } from "vitest";
import { type BoundingBox2D, estimateBBoxInMask } from "libs/find_bounding_box_in_nd";
import { V3 } from "libs/mjs";
import ndarray from "ndarray";
import type { Vector2, Vector3 } from "viewer/constants";

function prepareMask(size: Vector3, trueBBox: BoundingBox2D) {
  const maskData = new Uint8Array(V3.prod(size));
  const stride = [5120, 5, 1];
  const mask = ndarray(maskData, size, stride);

  for (let x = trueBBox.min[0]; x < trueBBox.max[0]; x += 1) {
    for (let y = trueBBox.min[1]; y < trueBBox.max[1]; y += 1) {
      mask.set(x, y, 0, 1);
    }
  }
  return mask;
}

function isWithinError(a: number, b: number, error: number) {
  return Math.abs(a - b) <= error;
}

function isVec2WithinError(a: Vector2, b: Vector2, error: number) {
  return isWithinError(a[0], b[0], error) && isWithinError(a[1], b[1], error);
}

function isBBox2DWithinError(a: BoundingBox2D, b: BoundingBox2D, error: number) {
  return isVec2WithinError(a.min, b.min, error) && isVec2WithinError(a.max, b.max, error);
}

describe("estimateBBoxInMask", () => {
  it("should correctly estimate bounding box", () => {
    const size = [1024, 1024, 5] as Vector3;
    const trueBBox = {
      min: [500, 400] as Vector2,
      max: [600, 550] as Vector2,
    };
    const mask = prepareMask(size, trueBBox);

    const initialBBox = {
      min: [Math.floor(size[0] / 2), Math.floor(size[1] / 2)] as Vector2,
      max: [Math.floor(size[0] / 2) + 10, Math.floor(size[1] / 2) + 10] as Vector2,
    };

    for (const error of [1, 50, 100]) {
      const estimatedBBox = estimateBBoxInMask(mask, initialBBox, error);
      expect(isBBox2DWithinError(estimatedBBox, trueBBox, error)).toBe(true);
    }
  });

  it("should handle true bounding box touching border", () => {
    const size = [1024, 1024, 5] as Vector3;
    const trueBBox = {
      min: [0, 400] as Vector2,
      max: [600, 550] as Vector2,
    };
    const mask = prepareMask(size, trueBBox);

    const initialBBox = {
      min: [Math.floor(size[0] / 2), Math.floor(size[1] / 2)] as Vector2,
      max: [Math.floor(size[0] / 2) + 10, Math.floor(size[1] / 2) + 10] as Vector2,
    };

    for (const error of [1, 50, 100]) {
      const estimatedBBox = estimateBBoxInMask(mask, initialBBox, error);
      expect(isBBox2DWithinError(estimatedBBox, trueBBox, error)).toBe(true);
    }
  });

  it("should handle case where everything is true", () => {
    const size = [1024, 1024, 5] as Vector3;
    const trueBBox = {
      min: [0, 0] as Vector2,
      max: [1024, 1024] as Vector2,
    };
    const mask = prepareMask(size, trueBBox);

    const initialBBox = {
      min: [Math.floor(size[0] / 2), Math.floor(size[1] / 2)] as Vector2,
      max: [Math.floor(size[0] / 2) + 10, Math.floor(size[1] / 2) + 10] as Vector2,
    };

    for (const error of [1, 50, 100]) {
      const estimatedBBox = estimateBBoxInMask(mask, initialBBox, error);
      expect(isBBox2DWithinError(estimatedBBox, trueBBox, error)).toBe(true);
    }
  });
});
