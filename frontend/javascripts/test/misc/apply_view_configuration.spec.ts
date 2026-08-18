import { adaptViewConfigurationToDataset } from "dashboard/advanced_dataset/apply_view_configuration";
import type { APIDatasetCompact } from "types/api_types";
import type { DatasetConfiguration, DatasetLayerConfiguration } from "viewer/store";
import { describe, expect, it } from "vitest";

function makeDataset(
  id: string,
  colorLayerNames: string[],
  segmentationLayerNames: string[],
): APIDatasetCompact {
  return {
    id,
    name: id,
    colorLayerNames,
    segmentationLayerNames,
  } as APIDatasetCompact;
}

function makeLayerConfiguration(alpha: number): DatasetLayerConfiguration {
  return { alpha } as DatasetLayerConfiguration;
}

const SOURCE_DATASET = makeDataset("source", ["color", "extraColor"], ["segmentation"]);

const SOURCE_CONFIGURATION = {
  fourBit: true,
  interpolation: true,
  position: [1, 2, 3],
  zoom: 4,
  layers: {
    color: makeLayerConfiguration(50),
    extraColor: makeLayerConfiguration(60),
    segmentation: makeLayerConfiguration(20),
  },
  colorLayerOrder: ["extraColor", "color"],
  nativelyRenderedLayerName: "extraColor",
} as unknown as DatasetConfiguration;

describe("adaptViewConfigurationToDataset", () => {
  it("should copy the whole configuration if the layers match", () => {
    const target = makeDataset("target", ["color", "extraColor"], ["segmentation"]);

    expect(adaptViewConfigurationToDataset(SOURCE_CONFIGURATION, SOURCE_DATASET, target)).toEqual(
      SOURCE_CONFIGURATION,
    );
  });

  it("should ignore layers that don't exist in the target dataset", () => {
    const target = makeDataset("target", ["color"], []);
    const adapted = adaptViewConfigurationToDataset(SOURCE_CONFIGURATION, SOURCE_DATASET, target);

    expect(Object.keys(adapted.layers)).toEqual(["color"]);
    expect(adapted.colorLayerOrder).toEqual(["color"]);
    // The dataset-wide properties are still copied.
    expect(adapted.position).toEqual([1, 2, 3]);
    expect(adapted.zoom).toBe(4);
  });

  it("should not copy a layer configuration to a layer of a different category", () => {
    // In the target dataset, "color" is a segmentation layer.
    const target = makeDataset("target", [], ["color", "segmentation"]);
    const adapted = adaptViewConfigurationToDataset(SOURCE_CONFIGURATION, SOURCE_DATASET, target);

    expect(Object.keys(adapted.layers)).toEqual(["segmentation"]);
  });

  it("should append color layers that the source dataset doesn't know to the layer order", () => {
    const target = makeDataset("target", ["color", "unknownColor"], []);
    const adapted = adaptViewConfigurationToDataset(SOURCE_CONFIGURATION, SOURCE_DATASET, target);

    expect(adapted.colorLayerOrder).toEqual(["color", "unknownColor"]);
    // The unknown layer keeps its current configuration, i.e. it is not part of the payload.
    expect(Object.keys(adapted.layers)).toEqual(["color"]);
  });

  it("should reset nativelyRenderedLayerName if that layer does not exist in the target dataset", () => {
    const target = makeDataset("target", ["color"], ["segmentation"]);
    const adapted = adaptViewConfigurationToDataset(SOURCE_CONFIGURATION, SOURCE_DATASET, target);

    expect(adapted.nativelyRenderedLayerName).toBeNull();
  });
});
