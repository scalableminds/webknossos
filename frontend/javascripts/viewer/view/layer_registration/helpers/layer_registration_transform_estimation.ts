import { type Axis, estimateAffineMatrixFromLandmarks } from "libs/estimate_affine";
import type { Vector3 } from "viewer/constants";
import {
  createAffineTransformFromMatrix,
  flatToNestedMatrix,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import {
  getCompleteLandmarkPairs,
  getLandmarkPairs,
  getMeanResidual,
  type Landmark,
  type LandmarkPair,
  type Side,
} from "./layer_registration_helpers";

// Three pairs always lie in one plane, so they only work if that plane is a slice (see
// estimateAffineMatrixFromLandmarks).
export const MIN_LANDMARK_PAIR_COUNT = 3;

// Set if the landmarks of at least one view all lie in one slice along an axis, e.g., because
// they were all placed in the XY viewport, which shows one z slice. The coordinate of a view is
// the position of its slice on that axis, or null if its landmarks don't all lie in one slice
// along that axis.
export type SingleSlice = {
  axis: Axis;
  fixedCoordinate: number | null; // The shared value of axis of the fixed landmarks.
  movingCoordinate: number | null; // The shared value of axis of the moving landmarks.
};

// The transform estimated from the current landmark pairs.
export type EstimatedTransform = {
  movingToFixedTransform: Transform;
  singleSlice: SingleSlice | null;
};

// The error message says why no transform could be estimated.
export type TransformEstimation = EstimatedTransform | { errorMessage: string };

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
  const estimation = estimateAffineMatrixFromLandmarks(
    pairs.map((pair) => pair.moving.position),
    pairs.map((pair) => pair.fixed.position),
  );
  if (estimation == null) {
    return {
      errorMessage:
        "The landmarks don't allow calculating a transform, e.g. because they all lie on one line or in one tilted plane. Spread them out in all directions, e.g. by moving some of them or adding pairs elsewhere.",
    };
  }
  const { matrix, singleSlice } = estimation;
  return {
    movingToFixedTransform: createAffineTransformFromMatrix(flatToNestedMatrix(matrix)),
    singleSlice:
      singleSlice != null
        ? {
            axis: singleSlice.axis,
            fixedCoordinate: singleSlice.targetCoordinate,
            movingCoordinate: singleSlice.sourceCoordinate,
          }
        : null,
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
