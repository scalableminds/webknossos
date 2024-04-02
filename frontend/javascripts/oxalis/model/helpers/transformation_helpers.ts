import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { M4x4 } from "libs/mjs";
import TPS3D from "libs/thin_plate_spline";
import { Matrix4x4 } from "mjs";
import { Vector3, Vector4 } from "oxalis/constants";

export function nestedToFlatMatrix(matrix: [Vector4, Vector4, Vector4, Vector4]): Matrix4x4 {
  return [...matrix[0], ...matrix[1], ...matrix[2], ...matrix[3]];
}

export type Transform =
  | {
      type: "affine";
      affineMatrix: Matrix4x4;
      // Store the inverse directly to avoid potential loss of quality
      // due to later inversions
      affineMatrixInv: Matrix4x4;
    }
  | {
      type: "thin_plate_spline";
      affineMatrix: Matrix4x4;
      // Store the inverse directly to avoid potential loss of quality
      // due to later inversions
      affineMatrixInv: Matrix4x4;
      scaledTpsInv: TPS3D;
      scaledTps: TPS3D;
    };

export function createAffineTransformFromMatrix(
  nestedMatrix: [Vector4, Vector4, Vector4, Vector4],
): Transform {
  const affineMatrix = nestedToFlatMatrix(nestedMatrix);
  return { type: "affine", affineMatrix, affineMatrixInv: M4x4.inverse(affineMatrix) };
}

export function createAffineTransform(source: Vector3[], target: Vector3[]): Transform {
  const affineMatrix = estimateAffineMatrix4x4(source, target);

  return {
    type: "affine",
    affineMatrix,
    affineMatrixInv: M4x4.inverse(affineMatrix),
  };
}

export function createThinPlateSplineTransform(
  source: Vector3[],
  target: Vector3[],
  scale: Vector3,
): Transform {
  const affineMatrix = estimateAffineMatrix4x4(source, target);
  const affineMatrixInv = estimateAffineMatrix4x4(target, source);

  return {
    type: "thin_plate_spline",
    affineMatrix,
    affineMatrixInv,
    scaledTps: new TPS3D(source, target, scale),
    scaledTpsInv: new TPS3D(target, source, scale),
  };
}

export function invertTransform(transforms: Transform): Transform {
  if (transforms.type === "affine") {
    return {
      type: "affine",
      affineMatrix: transforms.affineMatrixInv,
      affineMatrixInv: transforms.affineMatrix,
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

export function chainTransforms(transformsA: Transform | null, transformsB: Transform): Transform {
  /*
   * This function applies transformsB on top of an nullable transformsA. The resulting transform
   * effectively transforms points using transformsA and *then* transformsB.
   */
  if (transformsA == null) {
    return transformsB;
  }

  if (transformsA.type === "affine" && transformsB.type === "affine") {
    return {
      type: "affine",
      affineMatrix: M4x4.mul(transformsA.affineMatrix, transformsB.affineMatrix),
      affineMatrixInv: M4x4.mul(transformsB.affineMatrixInv, transformsA.affineMatrixInv),
    };
  }

  if (transformsA.type === "thin_plate_spline" && transformsB.type === "thin_plate_spline") {
    // Create a new TPS which uses the same source points as A and as target points
    // use these from A but apply transform B on these.
    const sourcePointsA = transformsA.scaledTps.unscaledSourcePoints;
    const targetPointsA = transformsA.scaledTps.unscaledTargetPoints;

    const transformedTargetPointsA = targetPointsA.map((point) =>
      transformsB.scaledTps.transformUnscaled(...point),
    );

    return createThinPlateSplineTransform(
      sourcePointsA,
      transformedTargetPointsA,
      transformsA.scaledTps.scale,
    );
  }

  if (transformsA.type === "thin_plate_spline" && transformsB.type === "affine") {
    // Create a new TPS which uses the same source points as A and as target points
    // use these from A but apply transform B on these.
    const sourcePointsA = transformsA.scaledTps.unscaledSourcePoints;
    const targetPointsA = transformsA.scaledTps.unscaledTargetPoints;

    const transformedTargetPointsA = M4x4.transformVectorsAffine(
      M4x4.transpose(transformsB.affineMatrix),
      targetPointsA,
    );

    return createThinPlateSplineTransform(
      sourcePointsA,
      transformedTargetPointsA,
      transformsA.scaledTps.scale,
    );
  }

  if (transformsA.type === "affine" && transformsB.type === "thin_plate_spline") {
    // Create a new TPS which uses
    // - the source points of B but applies the inverse A on these
    // - the target points of B
    const sourcePointsB = transformsB.scaledTps.unscaledSourcePoints;
    const targetPointsB = transformsB.scaledTps.unscaledTargetPoints;

    const transformedSourcePointsB = M4x4.transformVectorsAffine(
      M4x4.transpose(M4x4.inverse(transformsA.affineMatrix)),
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

export const transformPointUnscaled = (transforms: Transform) => {
  if (transforms.type === "affine") {
    const matrix = M4x4.transpose(transforms.affineMatrix);
    return (pos: Vector3) => M4x4.transformVectorsAffine(matrix, [pos])[0];
  } else {
  }
  return (pos: Vector3) => transforms.scaledTps.transformUnscaled(pos[0], pos[1], pos[2]);
};
