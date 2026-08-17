import { almostEqual } from "test/libs/transform_spec_helpers";
import type { Vector3 } from "viewer/constants";
import {
  buildLiveTransforms,
  combineCoordinateTransformations,
  EXPECTED_LIVE_TRANSFORMATION_LENGTH,
  extractPivotFromTransforms,
  extractSRTFromTransforms,
  hasValidLiveTransformationPattern,
  rebaseTranslationToPivot,
  type SRTValues,
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

  it("should rebase the pivot without changing the resulting transform", () => {
    // Covers the composite-equality requirement: the two chains must agree as maps, including for
    // a rotation that is not aligned with the (non-uniform) scale axes.
    const srt: SRTValues = {
      scale: [2, 0.5, 3],
      rotation: [17, 231, 94],
      translation: [10, -20, 30],
    };
    const oldPivot: Vector3 = [1000, 2000, 3000];
    const newPivot: Vector3 = [-40, 15, 700];

    const rebased = {
      ...srt,
      translation: rebaseTranslationToPivot(srt, oldPivot, newPivot),
    };
    const before = combineCoordinateTransformations(
      buildLiveTransforms(srt.scale, srt.rotation, srt.translation, oldPivot),
      [1, 1, 1],
    );
    const after = combineCoordinateTransformations(
      buildLiveTransforms(rebased.scale, rebased.rotation, rebased.translation, newPivot),
      [1, 1, 1],
    );

    for (const point of [[0, 0, 0], [1, 2, 3], oldPivot, newPivot, [-512, 4096, 77]] as Vector3[]) {
      almostEqual(
        expect,
        transformPointUnscaled(before)(point),
        transformPointUnscaled(after)(point),
        1e-6,
      );
    }
  });

  it("should preserve the composite transform for randomized parameters", () => {
    // Deterministic pseudo random numbers, so that a failure is always reproducible.
    let seed = 20260817;
    const random = (min: number, max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return min + (seed / 2147483648) * (max - min);
    };
    const randomVector = (min: number, max: number): Vector3 => [
      random(min, max),
      random(min, max),
      random(min, max),
    ];

    for (let run = 0; run < 50; run++) {
      const srt: SRTValues = {
        scale: randomVector(0.1, 5),
        rotation: randomVector(0, 360),
        translation: randomVector(-500, 500),
      };
      const oldPivot = randomVector(-5000, 5000);
      const newPivot = randomVector(-5000, 5000);

      const before = combineCoordinateTransformations(
        buildLiveTransforms(srt.scale, srt.rotation, srt.translation, oldPivot),
        [1, 1, 1],
      );
      const after = combineCoordinateTransformations(
        buildLiveTransforms(
          srt.scale,
          srt.rotation,
          rebaseTranslationToPivot(srt, oldPivot, newPivot),
          newPivot,
        ),
        [1, 1, 1],
      );

      for (const point of [randomVector(-1000, 1000), oldPivot, newPivot]) {
        almostEqual(
          expect,
          transformPointUnscaled(before)(point),
          transformPointUnscaled(after)(point),
          1e-6,
        );
      }
    }
  });

  it("should leave the translation untouched when the pivot does not change", () => {
    const srt: SRTValues = { scale: [2, 3, 4], rotation: [10, 20, 30], translation: [5, 6, 7] };

    expect(rebaseTranslationToPivot(srt, PIVOT, PIVOT)).toEqual([5, 6, 7]);
  });

  it("should leave the translation untouched for a pure translation", () => {
    // With an identity linear part the pivot is irrelevant.
    const srt: SRTValues = { scale: [1, 1, 1], rotation: [0, 0, 0], translation: [5, 6, 7] };

    almostEqual(expect, rebaseTranslationToPivot(srt, [1, 2, 3], [400, -5, 60]), [5, 6, 7], 1e-9);
  });

  it("should yield (I - A) * p for the classic offset case", () => {
    // t = 0 and the new pivot at the origin, with a pure scaling: t' = p - A p = p * (1 - scale).
    const srt: SRTValues = { scale: [3, 3, 3], rotation: [0, 0, 0], translation: [0, 0, 0] };
    const p: Vector3 = [100, 200, 300];

    almostEqual(expect, rebaseTranslationToPivot(srt, p, [0, 0, 0]), [-200, -400, -600], 1e-9);
  });

  it("should round-trip when rebasing back to the original pivot", () => {
    const srt: SRTValues = { scale: [2, 0.5, 3], rotation: [17, 231, 94], translation: [1, 2, 3] };
    const other: Vector3 = [-40, 15, 700];

    const there = { ...srt, translation: rebaseTranslationToPivot(srt, PIVOT, other) };
    const back = rebaseTranslationToPivot(there, other, PIVOT);

    almostEqual(expect, back, srt.translation, 1e-9);
  });

  it("should handle a degenerate scale, where the linear part is singular", () => {
    const srt: SRTValues = { scale: [0, 2, 2], rotation: [0, 0, 0], translation: [0, 0, 0] };
    const p: Vector3 = [100, 200, 300];

    const rebased = rebaseTranslationToPivot(srt, p, [0, 0, 0]);

    // x is scaled by 0, so (I - A) p keeps the full 100 on that axis.
    almostEqual(expect, rebased, [100, -200, -300], 1e-9);
    expect(rebased.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("should reject transform lists that do not match the editable pattern", () => {
    expect(hasValidLiveTransformationPattern(null)).toBe(true);
    expect(hasValidLiveTransformationPattern([])).toBe(true);

    const transforms = buildLiveTransforms([1, 1, 1], [0, 0, 0], [0, 0, 0], PIVOT);
    expect(hasValidLiveTransformationPattern(transforms.slice(0, 5))).toBe(false);
    expect(extractPivotFromTransforms(transforms.slice(0, 5))).toBeNull();
  });
});
