import { toLandmarks } from "test/fixtures/layer_registration_fixtures";
import type { AppliedState } from "viewer/view/layer_registration/layer_registration_dataset_transforms";
import type { LandmarkPair } from "viewer/view/layer_registration/layer_registration_helpers";
import type { MovingLayerRow } from "viewer/view/layer_registration/layer_registration_moving_layers";
import { getNextStep } from "viewer/view/layer_registration/layer_registration_next_step";
import { describe, expect, it } from "vitest";

const [landmark] = toLandmarks([[0, 0, 0]]);

function createPair(
  pairId: number,
  sides: { fixed?: boolean; moving?: boolean } = { fixed: true, moving: true },
  residual: number | null = null,
): LandmarkPair {
  return {
    key: String(pairId),
    pairId,
    landmarks: {
      fixed: sides.fixed ? { ...landmark, pairId } : undefined,
      moving: sides.moving ? { ...landmark, pairId } : undefined,
    },
    residual,
  };
}

function createRow(
  layerName: string,
  appliedState: AppliedState,
  completePairCount = 4,
): MovingLayerRow {
  return { layerName, completePairCount, meanResidual: null, appliedState };
}

function getStep(
  pairs: LandmarkPair[],
  options: { hasTransform?: boolean; movingLayerRows?: MovingLayerRow[] } = {},
) {
  const residuals = pairs.flatMap((pair) => (pair.residual != null ? [pair.residual] : []));
  return getNextStep({
    pairs,
    hasTransform: options.hasTransform ?? true,
    meanResidual:
      residuals.length > 0
        ? residuals.reduce((sum, value) => sum + value) / residuals.length
        : null,
    voxelSizeFactor: [1, 1, 1],
    movingLayerRows: options.movingLayerRows ?? [createRow("moving", "notApplied")],
    activeLayerName: "moving",
  });
}

const fourGoodPairs = [1, 2, 3, 4].map((pairId) => createPair(pairId, undefined, 2));

describe("Layer registration next step", () => {
  it("guides through placing the first landmarks and completing the pairs", () => {
    expect(getStep([], { hasTransform: false })).toEqual({ type: "placeFirstLandmark" });
    const incompletePair = createPair(2, { fixed: true });
    expect(getStep([createPair(1), incompletePair], { hasTransform: false })).toEqual({
      type: "completePair",
      pair: incompletePair,
      missingSide: "moving",
    });
    expect(getStep([createPair(1), createPair(2)], { hasTransform: false })).toEqual({
      type: "placeMorePairs",
      missingPairCount: 1,
    });
    // The status card explains why no transform could be estimated.
    expect(getStep(fourGoodPairs, { hasTransform: false })).toBeNull();
  });

  it("points to a pair with a much higher error than the others", () => {
    const outlier = createPair(4, undefined, 10);
    const step = getStep([...fourGoodPairs.slice(0, 3), outlier]);
    expect(step).toEqual({ type: "checkOutlier", pair: outlier, errorFactor: 10 / 4 });
  });

  it("asks to apply the transform, then points to the next layer", () => {
    expect(getStep(fourGoodPairs)).toEqual({ type: "compareAndApply" });
    expect(
      getStep(fourGoodPairs, {
        movingLayerRows: [createRow("moving", "applied"), createRow("other", "notEnoughPairs", 0)],
      }),
    ).toEqual({
      type: "nextLayer",
      layerName: "other",
      completePairCount: 0,
      appliedState: "notEnoughPairs",
    });
    expect(
      getStep(fourGoodPairs, {
        movingLayerRows: [createRow("moving", "applied"), createRow("other", "applied")],
      }),
    ).toEqual({ type: "allApplied", hasSeveralMovingLayers: true });
  });

  it("waits for the other layers while they are loading", () => {
    expect(
      getStep(fourGoodPairs, {
        movingLayerRows: [createRow("moving", "applied"), { layerName: "other", isLoading: true }],
      }),
    ).toBeNull();
  });
});
