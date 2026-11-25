import { M4x4 } from "libs/mjs";
import mean from "lodash-es/mean";
import type { Matrix4x4 } from "mjs";
import { determinant, Matrix, SingularValueDecomposition, solve } from "ml-matrix";
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
  const meanError = mean(error.map((el) => Math.abs(el)));
  if (optInfoOut) {
    optInfoOut.meanError = meanError;
  }
  if (import.meta.env.MODE !== "test") {
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

// If the smallest extent of a point cloud is below this fraction of its largest extent,
// the points are treated as not spanning all dimensions (e.g., 3D points in one plane).
const MIN_EXTENT_RATIO = 1e-6;
// Below this absolute determinant, the linear part of a matrix counts as not invertible.
const MIN_DETERMINANT = 1e-9;

export type Axis = 0 | 1 | 2;
const AXES: Axis[] = [0, 1, 2];
export const AXIS_NAMES = ["x", "y", "z"] as const;

// Set if the source or target points all lie in one slice along an axis, e.g., because they were
// all placed in the XY viewport, which shows one z slice. The coordinate of the source or target
// is the position of its slice on that axis, or null if its points don't all lie in that slice.
export type SingleSlice = {
  axis: Axis;
  sourceCoordinate: number | null;
  targetCoordinate: number | null;
};

export type LandmarkAffineEstimation = {
  // Row major, like the result of estimateAffineMatrix4x4.
  matrix: Matrix4x4;
  singleSlice: SingleSlice | null;
  // The mean absolute difference between the transformed source points and the target points,
  // per coordinate.
  meanError: number;
};

// Whether the points span all dimensions of their vectors: 3D points that don't lie in one
// plane, or 2D points that don't lie on one line. The affine estimation needs this. It doesn't
// reliably throw otherwise, but returns a matrix with huge values instead.
function spansAllDimensions(points: number[][]): boolean {
  const dimensionCount = points[0].length;
  const center = points[0].map((_value, index) => mean(points.map((point) => point[index])));
  const centeredPoints = new Matrix(
    points.map((point) => point.map((value, index) => value - center[index])),
  );
  // The singular values are sorted descending. They measure the extent of the centered
  // points along their main directions.
  const extents = new SingularValueDecomposition(centeredPoints, {
    computeLeftSingularVectors: false,
    computeRightSingularVectors: false,
  }).diagonal;
  if (extents.length < dimensionCount) {
    return false;
  }
  return extents[dimensionCount - 1] > extents[0] * MIN_EXTENT_RATIO;
}

// The coordinate on the axis that all points share, or null if they don't share one.
function getSharedCoordinate(points: Vector3[], axis: Axis): number | null {
  const coordinate = points[0][axis];
  return points.every((point) => point[axis] === coordinate) ? coordinate : null;
}

// Fits an affine matrix from source points that all lie in one slice along the axis. The two
// other axes of the source are fitted as a 2D affine map onto the 3D target points. Along the
// axis itself, the matrix keeps the scale of 1 and moves nothing sideways, so a step along the
// axis in the source is the same step in the target. If the target points lie in one slice along
// the same axis, the matrix thus shifts along that axis by the distance between the two slices
// (0 if both slices are the same).
// Returns null if the source points lie on one line or the matrix can't be inverted.
function fitAffineMatrixToSlice(
  source: Vector3[],
  target: Vector3[],
  axis: Axis,
): Matrix4x4 | null {
  // Only the source points are reduced to their in-slice coordinates (u, v), and only they are
  // checked. Their coordinate on the axis is the same for all of them, so as a column of the fit
  // it would only repeat the constant column, and the fit would have no unique solution. The fit
  // also needs source points that don't lie on one line. The target points can be anything, so
  // they stay 3D: each target coordinate is fitted as an affine function of (u, v).
  // - If the target points lie in one slice along the same axis, their coordinate on it is
  //   constant, and the fit returns that constant for it (u and v get the factor 0). With
  //   the scale of 1 along the axis (see below), this becomes the shift between the two slices.
  // - If the target points lie in a tilted plane, their coordinate on the axis changes with u and
  //   v. The fit keeps this tilt, which reducing the target points as well would lose.
  // Target points that make the matrix not invertible (e.g., on one line, or in a slice along
  // another axis) are caught by the determinant check below.
  const inSliceAxes = AXES.filter((otherAxis) => otherAxis !== axis);
  const inSlicePoints = source.map((point) => inSliceAxes.map((index) => point[index]));
  if (!spansAllDimensions(inSlicePoints)) {
    return null;
  }
  // Least squares fit of [u, v, 1] · coefficients = target, with one column per target axis.
  const coefficients = solve(
    new Matrix(inSlicePoints.map(([u, v]) => [u, v, 1])),
    new Matrix(target),
  );
  const sliceCoordinate = source[0][axis];
  const rows = AXES.map((targetAxis) => {
    const row = [0, 0, 0, 0];
    inSliceAxes.forEach((sourceAxis, index) => {
      row[sourceAxis] = coefficients.get(index, targetAxis);
    });
    row[axis] = targetAxis === axis ? 1 : 0;
    // The fitted translation applies to the source slice, so the part that the axis column adds
    // for that slice is subtracted again.
    row[3] = coefficients.get(2, targetAxis) - row[axis] * sliceCoordinate;
    return row;
  });
  if (Math.abs(determinant(new Matrix(rows.map((row) => row.slice(0, 3))))) < MIN_DETERMINANT) {
    return null;
  }
  return [...rows.flat(), 0, 0, 0, 1] as Matrix4x4;
}

// If the source or target points lie in one plane, no 3D affine matrix can be estimated from
// them. If that plane is a slice along an axis, the matrix is fitted within the slice instead
// (see fitAffineMatrixToSlice). If only the target points lie in one slice, the matrix from
// target to source is fitted and inverted.
function estimateFromSingleSlice(
  source: Vector3[],
  target: Vector3[],
): Omit<LandmarkAffineEstimation, "meanError"> | null {
  for (const axis of AXES) {
    const sourceCoordinate = getSharedCoordinate(source, axis);
    const targetCoordinate = getSharedCoordinate(target, axis);
    if (sourceCoordinate == null && targetCoordinate == null) {
      continue;
    }
    const isSourceInSlice = sourceCoordinate != null;
    // From source to target, or from target to source if only the target points lie in the slice.
    const fittedMatrix = isSourceInSlice
      ? fitAffineMatrixToSlice(source, target, axis)
      : fitAffineMatrixToSlice(target, source, axis);
    if (fittedMatrix != null) {
      return {
        matrix: isSourceInSlice ? fittedMatrix : M4x4.inverse(fittedMatrix),
        singleSlice: { axis, sourceCoordinate, targetCoordinate },
      };
    }
  }
  return null;
}

function getMeanError(matrix: Matrix4x4, source: Vector3[], target: Vector3[]): number {
  const errors = source.flatMap((point, index) =>
    AXES.map((axis) => {
      const row = matrix.slice(4 * axis, 4 * axis + 4);
      const transformed = row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + row[3];
      return Math.abs(transformed - target[index][axis]);
    }),
  );
  return mean(errors);
}

/** Estimates an affine matrix that transforms from the source points to the target points, like
 * estimateAffineMatrix4x4. Unlike that, it also handles points that all lie in one slice along an
 * axis (see estimateFromSingleSlice). Returns null if no matrix can be estimated, e.g., because
 * the points lie on one line or in one tilted plane.
 */
export function estimateAffineMatrixFromLandmarks(
  source: Vector3[],
  target: Vector3[],
): LandmarkAffineEstimation | null {
  if (spansAllDimensions(source) && spansAllDimensions(target)) {
    const optInfoOut = { meanError: 0 };
    const matrix = estimateAffineMatrix4x4(source, target, optInfoOut);
    return { matrix, singleSlice: null, meanError: optInfoOut.meanError };
  }
  const estimation = estimateFromSingleSlice(source, target);
  return estimation != null
    ? { ...estimation, meanError: getMeanError(estimation.matrix, source, target) }
    : null;
}
