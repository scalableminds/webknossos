import { V3 } from "libs/mjs";
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import type { Vector3 } from "viewer/constants";
import { createAffineTransform, type Transform } from "viewer/model/helpers/transformation_helpers";
import {
  getCompleteLandmarkPairs,
  getLandmarkPairs,
  getMeanResidual,
  type Landmark,
  type LandmarkPair,
  type Side,
} from "./layer_registration_helpers";

// Three pairs always lie in one plane, so they only work with the fallback in
// estimateMovingToFixedTransform.
export const MIN_LANDMARK_PAIR_COUNT = 3;
// If the smallest extent of a point cloud is below this fraction of its largest extent,
// the points are treated as lying in one plane (or on one line).
const MIN_EXTENT_RATIO = 1e-6;

// The transform estimated from the current landmark pairs.
export type EstimatedTransform = {
  movingToFixedTransform: Transform;
  // See estimateMovingToFixedTransform.
  usedCopiesInNextSlice: boolean;
};

// The error message says why no transform could be estimated.
export type TransformEstimation = EstimatedTransform | { errorMessage: string };

// The affine estimation needs points that span all three dimensions. It doesn't reliably
// throw for points in one plane, but returns a matrix with huge values instead.
function spansThreeDimensions(positions: Vector3[]): boolean {
  const center = V3.scale(
    positions.reduce((sum, position) => V3.add(sum, position)),
    1 / positions.length,
  );
  const centeredPositions = new Matrix(positions.map((position) => V3.sub(position, center)));
  // The singular values are sorted descending. They measure the extent of the centered
  // points along their three main directions.
  const [largestExtent, , smallestExtent] = new SingularValueDecomposition(centeredPositions, {
    computeLeftSingularVectors: false,
    computeRightSingularVectors: false,
  }).diagonal;
  return smallestExtent > largestExtent * MIN_EXTENT_RATIO;
}

function canEstimateTransform(sourcePositions: Vector3[], targetPositions: Vector3[]) {
  return spansThreeDimensions(sourcePositions) && spansThreeDimensions(targetPositions);
}

function addCopiesInNextSlice(positions: Vector3[]): Vector3[] {
  return positions.concat(positions.map(([x, y, z]): Vector3 => [x, y, z + 1]));
}

// If all landmarks lie in one plane (usually because they were placed in a single z
// slice), no 3D transform can be estimated from them. Then, each landmark is copied to
// the next slice (z + 1) on both sides and the transform is estimated from the landmarks
// and their copies. This assumes that one z slice of the moving layer corresponds to one z
// slice of the fixed layer. The dataset composition wizard uses the same fallback. The copies
// only exist here and are never added to an annotation.
export function estimateMovingToFixedTransform(
  landmarks: Record<Side, Landmark[]>,
): TransformEstimation {
  // Landmarks without a partner are left out.
  const pairs = getCompleteLandmarkPairs(landmarks);
  if (pairs.length < MIN_LANDMARK_PAIR_COUNT) {
    return {
      errorMessage: `Need at least ${MIN_LANDMARK_PAIR_COUNT} landmark pairs (a landmark in both views) to estimate a transform.`,
    };
  }
  const fixedPositions = pairs.map((pair) => pair.fixed.position);
  const movingPositions = pairs.map((pair) => pair.moving.position);
  if (canEstimateTransform(movingPositions, fixedPositions)) {
    return {
      movingToFixedTransform: createAffineTransform(movingPositions, fixedPositions),
      usedCopiesInNextSlice: false,
    };
  }

  const extendedFixedPositions = addCopiesInNextSlice(fixedPositions);
  const extendedMovingPositions = addCopiesInNextSlice(movingPositions);
  if (canEstimateTransform(extendedMovingPositions, extendedFixedPositions)) {
    return {
      movingToFixedTransform: createAffineTransform(
        extendedMovingPositions,
        extendedFixedPositions,
      ),
      usedCopiesInNextSlice: true,
    };
  }
  return {
    errorMessage:
      "The landmarks don't allow calculating a transform, e.g. because they all lie on one line. Spread them out in all directions, e.g. by moving some of them or adding pairs elsewhere.",
  };
}

// The transform of one moving layer as estimated from its landmarks.
export type LayerPairTransformEstimate = {
  landmarks: Record<Side, Landmark[]>;
  estimation: TransformEstimation;
  // All pairs with their residuals, see getLandmarkPairs.
  pairs: LandmarkPair[];
  completePairCount: number;
  // See getMeanResidual. Null if no transform could be estimated.
  meanResidual: number | null;
};

export function getLayerPairTransformEstimate(
  landmarks: Record<Side, Landmark[]>,
  voxelSizeFactor: Vector3,
): LayerPairTransformEstimate {
  const estimation = estimateMovingToFixedTransform(landmarks);
  const movingToFixedTransform =
    "errorMessage" in estimation ? null : estimation.movingToFixedTransform;
  const pairs = getLandmarkPairs(landmarks, movingToFixedTransform, voxelSizeFactor);
  return {
    landmarks,
    estimation,
    pairs,
    completePairCount: getCompleteLandmarkPairs(landmarks).length,
    meanResidual: getMeanResidual(pairs),
  };
}
