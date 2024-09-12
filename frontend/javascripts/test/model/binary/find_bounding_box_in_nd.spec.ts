import test, { type ExecutionContext } from "ava";
import { type BoundingBox2D, estimateBBoxInMask } from "libs/find_bounding_box_in_nd";
import { V3 } from "libs/mjs";
import ndarray from "ndarray";
import type { Vector2, Vector3 } from "oxalis/constants";

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

function isWithinError(t: ExecutionContext<any>, a: number, b: number, error: number) {
  t.true(Math.abs(a - b) <= error);
}

function isVec2WithinError(t: ExecutionContext<any>, a: Vector2, b: Vector2, error: number) {
  isWithinError(t, a[0], b[0], error);
}

function isBBox2DWithinError(
  t: ExecutionContext<any>,
  a: BoundingBox2D,
  b: BoundingBox2D,
  error: number,
) {
  isVec2WithinError(t, a.min, b.min, error);
  isVec2WithinError(t, a.max, b.max, error);
}

test("Test estimateBBoxInMask", (t) => {
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
    isBBox2DWithinError(t, estimatedBBox, trueBBox, error);
  }
});

test("Test estimateBBoxInMask: true bounding box touches border", (t) => {
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
    isBBox2DWithinError(t, estimatedBBox, trueBBox, error);
  }
});

test("Test estimateBBoxInMask: everything is true", (t) => {
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
    isBBox2DWithinError(t, estimatedBBox, trueBBox, error);
  }
});
