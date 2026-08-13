import { almostEqual } from "test/libs/transform_spec_helpers";
import type { Vector3 } from "viewer/constants";
import {
  buildLiveTransforms,
  combineCoordinateTransformations,
  EXPECTED_LIVE_TRANSFORMATION_LENGTH,
  extractPivotFromTransforms,
  extractSRTFromTransforms,
  hasValidLiveTransformationPattern,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { transformPointUnscaled } from "viewer/model/helpers/transformation_helpers";
import { describe, expect, it } from "vitest";

const EPSILON = 0.001;
// The pivot is deliberately far away from the origin so that a wrong pivot is clearly visible.
const PIVOT: Vector3 = [1000, 2000, 3000];

function transformPoint(
  transforms: ReturnType<typeof buildLiveTransforms>,
  point: Vector3,
): Vector3 {
  return transformPointUnscaled(combineCoordinateTransformations(transforms, [1, 1, 1]))(point);
}

describe("Live layer transforms", () => {
  it("should build a transform chain that is recognized as editable", () => {
    const transforms = buildLiveTransforms([2, 1, 0.5], [0, 90, 0], [10, -20, 30], PIVOT);

    expect(transforms).toHaveLength(EXPECTED_LIVE_TRANSFORMATION_LENGTH);
    expect(hasValidLiveTransformationPattern(transforms)).toBe(true);
  });

  it("should round-trip scale, rotation, translation and pivot", () => {
    const scale: [number, number, number] = [2, -1, 0.5];
    const rotation: [number, number, number] = [30, 90, 270];
    const translation: [number, number, number] = [10, -20, 30];

    const transforms = buildLiveTransforms(scale, rotation, translation, PIVOT);
    const srt = extractSRTFromTransforms(transforms);

    almostEqual(expect, srt.scale, scale, EPSILON);
    almostEqual(expect, srt.rotation, rotation, EPSILON);
    almostEqual(expect, srt.translation, translation, EPSILON);
    almostEqual(expect, extractPivotFromTransforms(transforms) as Vector3, PIVOT, EPSILON);
  });

  it("should keep the pivot fixed when rotating", () => {
    const transforms = buildLiveTransforms([1, 1, 1], [0, 0, 90], [0, 0, 0], PIVOT);

    almostEqual(expect, transformPoint(transforms, PIVOT), PIVOT, EPSILON);
  });

  it("should keep the pivot fixed when scaling", () => {
    const transforms = buildLiveTransforms([2, 3, 4], [0, 0, 0], [0, 0, 0], PIVOT);

    almostEqual(expect, transformPoint(transforms, PIVOT), PIVOT, EPSILON);
  });

  it("should rotate a point around the pivot and not around the coordinate origin", () => {
    // A 90° rotation around z maps a point that is offset by +100 in x to an offset of +100 in y
    // (or -100, depending on the handedness) relative to the pivot – but it must stay at distance
    // 100 from the pivot and must not be flung across the dataset.
    const transforms = buildLiveTransforms([1, 1, 1], [0, 0, 90], [0, 0, 0], PIVOT);
    const point: Vector3 = [PIVOT[0] + 100, PIVOT[1], PIVOT[2]];

    const [x, y, z] = transformPoint(transforms, point);

    expect(Math.abs(x - PIVOT[0])).toBeLessThan(EPSILON);
    expect(Math.abs(Math.abs(y - PIVOT[1]) - 100)).toBeLessThan(EPSILON);
    expect(Math.abs(z - PIVOT[2])).toBeLessThan(EPSILON);
  });

  it("should apply the translation independently of the pivot", () => {
    const translation: [number, number, number] = [10, -20, 30];
    const withPivot = buildLiveTransforms([1, 1, 1], [0, 0, 0], translation, PIVOT);
    const withoutPivot = buildLiveTransforms([1, 1, 1], [0, 0, 0], translation, [0, 0, 0]);
    const point: Vector3 = [1, 2, 3];

    const expected: Vector3 = [
      point[0] + translation[0],
      point[1] + translation[1],
      point[2] + translation[2],
    ];
    almostEqual(expect, transformPoint(withPivot, point), expected, EPSILON);
    almostEqual(expect, transformPoint(withoutPivot, point), expected, EPSILON);
  });

  it("should reject transform lists that do not match the editable pattern", () => {
    expect(hasValidLiveTransformationPattern(null)).toBe(true);
    expect(hasValidLiveTransformationPattern([])).toBe(true);

    const transforms = buildLiveTransforms([1, 1, 1], [0, 0, 0], [0, 0, 0], PIVOT);
    expect(hasValidLiveTransformationPattern(transforms.slice(0, 5))).toBe(false);
    expect(extractPivotFromTransforms(transforms.slice(0, 5))).toBeNull();
  });
});
