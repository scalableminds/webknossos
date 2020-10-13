// @flow

export const defaultDatasetViewConfiguration = {
  fourBit: false,
  interpolation: true,
  highlightHoveredCellId: true,
  renderIsosurfaces: false,
  renderMissingDataBlack: true,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  segmentationPatternOpacity: 40,
};

export const datasetViewConfiguration = {
  fourBit: { type: "boolean" },
  interpolation: { type: "boolean" },
  highlightHoveredCellId: { type: "boolean" },
  renderIsosurfaces: { type: "boolean" },
  zoom: { type: "number", minimum: 0.005 },
  renderMissingDataBlack: { type: "boolean" },
  loadingStrategy: { enum: ["BEST_QUALITY_FIRST", "PROGRESSIVE_QUALITY"] },
  segmentationPatternOpacity: { type: "number", minimum: 0, maximum: 100 },

  // TODO
  position: { type: "number", minimum: 0, maximum: 100 },
  rotation: { type: "number", minimum: 0, maximum: 100 },
  layers: { type: "number", minimum: 0, maximum: 100 },
};

export default {
  $schema: "http://json-schema.org/draft-06/schema#",
  definitions: {
    "types::DatasetViewConfiguration": {
      type: ["object", "null"],
      properties: datasetViewConfiguration,
      additionalProperties: false,
    },
  },
};
