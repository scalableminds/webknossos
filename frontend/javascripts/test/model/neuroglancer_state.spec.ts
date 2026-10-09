import { UnitLong } from "viewer/constants";
import {
  buildFijiUrl,
  buildNeuroglancerState,
  buildNeuroglancerUrl,
  NEUROGLANCER_URL,
  type NeuroglancerLayerInput,
} from "viewer/model/helpers/neuroglancer_state";
import type { DatasetLayerConfiguration } from "viewer/store";
import { describe, expect, it } from "vitest";

const layerConfig: DatasetLayerConfiguration = {
  color: [255, 128, 0],
  alpha: 80,
  intensityRange: [10, 200],
  min: 0,
  max: 255,
  isDisabled: false,
  isInverted: true,
  isInEditMode: false,
  gammaCorrectionValue: 1.5,
};

const colorLayer: NeuroglancerLayerInput = {
  name: "color",
  url: "https://datastore/data/v12/zarr3/abc/color",
  elementClass: "uint8",
  defaultValueRange: [0, 255],
  config: layerConfig,
};

const disabledColorLayer: NeuroglancerLayerInput = {
  name: "color2",
  url: "https://datastore/data/v12/zarr3/abc/color2?token=secret",
  elementClass: "uint16",
  defaultValueRange: [0, 65535],
  config: {
    ...layerConfig,
    color: [255, 255, 255],
    intensityRange: undefined,
    min: undefined,
    max: undefined,
    isDisabled: true,
  },
};

const segmentationLayer: NeuroglancerLayerInput = {
  name: "Volume",
  url: "https://datastore/data/v12/annotations/zarr3/token/Volume",
  elementClass: "uint32",
  defaultValueRange: [0, 2 ** 32 - 1],
  config: { ...layerConfig, alpha: 20 },
};

function buildState() {
  return buildNeuroglancerState({
    voxelSize: { factor: [11.24, 11.24, 28], unit: UnitLong.nm },
    position: [100, 200, 300],
    zoomStep: 1.5,
    viewportHeight: 500,
    colorLayers: [colorLayer, disabledColorLayer],
    segmentationLayers: [segmentationLayer],
  });
}

describe("Neuroglancer state", () => {
  it("converts voxel size, position and zoom", () => {
    const state = buildState();
    expect(state.dimensions.x[0]).toBeCloseTo(11.24e-9);
    expect(state.dimensions.y[0]).toBeCloseTo(11.24e-9);
    expect(state.dimensions.z[0]).toBeCloseTo(28e-9);
    expect(state.dimensions.x[1]).toBe("m");
    expect(state.position).toEqual([100, 200, 300]);
    expect(state.crossSectionScale).toBe(1.5);
    expect(state.projectionScale).toBe(750);
  });

  it("converts the voxel size from other units", () => {
    const state = buildNeuroglancerState({
      voxelSize: { factor: [1, 1, 2], unit: UnitLong.µm },
      position: [0, 0, 0],
      zoomStep: 1,
      viewportHeight: 500,
      colorLayers: [],
      segmentationLayers: [],
    });
    expect(state.dimensions.x[0]).toBeCloseTo(1e-6);
    expect(state.dimensions.z[0]).toBeCloseTo(2e-6);
  });

  it("converts color layers with rendering settings", () => {
    const state = buildState();
    expect(state.layers.map((layer) => layer.name)).toEqual(["color", "color2", "Volume"]);
    const [first, second] = state.layers;
    expect(first).toMatchObject({
      type: "image",
      source: "zarr3://https://datastore/data/v12/zarr3/abc/color",
      visible: true,
      opacity: 0.8,
      shaderControls: {
        normalized: { range: [10, 200], window: [0, 255] },
        color: "#ff8000",
        gamma: 1.5,
        invert: true,
      },
    });
    expect(second).toMatchObject({
      visible: false,
      shaderControls: {
        normalized: { range: [0, 65535], window: [0, 65535] },
        color: "#ffffff",
      },
    });
  });

  it("converts segmentation layers", () => {
    const segmentation = buildState().layers[2];
    expect(segmentation).toEqual({
      type: "segmentation",
      name: "Volume",
      source: "zarr3://https://datastore/data/v12/annotations/zarr3/token/Volume",
      visible: true,
      selectedAlpha: 0.2,
    });
  });

  it("builds a decodable Neuroglancer URL", () => {
    const state = buildState();
    const url = buildNeuroglancerUrl(state);
    expect(url.startsWith(`${NEUROGLANCER_URL}#!`)).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(url.slice(`${NEUROGLANCER_URL}#!`.length)));
    expect(decoded).toEqual(JSON.parse(JSON.stringify(state)));
  });
});

describe("Fiji URL", () => {
  it("encodes the zarr URL", () => {
    expect(buildFijiUrl("https://host/zarr3/abc/color?token=x")).toBe(
      "fiji://open/url?p=https%3A%2F%2Fhost%2Fzarr3%2Fabc%2Fcolor%3Ftoken%3Dx",
    );
  });
});
