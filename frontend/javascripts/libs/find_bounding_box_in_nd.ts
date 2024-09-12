import { V2 } from "libs/mjs";
import type { NdArray } from "ndarray";
import type { Vector2 } from "oxalis/constants";

/* This module provides a function to find a 2D axis-aligned bounding box
 * around data within a binary mask (NdArray).
 *
 * estimateBBoxInMask is an approximative and fast algorithm that takes an initial
 * bounding box and grows that box until the borders of it don't contain
 * 1s in the mask. The bounding box is grown by ${maxError} pixels in each
 * iteration. In comparison to the precise algorithm, it is multiple orders of
 * magnitude faster (for a 1024x1024x5 mask with a max error of 100, it is 100 to 200 times
 * faster).
 */

export type BoundingBox2D = {
  min: Vector2;
  max: Vector2; // exclusive
};

export function estimateBBoxInMask(mask: NdArray, initialBBox: BoundingBox2D, maxError: number) {
  let currentBBox = { min: V2.clone(initialBBox.min), max: V2.clone(initialBBox.max) };
  while (true) {
    const [top, right, bottom, left] = hasTrueOnBorder(mask, currentBBox);
    let changed = false;
    if (left && currentBBox.min[0] > 0) {
      currentBBox.min[0] = Math.max(0, currentBBox.min[0] - maxError);
      changed = true;
    }
    if (top && currentBBox.min[1] > 0) {
      currentBBox.min[1] = Math.max(0, currentBBox.min[1] - maxError);
      changed = true;
    }
    if (right && currentBBox.max[0] < mask.shape[0]) {
      currentBBox.max[0] = Math.min(mask.shape[0], currentBBox.max[0] + maxError);
      changed = true;
    }
    if (bottom && currentBBox.max[1] < mask.shape[1]) {
      currentBBox.max[1] = Math.min(mask.shape[1], currentBBox.max[1] + maxError);
      changed = true;
    }

    if (!changed) {
      return currentBBox;
    }
  }
}

// Only exported for tests
export function hasTrueOnBorder(mask: NdArray, initialBBox: BoundingBox2D) {
  let u, v;
  let top = false;
  let right = false;
  let bottom = false;
  let left = false;

  // top
  for (u = initialBBox.min[0]; u < initialBBox.max[0]; u++) {
    if (mask.get(u, initialBBox.min[1], 0) > 0) {
      top = true;
      break;
    }
  }
  // bottom
  for (u = initialBBox.min[0]; u < initialBBox.max[0]; u++) {
    if (mask.get(u, initialBBox.max[1], 0) > 0) {
      bottom = true;
      break;
    }
  }
  // right
  for (v = initialBBox.min[1]; v < initialBBox.max[1]; v++) {
    if (mask.get(initialBBox.max[0], v, 0) > 0) {
      right = true;
      break;
    }
  }
  // left
  for (v = initialBBox.min[1]; v < initialBBox.max[1]; v++) {
    if (mask.get(initialBBox.min[0], v, 0) > 0) {
      left = true;
      break;
    }
  }

  return [top, right, bottom, left];
}
