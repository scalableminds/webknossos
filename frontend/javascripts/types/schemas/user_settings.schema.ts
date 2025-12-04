import { baseDatasetViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import {
  FillModeEnum,
  InterpolationModeEnum,
  OverwriteModeEnum,
  TDViewDisplayModeEnum,
} from "viewer/constants";
import { getMaximumBrushSize } from "viewer/model/accessors/volumetracing_accessor";

export const userSettings = {
  clippingDistance: {
    type: "number",
    minimum: 1,
    maximum: 12000,
  },
  clippingDistanceArbitrary: {
    type: "number",
    minimum: 1,
    maximum: 127,
  },
  crosshairSize: {
    type: "number",
    minimum: 0.05,
    maximum: 0.5,
  },
  displayCrosshair: {
    type: "boolean",
  },
  displayScalebars: {
    type: "boolean",
  },
  dynamicSpaceDirection: {
    type: "boolean",
  },
  keyboardDelay: {
    type: "number",
    minimum: 0,
    maximum: 500,
  },
  mouseRotateValue: {
    type: "number",
    minimum: 0.0001,
    maximum: 0.02,
  },
  moveValue: {
    type: "number",
    minimum: 30,
    maximum: 14000,
  },
  moveValue3d: {
    type: "number",
    minimum: 30,
    maximum: 14000,
  },
  newNodeNewTree: {
    type: "boolean",
  },
  centerNewNode: {
    type: "boolean",
  },
  highlightCommentedNodes: {
    type: "boolean",
  },
  // The node radius is the actual radius of the node in nm, it's dependent on zoom and dataset scale
  nodeRadius: {
    type: "number",
    minimum: 1,
    maximum: 5000,
  },
  overrideNodeRadius: {
    type: "boolean",
  },
  // The particle size is measured in pixels - it's independent of zoom and dataset scale
  particleSize: {
    type: "number",
    minimum: 1,
    maximum: 20,
  },
  radius: {
    type: "number",
    minimum: 1,
    maximum: 5000,
  },
  rotateValue: {
    type: "number",
    minimum: 0.001,
    maximum: 0.08,
  },
  sortCommentsAsc: {
    type: "boolean",
  },
  sortTreesByName: {
    type: "boolean",
  },
  sphericalCapRadius: {
    type: "number",
    minimum: 50,
    maximum: 500,
  },
  tdViewDisplayPlanes: {
    type: "string",
    enum: Object.values(TDViewDisplayModeEnum),
  },
  tdViewDisplayDatasetBorders: {
    type: "boolean",
  },
  tdViewDisplayLayerBorders: {
    type: "boolean",
  },
  hideTreeRemovalWarning: {
    type: "boolean",
  },
  // Note that the `maximum` limit is a theoretical one. An actual upper limit
  // is computed depending on the existing magnifications. See
  // getMaximumBrushSize().
  brushSize: {
    type: "number",
    minimum: 1,
    maximum: 30000,
    dynamicMaximumFn: getMaximumBrushSize,
  },
  autoSaveLayouts: {
    type: "boolean",
  },
  autoRenderMeshInProofreading: {
    type: "boolean",
  },
  gpuMemoryFactor: {
    type: "number",
  },
  segmentationOpacity: {
    type: "number",
    minimum: 0,
    maximum: 100,
  },
  overwriteMode: {
    type: "string",
    enum: Object.values(OverwriteModeEnum),
  },
  fillMode: {
    type: "string",
    enum: Object.values(FillModeEnum),
  },
  interpolationMode: {
    type: "string",
    enum: Object.values(InterpolationModeEnum),
  },
  useLegacyBindings: {
    type: "boolean",
  },
  ...baseDatasetViewConfiguration,
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
