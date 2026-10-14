import {
  FIXED_POSITIONS,
  MOVING_POSITIONS,
  toLandmarks,
} from "test/fixtures/layer_registration_fixtures";
import type { Vector3 } from "viewer/constants";
import {
  getLandmarkPairs,
  type Landmark,
  type Side,
} from "viewer/view/layer_registration/layer_registration_helpers";
import {
  type EstimatedTransform,
  estimateMovingToFixedTransform,
  getLayerPairTransformEstimate,
} from "viewer/view/layer_registration/layer_registration_transform_estimation";
import { describe, expect, it } from "vitest";

function enforceEstimatedTransform(landmarks: Record<Side, Landmark[]>): EstimatedTransform {
  const estimation = estimateMovingToFixedTransform(landmarks);
  if ("errorMessage" in estimation) {
    throw new Error(estimation.errorMessage);
  }
  return estimation;
}

function expectResidualsCloseToZero(
  landmarks: Record<Side, Landmark[]>,
  { movingToFixedTransform }: EstimatedTransform,
  digits: number,
) {
  for (const pair of getLandmarkPairs(landmarks, movingToFixedTransform)) {
    expect(pair.residual).toBeCloseTo(0, digits);
  }
}

describe("Layer registration transform estimation", () => {
  it("refuses to estimate a transform from too few complete pairs", () => {
    expect(
      estimateMovingToFixedTransform({
        fixed: toLandmarks(FIXED_POSITIONS),
        moving: toLandmarks(MOVING_POSITIONS.slice(0, 2)),
      }),
    ).toHaveProperty("errorMessage");
  });

  it("leaves landmarks without a partner out of the transform", () => {
    const landmarks = {
      fixed: toLandmarks([...FIXED_POSITIONS, [100, 200, 300]], [1, 2, 3, 4, 9]),
      moving: toLandmarks(MOVING_POSITIONS),
    };
    const { movingToFixedTransform } = enforceEstimatedTransform(landmarks);

    for (const pair of getLandmarkPairs(landmarks, movingToFixedTransform)) {
      if (pair.pairId !== 9) {
        expect(pair.residual).toBeCloseTo(0, 5);
      }
    }
  });

  it("refuses to estimate a transform from landmarks on one line", () => {
    const collinearPositions: Vector3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ];
    expect(
      estimateMovingToFixedTransform({
        fixed: toLandmarks(collinearPositions),
        moving: toLandmarks(collinearPositions),
      }),
    ).toHaveProperty("errorMessage");
  });

  it("estimates a transform from landmarks in a single z slice", () => {
    const fixedPositions: Vector3[] = [
      [0, 0, 7],
      [10, 0, 7],
      [0, 10, 7],
      [10, 10, 7],
    ];
    // The moving layer is rotated by 90 degrees in the xy plane and lies in another z slice.
    const movingPositions = fixedPositions.map(([x, y]): Vector3 => [-y, x, 3]);
    const landmarks = { fixed: toLandmarks(fixedPositions), moving: toLandmarks(movingPositions) };
    const estimatedTransform = enforceEstimatedTransform(landmarks);

    expect(estimatedTransform.usedCopiesInNextSlice).toBe(true);
    expectResidualsCloseToZero(landmarks, estimatedTransform, 5);
  });

  it("estimates a transform from realistic landmarks in a single z slice", () => {
    // With these coordinates, the affine solver returns huge values instead of throwing.
    const fixedPositions: Vector3[] = [
      [1203, 4511, 7],
      [3810, 402, 7],
      [2290, 3001, 7],
      [517, 980, 7],
      [4100, 4400, 7],
    ];
    const movingPositions = fixedPositions.map(([x, y]): Vector3 => [x + 12, y - 30, 3]);
    const landmarks = { fixed: toLandmarks(fixedPositions), moving: toLandmarks(movingPositions) };
    const estimatedTransform = enforceEstimatedTransform(landmarks);

    expect(estimatedTransform.usedCopiesInNextSlice).toBe(true);
    expectResidualsCloseToZero(landmarks, estimatedTransform, 3);
  });

  it("accepts two landmarks at the same position", () => {
    const landmarks = {
      fixed: toLandmarks([...FIXED_POSITIONS, FIXED_POSITIONS[0]]),
      moving: toLandmarks([...MOVING_POSITIONS, MOVING_POSITIONS[0]]),
    };
    expect(estimateMovingToFixedTransform(landmarks)).toHaveProperty("movingToFixedTransform");
  });

  it("estimates a transform that maps the moving landmarks onto the fixed ones", () => {
    const landmarks = {
      fixed: toLandmarks(FIXED_POSITIONS),
      moving: toLandmarks(MOVING_POSITIONS),
    };
    const estimatedTransform = enforceEstimatedTransform(landmarks);

    expect(estimatedTransform.usedCopiesInNextSlice).toBe(false);
    expect(getLandmarkPairs(landmarks, estimatedTransform.movingToFixedTransform)).toHaveLength(4);
    expectResidualsCloseToZero(landmarks, estimatedTransform, 5);
  });

  it("summarizes the estimated transform of a moving layer", () => {
    const tooFewPairs = getLayerPairTransformEstimate(
      {
        fixed: toLandmarks(FIXED_POSITIONS.slice(0, 2)),
        moving: toLandmarks(MOVING_POSITIONS.slice(0, 2)),
      },
      [1, 1, 1],
    );
    expect(tooFewPairs.completePairCount).toBe(2);
    expect(tooFewPairs.meanResidual).toBeNull();
    expect(tooFewPairs.estimation).toHaveProperty("errorMessage");

    const estimate = getLayerPairTransformEstimate(
      { fixed: toLandmarks(FIXED_POSITIONS), moving: toLandmarks(MOVING_POSITIONS) },
      [1, 1, 1],
    );
    expect(estimate.completePairCount).toBe(4);
    expect(estimate.meanResidual).toBeCloseTo(0);
    expect(estimate.estimation).toHaveProperty("movingToFixedTransform");
  });
});
