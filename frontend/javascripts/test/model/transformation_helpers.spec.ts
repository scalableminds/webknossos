import "test/mocks/lz4";
import test from "ava";
import type { Vector3 } from "oxalis/constants";
import { almostEqual } from "test/libs/transform_spec_helpers";
import {
  chainTransforms,
  createAffineTransform,
  createThinPlateSplineTransform,
  invertTransform,
  transformPointUnscaled,
} from "oxalis/model/helpers/transformation_helpers";

const EPSILON = 0.001;

//

test("Inverse of affine should transform points back (also tests chaining)", async (t) => {
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
  const aff1 = createAffineTransform(source, target);
  const aff1Inv = invertTransform(aff1);

  const transform = transformPointUnscaled(aff1);
  const transformInv = transformPointUnscaled(aff1Inv);

  almostEqual(t, transform([0, 0, 0]), [10, 10, 10], EPSILON);
  almostEqual(t, transform([3, 7, 8]), [16, 24, 26], EPSILON);
  almostEqual(t, transform([34, 28, 9]), [78, 66, 28], EPSILON);

  almostEqual(t, transformInv([10, 10, 10]), [0, 0, 0], EPSILON);
  almostEqual(t, transformInv([16, 24, 26]), [3, 7, 8], EPSILON);
  almostEqual(t, transformInv([78, 66, 28]), [34, 28, 9], EPSILON);

  const roundtripTransform = chainTransforms(aff1, aff1Inv);
  const transformRoundtrip = transformPointUnscaled(roundtripTransform);

  const points = [
    [0, 0, 0],
    [3, 7, 8],
    [34, 28, 9],
    [10, 10, 10],
    [16, 24, 26],
    [78, 66, 28],
  ] as Vector3[];
  for (const p of points) {
    almostEqual(t, transformRoundtrip(p), p, EPSILON);
  }
});

test("Inverse of TPS should transform points back (also tests chaining)", async (t) => {
  // This transform is similar to:
  // coord := coord * 2 + 10
  // in the area of the following inputs. however, is biased so that (100, 50, 25) transforms to 90, 40, 15
  const source = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
    [100, 50, 25],
  ] as Vector3[];
  const target = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
    [90, 40, 15],
  ] as Vector3[];
  const tps1 = createThinPlateSplineTransform(source, target, [1, 1, 1]);
  const tps1Inv = invertTransform(tps1);

  const transform = transformPointUnscaled(tps1);
  const transformInv = transformPointUnscaled(tps1Inv);
  const roundtripTransform = chainTransforms(tps1, tps1Inv);
  const transformRoundtrip = transformPointUnscaled(roundtripTransform);

  for (let idx = 0; idx < source.length; idx++) {
    almostEqual(t, transform(source[idx]), target[idx], EPSILON);
    almostEqual(t, transformInv(target[idx]), source[idx], EPSILON);
    almostEqual(t, transformRoundtrip(target[idx]), target[idx], EPSILON);
    almostEqual(t, transformRoundtrip(source[idx]), source[idx], EPSILON);
  }

  const points = [
    [0, 0, 0],
    [3, 7, 8],
    [34, 28, 9],
    [10, 10, 10],
    [16, 24, 26],
    [78, 66, 28],
  ] as Vector3[];
  for (const p of points) {
    almostEqual(t, transformRoundtrip(p), p, EPSILON);
  }
});

test("Test correct chaining order with affine + affine", async (t) => {
  // This transform essentially computes:
  // coord := coord * 2 + 10
  const affineSource1 = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
  ] as Vector3[];
  const affineTarget1 = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
  ] as Vector3[];
  const aff1 = createAffineTransform(affineSource1, affineTarget1);

  // This transform essentially computes:
  // coord := coord * 3 + 10
  const affineSource2 = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
  ] as Vector3[];
  const affineTarget2 = [
    [10, 10, 10],
    [40, 40, 40],
    [40, 40, 10],
    [25, 40, 55],
  ] as Vector3[];
  const aff2 = createAffineTransform(affineSource2, affineTarget2);
  const transform12 = transformPointUnscaled(chainTransforms(aff1, aff2));
  const transform21 = transformPointUnscaled(chainTransforms(aff2, aff1));

  almostEqual(t, transform12([10, 10, 10]), [100, 100, 100], EPSILON);
  almostEqual(t, transform21([10, 10, 10]), [90, 90, 90], EPSILON);
});

