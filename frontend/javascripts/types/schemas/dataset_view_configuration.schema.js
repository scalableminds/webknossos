// @flow

export function getDefaultLayerViewConfiguration(dynamicDefault: Object = {}) {
  const defaultLayerViewConfiguration = {
    color: [255, 255, 255],
    alpha: 100,
    intensityRange: [0, 255],
    min: null,
    max: null,
    isDisabled: false,
    isInverted: false,
    isInEditMode: false,
  };
  return {
    ...defaultLayerViewConfiguration,
    ...dynamicDefault,
  };
}

export const layerViewConfiguration = {
  color: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  alpha: { type: "number", minimum: 0, maximum: 100 },
  intensityRange: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
  min: { type: "number" },
  max: { type: "number" },
  isDisabled: { type: "boolean" },
  isInverted: { type: "boolean" },
  isInEditMode: { type: "boolean" },
};

export const defaultDatasetViewConfigurationWithoutNull = {
  fourBit: false,
  interpolation: true,
  renderMissingDataBlack: false,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  segmentationPatternOpacity: 40,
  layers: {},
};

export const defaultDatasetViewConfiguration = {
  ...defaultDatasetViewConfigurationWithoutNull,
  zoom: null,
  position: null,
  rotation: null,
};

export const baseDatasetViewConfiguration = {
  fourBit: { type: "boolean" },
  interpolation: { type: "boolean" },
  zoom: { type: "number", minimum: 0.005 },
  renderMissingDataBlack: { type: "boolean" },
  loadingStrategy: { enum: ["BEST_QUALITY_FIRST", "PROGRESSIVE_QUALITY"] },
  segmentationPatternOpacity: { type: "number", minimum: 0, maximum: 100 },
};

export const datasetViewConfiguration = {
  ...baseDatasetViewConfiguration,
  position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  layers: { type: "object" },
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
      required: ["color", "alpha", "intensityRange", "isDisabled", "isInverted", "isInEditMode"],
    },
    "types::LayerViewConfigurationObject": {
      type: "object",
      additionalProperties: { $ref: "#/definitions/types::OptionalLayerViewConfiguration" },
    },
  },
};
