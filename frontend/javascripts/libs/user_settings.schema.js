// @flow

export const userSettings = {
  clippingDistance: { type: "number", minimum: 1, maximum: 12000 },
  clippingDistanceArbitrary: { type: "number", minimum: 1, maximum: 127 },
  crosshairSize: { type: "number", minimum: 0.05, maximum: 0.5 },
  displayCrosshair: { type: "boolean" },
  displayScalebars: { type: "boolean" },
  dynamicSpaceDirection: { type: "boolean" },
  keyboardDelay: { type: "number", minimum: 0, maximum: 500 },
  mouseRotateValue: { type: "number", minimum: 0.0001, maximum: 0.02 },
  moveValue: { type: "number", minimum: 30, maximum: 14000 },
  moveValue3d: { type: "number", minimum: 30, maximum: 14000 },
  newNodeNewTree: { type: "boolean" },
  highlightCommentedNodes: { type: "boolean" },
  // The node radius is the actual radius of the node in nm, it's dependent on zoom and dataset scale
  nodeRadius: { type: "number", minimum: 1, maximum: 5000 },
  overrideNodeRadius: { type: "boolean" },
  // The particle size is measured in pixels - it's independent of zoom and dataset scale
  particleSize: { type: "number", minimum: 1, maximum: 20 },
  radius: { type: "number", minimum: 1, maximum: 5000 },
  rotateValue: { type: "number", minimum: 0.001, maximum: 0.08 },
  sortCommentsAsc: { type: "boolean" },
  sortTreesByName: { type: "boolean" },
  sphericalCapRadius: { type: "number", minimum: 50, maximum: 500 },
  tdViewDisplayPlanes: { type: "boolean" },
  hideTreeRemovalWarning: { type: "boolean" },
  fourBit: { type: "boolean" },
  interpolation: { type: "boolean" },
  loadingStrategy: { enum: ["BEST_QUALITY_FIRST", "PROGRESSIVE_QUALITY"] },
  segmentationOpacity: { type: "number", minimum: 0, maximum: 100 },
  highlightHoveredCellId: { type: "boolean" },
  zoom: { type: "number", minimum: 0.005 },
  renderMissingDataBlack: { type: "boolean" },
  brushSize: { type: "number", minimum: 1, maximum: 5000 },
  segmentationPatternOpacity: { type: "number", minimum: 0, maximum: 100 },
  layoutScaleValue: { type: "number", minimum: 1, maximum: 5 },
  autoSaveLayouts: { type: "boolean" },
  gpuMemoryFactor: { type: "number" },
  // Deprecated keys kept for compatibility reasons
  quality: { type: "number", enum: [0, 1, 2] },
};

export default {
  $schema: "http://json-schema.org/draft-06/schema#",
  definitions: {
    "types::UserSettings": {
      type: ["object", "null"],
      properties: userSettings,
      additionalProperties: false,
    },
  },
};