test("Test correct chaining order with TPS + TPS", async (t) => {
  // This transform is similar to:
  // coord := coord * 2 + 10
  // in the area of the following inputs. however, is biased so that (100, 50, 25) transforms to 90, 40, 15
  const source1 = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
    [100, 50, 25],
  ] as Vector3[];
  const target1 = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
    [90, 40, 15],
  ] as Vector3[];
  const tps1 = createThinPlateSplineTransform(source1, target1, [1, 1, 1]);

  // This transform is similar to:
  // coord := coord * 3 + 10
  // in the area of the following inputs. however, is biased so that (100, 50, 25) transforms to 90, 40, 15
  const source2 = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
    [90, 40, 15],
  ] as Vector3[];
  const target2 = [
    [40, 40, 40],
    [100, 100, 100],
    [100, 100, 40],
    [70, 100, 130],
    [280, 130, 55],
  ] as Vector3[];
  const tps2 = createThinPlateSplineTransform(source2, target2, [1, 1, 1]);

  const transform12 = transformPointUnscaled(chainTransforms(tps1, tps2));

  almostEqual(t, transform12([0, 0, 0]), [40, 40, 40], EPSILON);
});

test("Test chaining affine with TPS", async (t) => {
  // This transform essentially computes:
  // coord := coord * 2 + 10
  const affineSource = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
  ] as Vector3[];
  const affineTarget = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
  ] as Vector3[];
  const aff = createAffineTransform(affineSource, affineTarget);

  // This transform is similar to:
  // coord := (coord - 10) / 2
  // in the area of the following inputs. however, is biased so that 90, 40, 15 transforms to 100, 50, 25
  const source = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
    [90, 40, 15],
  ] as Vector3[];
  const target = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
    [100, 50, 25],
  ] as Vector3[];
  const tps = createThinPlateSplineTransform(source, target, [1, 1, 1]);

  const transformA = transformPointUnscaled(aff);
  const transformB = transformPointUnscaled(tps);
  const transformAB = transformPointUnscaled(chainTransforms(aff, tps));
  // Test chaining for 0, 0, 0 -> 10, 10, 10 -> 0, 0, 0
  almostEqual(t, transformA([0, 0, 0]), [10, 10, 10], EPSILON);
  almostEqual(t, transformB([10, 10, 10]), [0, 0, 0], EPSILON);
  almostEqual(t, transformAB([0, 0, 0]), [0, 0, 0], EPSILON);

  // Test chaining for 5, 10, 15 -> 20, 30, 40 -> 5, 10, 15
  almostEqual(t, transformA([5, 10, 15]), [20, 30, 40], EPSILON);
  almostEqual(t, transformB([20, 30, 40]), [5, 10, 15], EPSILON);
  almostEqual(t, transformAB([5, 10, 15]), [5, 10, 15], EPSILON);
});

test("Test chaining TPS with affine", async (t) => {
  // This transform is similar to:
  // coord := (coord - 10) / 2
  // in the area of the following inputs. however, is biased so that 90, 40, 15 transforms to 100, 50, 25
  const source = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
    [90, 40, 15],
  ] as Vector3[];
  const target = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
    [100, 50, 25],
  ] as Vector3[];
  const tps = createThinPlateSplineTransform(source, target, [1, 1, 1]);

  // This transform essentially computes:
  // coord := coord * 2 + 10
  const affineSource = [
    [0, 0, 0],
    [10, 10, 10],
    [10, 10, 0],
    [5, 10, 15],
  ] as Vector3[];
  const affineTarget = [
    [10, 10, 10],
    [30, 30, 30],
    [30, 30, 10],
    [20, 30, 40],
  ] as Vector3[];
  const aff = createAffineTransform(affineSource, affineTarget);

  const transformA = transformPointUnscaled(tps);
  const transformB = transformPointUnscaled(aff);
  const transformAB = transformPointUnscaled(chainTransforms(tps, aff));

  almostEqual(t, transformA([10, 10, 10]), [0, 0, 0], EPSILON);
  almostEqual(t, transformB([0, 0, 0]), [10, 10, 10], EPSILON);
  almostEqual(t, transformAB([10, 10, 10]), [10, 10, 10], EPSILON);

  almostEqual(t, transformA([30, 30, 30]), [10, 10, 10], EPSILON);
  almostEqual(t, transformB([10, 10, 10]), [30, 30, 30], EPSILON);
  almostEqual(t, transformAB([30, 30, 30]), [30, 30, 30], EPSILON);
});
