import estimateAffine from "libs/estimate_affine";
import { M4x4 } from "libs/mjs";
import TPS3D from "libs/thin_plate_spline";
import { Matrix4x4 } from "mjs";
import { Vector3 } from "oxalis/constants";

export type Transform =
  | { type: "affine"; affineMatrix: Matrix4x4 }
  | {
      type: "thin_plate_spline";
      affineMatrix: Matrix4x4;
      // Store the inverse directly to avoid potential loss of quality
      // due to later inversions
      affineMatrixInv: Matrix4x4;
      scaledTpsInv: TPS3D;
      scaledTps: TPS3D;
    };

export function createThinPlateSplineTransform(
  source: Vector3[],
  target: Vector3[],
  scale: Vector3,
): Transform {
  const affineMatrix = estimateAffine(source, target).to1DArray() as any as Matrix4x4;
  const affineMatrixInv = estimateAffine(target, source).to1DArray() as any as Matrix4x4;

  return {
    type: "thin_plate_spline",
    affineMatrix,
    affineMatrixInv,
    scaledTpsInv: new TPS3D(target, source, scale),
    scaledTps: new TPS3D(source, target, scale),
  };
}

export function invertTransform(transforms: Transform): Transform {
  if (transforms.type === "affine") {
    return {
      type: "affine",
      affineMatrix: M4x4.inverse(transforms.affineMatrix),
    };
  }

  return {
    type: "thin_plate_spline",
    affineMatrix: transforms.affineMatrixInv,
    affineMatrixInv: transforms.affineMatrix,
    scaledTpsInv: transforms.scaledTps,
    scaledTps: transforms.scaledTpsInv,
  };
}

export function chainTransforms(
  transformsA: Transform | null,
  transformsB: Transform,
): Transform | null {
  /*
   * This function applies transformsB on top of an nullable transformsA.
   */
  if (transformsA == null) {
    return transformsB;
  }

  if (transformsA.type === "affine" && transformsB.type === "affine") {
    return {
      type: "affine",
      affineMatrix: M4x4.mul(transformsA.affineMatrix, transformsB.affineMatrix),
    };
  }

  if (transformsA.type === "thin_plate_spline" && transformsB.type === "thin_plate_spline") {
    const sourcePointsA = transformsA.scaledTps.unscaledSourcePoints;
    const targetPointsA = transformsA.scaledTps.unscaledTargetPoints;

    const transformedTargetPointsA = targetPointsA.map((point) =>
      transformsB.scaledTps.transform(...point),
    );

    return createThinPlateSplineTransform(
      sourcePointsA,
      transformedTargetPointsA,
      transformsA.scaledTps.scale,
    );
  }

  if (transformsA.type === "thin_plate_spline" && transformsB.type === "affine") {
    const sourcePointsA = transformsA.scaledTps.unscaledSourcePoints;
    const targetPointsA = transformsA.scaledTps.unscaledTargetPoints;

    const transformedTargetPointsA = M4x4.transformVectorsAffine(
      transformsB.affineMatrix,
      targetPointsA,
    );

    return createThinPlateSplineTransform(
      sourcePointsA,
      transformedTargetPointsA,
      transformsA.scaledTps.scale,
    );
  }

  if (transformsA.type === "affine" && transformsB.type === "thin_plate_spline") {
    const sourcePointsB = transformsB.scaledTps.unscaledSourcePoints;
    const targetPointsB = transformsB.scaledTps.unscaledTargetPoints;

    const transformedSourcePointsB = M4x4.transformVectorsAffine(
      M4x4.inverse(transformsA.affineMatrix),
      sourcePointsB,
    );

    return createThinPlateSplineTransform(
      transformedSourcePointsB,
      targetPointsB,
      transformsB.scaledTps.scale,
    );
  }

  throw new Error(
    `Unhandled combination of transform types: ${transformsA.type}, ${transformsB.type}`,
  );
}
