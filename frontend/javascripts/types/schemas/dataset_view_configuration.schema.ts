import { BLEND_MODES } from "oxalis/constants";
import type { DatasetConfiguration, DatasetLayerConfiguration } from "oxalis/store";

export function getDefaultLayerViewConfiguration(
  dynamicDefault: Partial<DatasetLayerConfiguration> = {},
): Partial<DatasetLayerConfiguration> {
  // Note that these values will only be used as a default,
  // if the property is marked as required in the corresponding JSON schema.

  const defaultLayerViewConfiguration: Partial<DatasetLayerConfiguration> = {
    color: [255, 255, 255],
    alpha: 100,
    gammaCorrectionValue: 1,
    isDisabled: false,
    isInverted: false,
    isInEditMode: false,
    mapping: null,
  };
  return { ...defaultLayerViewConfiguration, ...dynamicDefault };
}

export const defaultIntensityRange = [0, 255];

// Note that these values will only be used as a default,
// if the property is marked as required in the corresponding JSON schema.
export const layerViewConfiguration = {
  color: {
    type: "array",
    items: {
      type: "number",
    },
    minItems: 3,
    maxItems: 3,
  },
  alpha: {
    type: "number",
    minimum: 0,
    maximum: 100,
  },
  gammaCorrectionValue: {
    type: "number",
    minimum: 0,
    maximum: 10,
  },
  intensityRange: {
    type: "array",
    items: {
      type: "number",
    },
    minItems: 2,
    maxItems: 2,
  },
  min: {
    type: "number",
  },
  max: {
    type: "number",
  },
  isDisabled: {
    type: "boolean",
  },
  isInverted: {
    type: "boolean",
  },
  isInEditMode: {
    type: "boolean",
  },
  mapping: {
    type: ["object", "null"],
    properties: {
      name: {
        type: "string",
      },
      type: {
        type: "string",
      },
    },
    required: ["name", "type"],
    additionalProperties: false,
  },
};
export const defaultDatasetViewConfigurationWithoutNull: DatasetConfiguration = {
  fourBit: false,
  interpolation: false,
  renderMissingDataBlack: false,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  segmentationPatternOpacity: 40,
  layers: {},
  blendMode: BLEND_MODES.Additive,
  colorLayerOrder: [],
  nativelyRenderedLayerName: null,
  selectiveSegmentVisibility: false,
};
export const defaultDatasetViewConfiguration = {
  ...defaultDatasetViewConfigurationWithoutNull,
  zoom: null,
  position: null,
  rotation: null,
};
export const baseDatasetViewConfiguration = {
  fourBit: {
    type: "boolean",
  },
  interpolation: {
    type: "boolean",
  },
  zoom: {
    type: "number",
    minimum: 0.005,
  },
  renderMissingDataBlack: {
    type: "boolean",
  },
  loadingStrategy: {
    enum: ["BEST_QUALITY_FIRST", "PROGRESSIVE_QUALITY"],
  },
  segmentationPatternOpacity: {
    type: "number",
    minimum: 0,
    maximum: 100,
  },
  blendMode: {
    enum: Object.values(BLEND_MODES),
  },
};
export const datasetViewConfiguration = {
  ...baseDatasetViewConfiguration,
  position: {
    type: "array",
    items: {
      type: "number",
    },
    minItems: 3,
    maxItems: 3,
  },
  rotation: {
    type: "array",
    items: {
      type: "number",
    },
    minItems: 3,
    maxItems: 3,
  },
  layers: {
    type: "object",
  },
  colorLayerOrder: {
    type: "array",
    items: {
      type: "string",
    },
  },
};
export default {
  $schema: "http://json-schema.org/draft-06/schema#",
  definitions: {
    "types::OptionalDatasetViewConfiguration": {
      type: ["object", "null"],
      properties: datasetViewConfiguration,
      additionalProperties: false,
    },
    "types::DatasetViewConfiguration": {
      type: "object",
      properties: datasetViewConfiguration,
      additionalProperties: false,
      required: [
        "fourBit",
        "interpolation",
        "renderMissingDataBlack",
        "loadingStrategy",
        "segmentationPatternOpacity",
        "layers",
        "colorLayerOrder",
      ],
    },
    "types::OptionalLayerViewConfiguration": {
      type: ["object", "null"],
      properties: layerViewConfiguration,
      additionalProperties: false,
    },
    "types::LayerViewConfiguration": {
      type: "object",
      properties: layerViewConfiguration,
      additionalProperties: false,
      required: [
        "color",
        "alpha",
        "gammaCorrectionValue",
        "isDisabled",
        "isInverted",
        "isInEditMode",
      ],
    },
    "types::LayerViewConfigurationObject": {
      type: "object",
      additionalProperties: {
        $ref: "#/definitions/types::OptionalLayerViewConfiguration",
      },
    },
  },
};
