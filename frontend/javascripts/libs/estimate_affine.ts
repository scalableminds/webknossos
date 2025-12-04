import _ from "lodash";
import type { Matrix4x4 } from "mjs";
import { Matrix, solve } from "ml-matrix";
import type { Vector3 } from "viewer/constants";

export default function estimateAffine(
  sourcePoints: Vector3[],
  targetPoints: Vector3[],
  optInfoOut?: { meanError: number },
) {
  /* Estimates an affine matrix that transforms from source points to target points. */
  // Number of correspondences
  const N = sourcePoints.length;

  // Construct matrices A and b
  const A = [];
  const b = [];

  for (let i = 0; i < N; i++) {
    const p = sourcePoints[i];
    const q = targetPoints[i];
    const [px, py, pz] = p;
    const [qx, qy, qz] = q;

    A.push([px, py, pz, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    A.push([0, 0, 0, 0, px, py, pz, 1, 0, 0, 0, 0]);
    A.push([0, 0, 0, 0, 0, 0, 0, 0, px, py, pz, 1]);

    b.push([qx]);
    b.push([qy]);
    b.push([qz]);
  }

  const xMatrix = solve(A, b);
  const x = xMatrix.to1DArray();
  const error = Matrix.sub(b, new Matrix(A).mmul(xMatrix)).to1DArray();
  const meanError = _.mean(error.map((el) => Math.abs(el)));
  if (optInfoOut) {
    optInfoOut.meanError = meanError;
  }
  if (!process.env.IS_TESTING) {
    console.log("Affine estimation error: ", error, `(mean=${meanError})`);
  }

  const affineMatrix = new Matrix([
    [x[0], x[1], x[2], x[3]],
    [x[4], x[5], x[6], x[7]],
    [x[8], x[9], x[10], x[11]],
    [0, 0, 0, 1],
  ]);

  return new Matrix(affineMatrix);
}

export function estimateAffineMatrix4x4(
  sourcePoints: Vector3[],
  targetPoints: Vector3[],
  optInfoOut?: { meanError: number },
): Matrix4x4 {
  /* Estimates an affine matrix that transforms from source points to target points. */
  return estimateAffine(sourcePoints, targetPoints, optInfoOut).to1DArray() as any as Matrix4x4;
}
