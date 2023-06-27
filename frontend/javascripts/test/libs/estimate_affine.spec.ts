import "test/mocks/lz4";
import _ from "lodash";
import test from "ava";
import { Vector3 } from "oxalis/constants";
import Matrix from "ml-matrix";
import estimateAffine from "libs/estimate_affine";
import { almostEqual, getPointsC555 } from "./transform_spec_helpers";

test("Estimate affine projection", (t) => {
  const [sourcePoints, targetPoints] = getPointsC555();
  let affineMatrix = estimateAffine(sourcePoints, targetPoints);

  const transform = (x: number, y: number, z: number) => {
    const vec = new Matrix([[x, y, z, 1]]).transpose();
    const transformed = affineMatrix.mmul(vec);
    return transformed.to1DArray() as Vector3;
  };

  almostEqual(
    t,
    [568.1202797015036, 528.013612246682, 1622.1124501555569],
    transform(570.3021, 404.5549, 502.22482),
    5,
  );

  almostEqual(
    t,
    [1574.679455809381, 1607.1773268624395, 1791.5425120096843],
    transform(500, 501, 502),
    5,
  );
});
