import "../mocks/lz4";
import { describe, it, expect } from "vitest";
import type { Vector3 } from "oxalis/constants";
import Matrix from "ml-matrix";
import estimateAffine, { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { almostEqual, getPointsC555 } from "./transform_spec_helpers";
import { M4x4 } from "libs/mjs";

describe("Estimate Affine", () => {
  it("Estimate affine projection", () => {
    const [sourcePoints, targetPoints] = getPointsC555();
    const affineMatrix = estimateAffine(sourcePoints, targetPoints);

    const transform = (x: number, y: number, z: number) => {
      const vec = new Matrix([[x, y, z, 1]]).transpose();
      const transformed = affineMatrix.mmul(vec);
      return transformed.to1DArray() as Vector3;
    };

    almostEqual(
      expect,
      [568.1202797015036, 528.013612246682, 1622.1124501555569],
      transform(570.3021, 404.5549, 502.22482),
      5,
    );
    almostEqual(
      expect,
      [1574.679455809381, 1607.1773268624395, 1791.5425120096843],
      transform(500, 501, 502),
      5,
    );
  });

  it("Estimate affine projection should make sense with M4x4 as well as Matrix", async () => {
    // This transform essentially computes:
    // coord := coord * 2 + 10
    const source = [
      [0, 0, 0],
      [10, 10, 10],
      [10, 10, 0],
      [5, 10, 15],
    ] as Vector3[];
    const target = [
      [10, 10, 10],
      [30, 30, 30],
      [30, 30, 10],
      [20, 30, 40],
    ] as Vector3[];
    const aff1 = estimateAffineMatrix4x4(source, target);
    const aff2 = estimateAffine(source, target);

    const transform = (pos: Vector3) => M4x4.transformVectorsAffine(M4x4.transpose(aff1), [pos])[0];
    const transform2 = ([x, y, z]: Vector3) => {
      const vec = new Matrix([[x, y, z, 1]]).transpose();
      const transformed = aff2.mmul(vec);
      return transformed.to1DArray().slice(0, 3) as Vector3;
    };

    const epsilon = 0.001;
    almostEqual(expect, transform([0, 0, 0]), [10, 10, 10], epsilon);
    almostEqual(expect, transform([3, 7, 8]), [16, 24, 26], epsilon);
    almostEqual(expect, transform([34, 28, 9]), [78, 66, 28], epsilon);

    almostEqual(expect, transform2([0, 0, 0]), [10, 10, 10], epsilon);
    almostEqual(expect, transform2([3, 7, 8]), [16, 24, 26], epsilon);
    almostEqual(expect, transform2([34, 28, 9]), [78, 66, 28], epsilon);
  });
});
