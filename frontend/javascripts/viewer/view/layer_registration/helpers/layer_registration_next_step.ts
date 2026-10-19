import type { Vector3 } from "viewer/constants";
import type { AppliedState } from "./layer_registration_dataset_transforms";
import {
  isCompletePair,
  isHighResidual,
  type LandmarkPair,
  type Side,
} from "./layer_registration_helpers";
import type { MovingLayerRow } from "./layer_registration_moving_layers";
import { MIN_LANDMARK_PAIR_COUNT } from "./layer_registration_transform_estimation";

// What the user should do next, shown as a hint in the landmark panel. The first matching
// step wins, in the order of the type below.
export type NextStep =
  | { type: "placeFirstLandmark" }
  | { type: "completePair"; pair: LandmarkPair; missingSide: Side }
  | { type: "placeMorePairs"; missingPairCount: number }
  | { type: "checkOutlier"; pair: LandmarkPair; errorFactor: number }
  | { type: "compareAndApply"; hasSeveralMovingLayers: boolean }
  | { type: "nextLayer"; layerName: string; completePairCount: number; appliedState: AppliedState }
  | { type: "allApplied"; hasSeveralMovingLayers: boolean };

// The steps that only depend on the landmark pairs of the active moving layer.
function getLandmarkStep(pairs: LandmarkPair[]): NextStep | null {
  if (pairs.length === 0) {
    return { type: "placeFirstLandmark" };
  }
  const incompletePair = pairs.find((pair) => pair.pairId != null && !isCompletePair(pair));
  if (incompletePair != null) {
    return {
      type: "completePair",
      pair: incompletePair,
      missingSide: incompletePair.landmarks.fixed == null ? "fixed" : "moving",
    };
  }
  const completePairCount = pairs.filter(isCompletePair).length;
  if (completePairCount < MIN_LANDMARK_PAIR_COUNT) {
    return {
      type: "placeMorePairs",
      missingPairCount: MIN_LANDMARK_PAIR_COUNT - completePairCount,
    };
  }
  return null;
}

function getOutlierStep(
  pairs: LandmarkPair[],
  meanResidual: number | null,
  voxelSizeFactor: Vector3,
): NextStep | null {
  const worstPair = pairs.reduce<LandmarkPair | null>(
    (worst, pair) =>
      pair.residual != null && (worst?.residual == null || pair.residual > worst.residual)
        ? pair
        : worst,
    null,
  );
  if (
    worstPair?.residual == null ||
    meanResidual == null ||
    !isHighResidual(worstPair.residual, meanResidual, voxelSizeFactor)
  ) {
    return null;
  }
  return { type: "checkOutlier", pair: worstPair, errorFactor: worstPair.residual / meanResidual };
}

// The steps once the transform of the active moving layer looks good: apply it, then go on
// with the other moving layers.
function getApplyStep(movingLayerRows: MovingLayerRow[], activeLayerName: string): NextStep | null {
  const activeRow = movingLayerRows.find((row) => row.layerName === activeLayerName);
  if (activeRow?.status !== "loaded" || activeRow.appliedState !== "applied") {
    return { type: "compareAndApply", hasSeveralMovingLayers: movingLayerRows.length > 1 };
  }
  for (const row of movingLayerRows) {
    if (row.status === "loaded" && row.appliedState !== "applied") {
      return {
        type: "nextLayer",
        layerName: row.layerName,
        completePairCount: row.completePairCount,
        appliedState: row.appliedState,
      };
    }
  }
  return movingLayerRows.some((row) => row.status !== "loaded")
    ? null
    : { type: "allApplied", hasSeveralMovingLayers: movingLayerRows.length > 1 };
}

export function getNextStep({
  pairs,
  hasTransform,
  meanResidual,
  voxelSizeFactor,
  movingLayerRows,
  activeLayerName,
}: {
  // The pairs of the active moving layer, with their residuals.
  pairs: LandmarkPair[];
  hasTransform: boolean;
  meanResidual: number | null;
  voxelSizeFactor: Vector3;
  movingLayerRows: MovingLayerRow[];
  activeLayerName: string;
}): NextStep | null {
  const landmarkStep = getLandmarkStep(pairs);
  if (landmarkStep != null) {
    return landmarkStep;
  }
  if (!hasTransform) {
    // The status card explains why no transform could be estimated.
    return null;
  }
  return (
    getOutlierStep(pairs, meanResidual, voxelSizeFactor) ??
    getApplyStep(movingLayerRows, activeLayerName)
  );
}
