import "test/mocks/lz4";
import _ from "lodash";
import test from "ava";
import { Vector3 } from "oxalis/constants";
import { almostEqual } from "test/libs/transform_spec_helpers";
import {
  chainTransforms,
  createAffineTransform,
  invertTransform,
  transformPoint,
} from "oxalis/model/helpers/transformation_helpers";

test("Inverse of matrix should transform points back", async (t) => {
  // This transform essentially computes:
  // coord := coord * 2 + 10
  const target = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
  ] as Vector3[];
  const source = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
  ] as Vector3[];
  const aff1 = createAffineTransform(target, source);
  const aff1Inv = invertTransform(aff1);

  const transform = transformPoint(aff1);
  const transformInv = transformPoint(aff1Inv);

  const epsilon = 0.001;
  almostEqual(t, transform([0, 0, 0]), [10, 10, 10], epsilon);
  almostEqual(t, transform([3, 7, 8]), [16, 24, 26], epsilon);
  almostEqual(t, transform([34, 28, 9]), [78, 66, 28], epsilon);

  almostEqual(t, transformInv([10, 10, 10]), [0, 0, 0], epsilon);
  almostEqual(t, transformInv([16, 24, 26]), [3, 7, 8], epsilon);
  almostEqual(t, transformInv([78, 66, 28]), [34, 28, 9], epsilon);

  const roundtripTransform = chainTransforms(aff1, aff1Inv);
  const transformRoundtrip = transformPoint(roundtripTransform);

  const points = [
    [0, 0, 0],
    [3, 7, 8],
    [34, 28, 9],
    [10, 10, 10],
    [16, 24, 26],
    [78, 66, 28],
  ] as Vector3[];
  for (const p of points) {
    almostEqual(t, transformRoundtrip(p), p, epsilon);
  }
});
