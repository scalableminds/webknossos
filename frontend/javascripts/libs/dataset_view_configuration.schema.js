// @flow

export function getDefaultLayerViewConfiguration(dynamicDefault: Object) {
  const defaultLayerViewConfiguration = {
    color: [255, 255, 255],
    brightness: null,
    contrast: null,
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
  brightness: { type: ["number", "null"], minimum: 0.005 }, // TODO min max
  contrast: { type: ["number", "null"], minimum: 0.005 }, // TODO min max
  alpha: { type: "number", minimum: 0, maximum: 100 },
  intensityRange: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
  min: { type: ["number", "null"], minimum: 0.005 }, // TODO min max
  max: { type: ["number", "null"], minimum: 0.005 }, // TODO min max
  isDisabled: { type: "boolean" },
  isInverted: { type: "boolean" },
  isInEditMode: { type: "boolean" },
};

export const defaultDatasetViewConfiguration = {
  fourBit: false,
  interpolation: true,
  highlightHoveredCellId: true,
  renderIsosurfaces: false,
  renderMissingDataBlack: true,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  segmentationPatternOpacity: 40,
  zoom: null,
  position: null,
  rotation: null,
  layers: {},
};

export const datasetViewConfiguration = {
  fourBit: { type: "boolean" },
  interpolation: { type: "boolean" },
  highlightHoveredCellId: { type: "boolean" },
  renderIsosurfaces: { type: "boolean" },
  zoom: { type: ["number", "null"], minimum: 0.005 }, // TODO zoom max value?
  renderMissingDataBlack: { type: "boolean" },
  loadingStrategy: { enum: ["BEST_QUALITY_FIRST", "PROGRESSIVE_QUALITY"] },
  segmentationPatternOpacity: { type: "number", minimum: 0, maximum: 100 },
  position: { type: ["array", "null"], items: { type: "number" }, minItems: 3, maxItems: 3 },
  rotation: { type: ["array", "null"], items: { type: "number" }, minItems: 3, maxItems: 3 },
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
        "highlightHoveredCellId",
        "renderIsosurfaces",
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
  },
};
