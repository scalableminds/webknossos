import {
  FIXED_POSITIONS,
  MOVING_POSITIONS,
  toLandmarks,
} from "test/fixtures/layer_registration_fixtures";
import type { APIDataset } from "types/api_types";
import {
  getActiveMovingLayerName,
  getCopySources,
  getMovingLayerNames,
  getMovingLayerRows,
  type InactivePair,
} from "viewer/view/layer_registration/layer_registration_moving_layers";
import { getLayerPairTransformEstimate } from "viewer/view/layer_registration/layer_registration_transform_estimation";
import { describe, expect, it } from "vitest";

function createInactivePair(fixedLandmarkCount: number, movingLandmarkCount: number): InactivePair {
  return {
    estimate: getLayerPairTransformEstimate(
      {
        fixed: toLandmarks(FIXED_POSITIONS.slice(0, fixedLandmarkCount)),
        moving: toLandmarks(MOVING_POSITIONS.slice(0, movingLandmarkCount)),
      },
      [1, 1, 1],
    ),
    fixedSideNmlString: fixedLandmarkCount > 0 ? "<nml />" : null,
  };
}

describe("Layer registration moving layers", () => {
  const datasetWithLayers = (...names: string[]) =>
    ({ dataSource: { dataLayers: names.map((name) => ({ name })) } }) as APIDataset;

  it("offers all other layers of the dataset as moving layers", () => {
    const dataset = datasetWithLayers("color_1", "color_2", "color_3");
    expect(getMovingLayerNames(dataset, "color_2")).toEqual(["color_1", "color_3"]);
  });

  it("shows the requested moving layer or falls back to the first one", () => {
    const movingLayerNames = ["color_2", "color_3"];
    expect(getActiveMovingLayerName(movingLayerNames, "color_3")).toBe("color_3");
    expect(getActiveMovingLayerName(movingLayerNames, null)).toBe("color_2");
    expect(getActiveMovingLayerName(movingLayerNames, "renamed")).toBe("color_2");
    expect(getActiveMovingLayerName([], null)).toBeNull();
  });

  it("summarizes each moving layer, also while the inactive ones are loading", () => {
    const activePairEstimate = createInactivePair(4, 4).estimate;
    const getRows = (inactivePairs: Map<string, InactivePair> | null) =>
      getMovingLayerRows({
        movingLayerNames: ["active", "inactive", "unreadable"],
        activeLayerName: "active",
        activePairEstimate,
        inactivePairs,
        fixedLayerName: "fixed",
        layerTransformsInDataset: {},
      });

    expect(getRows(null)).toEqual([
      expect.objectContaining({ layerName: "active", completePairCount: 4 }),
      { layerName: "inactive", isLoading: true },
      { layerName: "unreadable", isLoading: true },
    ]);
    expect(getRows(new Map([["inactive", createInactivePair(2, 1)]]))).toEqual([
      expect.objectContaining({ layerName: "active", appliedState: "notApplied" }),
      {
        layerName: "inactive",
        completePairCount: 1,
        meanResidual: null,
        appliedState: "notEnoughPairs",
      },
      { layerName: "unreadable", isLoading: false },
    ]);
  });

  it("offers to copy the fixed layer landmarks of the inactive layers that have some", () => {
    const inactivePairs = new Map([
      ["few", createInactivePair(1, 0)],
      ["none", createInactivePair(0, 3)],
      ["many", createInactivePair(3, 3)],
    ]);
    expect(getCopySources(inactivePairs)).toEqual([
      { layerName: "many", landmarkCount: 3 },
      { layerName: "few", landmarkCount: 1 },
    ]);
    expect(getCopySources(null)).toEqual([]);
  });
});
