import estimateAffine, {
  estimateAffineMatrix4x4,
  estimateAffineMatrixFromLandmarks,
} from "libs/estimate_affine";
import { M4x4 } from "libs/mjs";
import Matrix from "ml-matrix";
import type { Vector3 } from "viewer/constants";
import { describe, expect, it } from "vitest";
import { almostEqual, getPointsC555 } from "./transform_spec_helpers";

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

  it("Estimate affine matrix from landmarks in a single slice", () => {
    // The source points lie in the y slice 2, the target points in the y slice 5.
    const sourcePoints: Vector3[] = [
      [0, 2, 0],
      [10, 2, 0],
      [0, 2, 10],
      [10, 2, 10],
    ];
    const targetPoints = sourcePoints.map(([x, y, z]): Vector3 => [3 * x + 1, y + 3, z]);
    const estimation = estimateAffineMatrixFromLandmarks(sourcePoints, targetPoints);

    expect(estimation?.singleSlice).toEqual({ axis: 1, sourceCoordinate: 2, targetCoordinate: 5 });
    expect(estimation?.meanError).toBeCloseTo(0, 5);
  });

  it("Estimate no affine matrix from landmarks on one line", () => {
    const points: Vector3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ];
    expect(estimateAffineMatrixFromLandmarks(points, points)).toBeNull();
  });
});
