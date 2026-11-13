import type { ElementClass, VoxelSize } from "types/api_types";
import { UnitShort, type Vector3 } from "viewer/constants";
import { convertVoxelSizeToUnit } from "viewer/model/scaleinfo";
import type { DatasetLayerConfiguration } from "viewer/store";

export const NEUROGLANCER_URL = "https://neuroglancer-demo.appspot.com/";

// Mirrors the color layer rendering in main_data_shaders.glsl.ts:
// histogram range -> gamma correction -> inversion -> layer color.
const IMAGE_LAYER_SHADER = `#uicontrol invlerp normalized
#uicontrol vec3 color color(default="#ffffff")
#uicontrol float gamma slider(min=0.05, max=10, default=1)
#uicontrol bool invert checkbox(default=false)
void main() {
  float v = clamp(normalized(), 0.0, 1.0);
  v = pow(v, 1.0 / gamma);
  if (invert) {
    v = 1.0 - v;
  }
  emitRGB(color * v);
}
`;

export type NeuroglancerLayerInput = {
  name: string;
  url: string;
  elementClass: ElementClass;
  // Value range of the data type, used when no explicit histogram bounds are configured.
  defaultValueRange: readonly [number, number];
  config: DatasetLayerConfiguration | undefined;
};

export type NeuroglancerStateInput = {
  voxelSize: VoxelSize;
  position: Vector3;
  zoomStep: number;
  viewportHeight: number;
  colorLayers: Array<NeuroglancerLayerInput>;
  segmentationLayers: Array<NeuroglancerLayerInput>;
};

type NeuroglancerLayer = Record<string, unknown> & {
  type: "image" | "segmentation";
  name: string;
  source: string;
  visible: boolean;
};

export type NeuroglancerState = {
  dimensions: Record<"x" | "y" | "z", [number, "m"]>;
  position: Vector3;
  crossSectionScale: number;
  projectionScale: number;
  layout: string;
  layers: Array<NeuroglancerLayer>;
};

function rgbToHex(color: Vector3): string {
  return `#${color
    .map((channel) =>
      Math.round(Math.min(Math.max(channel, 0), 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function getSource(url: string): string {
  return `zarr3://${url}`;
}

function buildImageLayer(layer: NeuroglancerLayerInput): NeuroglancerLayer {
  const { config } = layer;
  const imageLayer: NeuroglancerLayer = {
    type: "image",
    name: layer.name,
    source: getSource(layer.url),
    visible: config != null ? !config.isDisabled : true,
    opacity: config != null ? config.alpha / 100 : 1,
    blend: "additive",
  };
  // RGB layers have their own channel semantics, so Neuroglancer's default shader is used for them.
  if (config == null || layer.elementClass === "uint24") {
    return imageLayer;
  }
  const window: [number, number] = [
    config.min ?? layer.defaultValueRange[0],
    config.max ?? layer.defaultValueRange[1],
  ];
  const range = config.intensityRange ?? layer.defaultValueRange;
  return {
    ...imageLayer,
    shader: IMAGE_LAYER_SHADER,
    shaderControls: {
      normalized: { range: [range[0], range[1]], window },
      color: rgbToHex(config.color),
      gamma: config.gammaCorrectionValue,
      invert: config.isInverted,
    },
  };
}

function buildSegmentationLayer(layer: NeuroglancerLayerInput): NeuroglancerLayer {
  const { config } = layer;
  return {
    type: "segmentation",
    name: layer.name,
    source: getSource(layer.url),
    visible: config != null ? !config.isDisabled && config.alpha > 0 : true,
    ...(config != null ? { selectedAlpha: config.alpha / 100 } : {}),
  };
}

export function buildNeuroglancerState(input: NeuroglancerStateInput): NeuroglancerState {
  const voxelSizeInNm = convertVoxelSizeToUnit(input.voxelSize, UnitShort.nm);
  const [x, y, z] = voxelSizeInNm.map((value) => value * 1e-9);
  const layers = [
    ...input.colorLayers.map(buildImageLayer),
    ...input.segmentationLayers.map(buildSegmentationLayer),
  ];
  return {
    dimensions: { x: [x, "m"], y: [y, "m"], z: [z, "m"] },
    position: input.position,
    // In WEBKNOSSOS, one screen pixel corresponds to zoomStep base voxels (the base voxel being
    // the smallest voxel dimension). Neuroglancer measures the cross section scale in canonical
    // voxels per screen pixel, which also refers to the smallest dimension, so the values map 1:1.
    crossSectionScale: input.zoomStep,
    // The projection scale is measured in canonical voxels per viewport height.
    projectionScale: input.zoomStep * input.viewportHeight,
    layout: "4panel",
    layers,
  };
}

export function buildNeuroglancerUrl(state: NeuroglancerState): string {
  return `${NEUROGLANCER_URL}#!${encodeURIComponent(JSON.stringify(state))}`;
}

export function buildFijiUrl(zarrUrl: string): string {
  return `fiji://open/url?p=${encodeURIComponent(zarrUrl)}`;
}
