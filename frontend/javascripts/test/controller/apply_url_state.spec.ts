import type { APIDataset } from "types/api_types";
import { isValidNativelyRenderedLayerName } from "viewer/controller/apply_url_state";
import { describe, expect, it } from "vitest";
import DATASET from "../fixtures/dataset_server_object";

const TRANSLATION = {
  type: "affine" as const,
  matrix: [
    [1, 0, 0, 10],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ] as [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ],
};

function withTransformsOnFirstLayer(dataset: APIDataset): APIDataset {
  return {
    ...dataset,
    dataSource: {
      ...dataset.dataSource,
      dataLayers: dataset.dataSource.dataLayers.map((layer, index) =>
        index === 0 ? { ...layer, coordinateTransformations: [TRANSLATION] } : layer,
      ),
    },
  };
}

describe("isValidNativelyRenderedLayerName", () => {
  const layerName = DATASET.dataSource.dataLayers[0].name;

  it("accepts an existing layer of a dataset with transforms", () => {
    expect(isValidNativelyRenderedLayerName(withTransformsOnFirstLayer(DATASET), layerName)).toBe(
      true,
    );
  });

  it("rejects a layer that doesn't exist", () => {
    expect(isValidNativelyRenderedLayerName(withTransformsOnFirstLayer(DATASET), "missing")).toBe(
      false,
    );
  });

  it("rejects any layer if the dataset has no transforms", () => {
    expect(DATASET.dataSource.dataLayers.some((layer) => layer.coordinateTransformations)).toBe(
      false,
    );
    expect(isValidNativelyRenderedLayerName(DATASET, layerName)).toBe(false);
  });
});
