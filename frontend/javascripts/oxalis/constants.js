/**
 * constants.js
 * @flow
 */

export const ViewModeValues = ["orthogonal", "flight", "oblique", "volume"]; //   MODE_PLANE_TRACING | MODE_ARBITRARY | MODE_ARBITRARY_PLANE | MODE_VOLUME
export const ViewModeValuesIndices = { Orthogonal: 0, Flight: 1, Oblique: 2, Volume: 3 };
export type ViewMode = "orthogonal" | "oblique" | "flight" | "volume";
export type Vector2 = [number, number];
export type Vector3 = [number, number, number];
export type Vector4 = [number, number, number, number];
export type Vector5 = [number, number, number, number, number];
export type Vector6 = [number, number, number, number, number, number];
export type Point2 = { x: number, y: number };
export type Point3 = { x: number, y: number, z: number };
export type ColorObject = { r: number, g: number, b: number, a: number };
export type BoundingBoxType = {
  min: Vector3,
  max: Vector3,
};
export type Rect = {
  top: number,
  left: number,
  width: number,
  height: number,
};

export const AnnotationContentTypes = ["skeleton", "volume", "hybrid"];
export const Vector2Indicies = [0, 1];
export const Vector3Indicies = [0, 1, 2];
export const Vector4Indicies = [0, 1, 2, 3];
export const Vector5Indicies = [0, 1, 2, 3, 4];
export const Vector6Indicies = [0, 1, 2, 3, 4, 5];
export const OrthoViews = {
  PLANE_XY: "PLANE_XY",
  PLANE_YZ: "PLANE_YZ",
  PLANE_XZ: "PLANE_XZ",
  TDView: "TDView",
};

export const OrthoViewsToName = {
  PLANE_XY: "XY",
  PLANE_YZ: "YZ",
  PLANE_XZ: "XZ",
  TDView: "3D",
};
export type OrthoView = $Keys<typeof OrthoViews>;
export type OrthoViewMap<T> = { [key: OrthoView]: T };
export type OrthoViewExtents = $ReadOnly<OrthoViewMap<Vector2>>;
export type OrthoViewRects = $ReadOnly<OrthoViewMap<Rect>>;

export const ArbitraryViewport = "arbitraryViewport";
export const ArbitraryViews = {
  arbitraryViewport: "arbitraryViewport",
  TDView: "TDView",
};

export const ArbitraryViewsToName = {
  arbitraryViewport: "Arbitrary View",
  TDView: "3D",
};
export type ArbitraryView = $Keys<typeof ArbitraryViews>;
export type ArbitraryViewMap<T> = { [key: ArbitraryView]: T };

export type Viewport = OrthoView | typeof ArbitraryViewport;
export const allViewports: Array<Viewport> = Object.keys(OrthoViews).concat([ArbitraryViewport]);

export type ViewportMap<T> = { [key: Viewport]: T };
export type ViewportExtents = $ReadOnly<ViewportMap<Vector2>>;
export type ViewportRects = $ReadOnly<ViewportMap<Rect>>;

export const OrthoViewValues: Array<OrthoView> = Object.keys(OrthoViews);
export const OrthoViewIndices = {
  PLANE_XY: OrthoViewValues.indexOf("PLANE_XY"),
  PLANE_YZ: OrthoViewValues.indexOf("PLANE_YZ"),
  PLANE_XZ: OrthoViewValues.indexOf("PLANE_XZ"),
  TDView: OrthoViewValues.indexOf("TDView"),
};
export const OrthoViewValuesWithoutTDView = [
  OrthoViews.PLANE_XY,
  OrthoViews.PLANE_YZ,
  OrthoViews.PLANE_XZ,
];

export const OrthoViewColors: OrthoViewMap<number> = {
  [OrthoViews.PLANE_XY]: 0xc81414, // red
  [OrthoViews.PLANE_YZ]: 0x1414c8, // blue
  [OrthoViews.PLANE_XZ]: 0x14c814, // green
  [OrthoViews.TDView]: 0xffffff,
};

export const OrthoViewCrosshairColors: OrthoViewMap<[number, number]> = {
  [OrthoViews.PLANE_XY]: [0x0000ff, 0x00ff00],
  [OrthoViews.PLANE_YZ]: [0xff0000, 0x00ff00],
  [OrthoViews.PLANE_XZ]: [0x0000ff, 0xff0000],
  [OrthoViews.TDView]: [0x000000, 0x000000],
};

export const BorderTabs = {
  DatasetInfoTabView: {
    id: "DatasetInfoTabView",
    name: "Info",
    description: "Information about the dataset",
  },
  CommentTabView: {
    id: "CommentTabView",
    name: "Comments",
    description: "Add comments to skeleton nodes",
  },
  SegmentsView: {
    id: "SegmentsView",
    name: "Segments",
    description: "Organize Segments and Meshes",
  },
  SkeletonTabView: {
    id: "SkeletonTabView",
    name: "Skeleton",
    description: "Create and organize skeletons",
  },
  AbstractTreeTab: {
    id: "AbstractTreeTab",
    name: "AbsTree",
    description: "Abstract Tree - Shows an abstract version of the active skeleton",
  },
  ControlsAndRenderingSettingsTab: {
    id: "ControlsAndRenderingSettingsTab",
    name: "Settings",
    description: "Change general settings about controls and rendering.",
  },
  BoundingBoxTab: {
    id: "BoundingBoxTab",
    name: "BBoxes",
    description: "Bounding Boxes - Add and organize bounding boxes",
  },
  LayerSettingsTab: {
    id: "LayerSettingsTab",
    name: "Layers",
    description: "Change settings of each data layer",
  },
};

export const OrthoViewGrayCrosshairColor = 0x222222;

export const ControlModeEnum = {
  TRACE: "TRACE",
  SANDBOX: "SANDBOX",
  VIEW: "VIEW",
};
export type ControlMode = $Keys<typeof ControlModeEnum>;

export const AnnotationToolEnum = {
  MOVE: "MOVE",
  SKELETON: "SKELETON",
  BRUSH: "BRUSH",
  ERASE_BRUSH: "ERASE_BRUSH",
  TRACE: "TRACE",
  ERASE_TRACE: "ERASE_TRACE",
  FILL_CELL: "FILL_CELL",
  PICK_CELL: "PICK_CELL",
  BOUNDING_BOX: "BOUNDING_BOX",
};
export const VolumeTools = [
  AnnotationToolEnum.BRUSH,
  AnnotationToolEnum.ERASE_BRUSH,
  AnnotationToolEnum.TRACE,
  AnnotationToolEnum.ERASE_TRACE,
  AnnotationToolEnum.FILL_CELL,
  AnnotationToolEnum.PICK_CELL,
];
export const ToolsWithOverwriteCapabilities = [
  AnnotationToolEnum.TRACE,
  AnnotationToolEnum.BRUSH,
  AnnotationToolEnum.ERASE_TRACE,
  AnnotationToolEnum.ERASE_BRUSH,
];
export type AnnotationTool = $Keys<typeof AnnotationToolEnum>;

export function annotationToolEnumToIndex(annotationTool: ?AnnotationTool): number {
  return Object.keys(AnnotationToolEnum).indexOf(annotationTool);
}

export const ContourModeEnum = {
  DRAW: "DRAW",
  DELETE: "DELETE",
};
export type ContourMode = $Keys<typeof ContourModeEnum>;

export const OverwriteModeEnum = {
  OVERWRITE_ALL: "OVERWRITE_ALL",
  OVERWRITE_EMPTY: "OVERWRITE_EMPTY", // In case of deleting, empty === current cell id
};
export type OverwriteMode = $Keys<typeof OverwriteModeEnum>;

export const FillModeEnum = {
  // The leading underscore is a workaround, since leading numbers are not valid identifiers
  // in JS.
  _2D: "_2D",
  _3D: "_3D",
};
export type FillMode = $Keys<typeof FillModeEnum>;

export const TDViewDisplayModeEnum = {
  NONE: "NONE",
  WIREFRAME: "WIREFRAME",
  DATA: "DATA",
};

export type TDViewDisplayMode = $Keys<typeof TDViewDisplayModeEnum>;

export const MappingStatusEnum = {
  DISABLED: "DISABLED",
  ACTIVATING: "ACTIVATING",
  ENABLED: "ENABLED",
};
export type MappingStatus = $Keys<typeof MappingStatusEnum>;

export const NODE_ID_REF_REGEX = /#([0-9]+)/g;
export const POSITION_REF_REGEX = /#\(([0-9]+,[0-9]+,[0-9]+)\)/g;

// The plane in orthogonal mode is a little smaller than the viewport
// There is an outer yellow CSS border and an inner (red/green/blue) border
// that is a result of the plane being smaller than the renderer viewport
export const OUTER_CSS_BORDER = 2;
const VIEWPORT_WIDTH = 376;
export const ensureSmallerEdge = false;

export const Unicode = {
  ThinSpace: "\u202f",
  NonBreakingSpace: "\u00a0",
  MultiplicationSymbol: "×",
};

// A LabeledVoxelsMap maps from a bucket address
// to a 2D slice of labeled voxels. These labeled voxels
// are stored in a Uint8Array in a binary way (which cell
// id the voxels should be changed to is not encoded).
export type LabeledVoxelsMap = Map<Vector4, Uint8Array>;
// LabelMasksByBucketAndW is similar to LabeledVoxelsMap with the difference
// that it can hold multiple slices per bucket (keyed by the W component,
// e.g., z in XY viewport).
export type LabelMasksByBucketAndW = Map<Vector4, Map<number, Uint8Array>>;

export type ShowContextMenuFunction = (
  number,
  number,
  ?number,
  ?number,
  Vector3,
  OrthoView,
) => void;

const Constants = {
  ARBITRARY_VIEW: 4,
  DEFAULT_BORDER_WIDTH: 400,
  DEFAULT_BORDER_WIDTH_IN_IFRAME: 200,

  MODE_PLANE_TRACING: "orthogonal",
  MODE_ARBITRARY: "flight",
  MODE_ARBITRARY_PLANE: "oblique",
  MODE_VOLUME: "volume",
  MODES_PLANE: ["orthogonal", "volume"],
  MODES_ARBITRARY: ["flight", "oblique"],
  MODES_SKELETON: ["orthogonal", "flight", "oblique"],

  BUCKET_WIDTH: 32,
  BUCKET_SIZE: 32 ** 3,
  VIEWPORT_WIDTH,
  // The area of the maximum radius (pi * 300 ^ 2) is 282690.
  // We multiply this with 5, since the labeling is not done
  // during mouse movement, but afterwards. So, a bit of a
  // waiting time should be acceptable.
  AUTO_FILL_AREA_LIMIT: 5 * 282690,

  // The amount of buckets which is required per layer can be customized
  // via the settings. The value which we expose for customization is a factor
  // which will be multiplied with GPU_FACTOR_MULTIPLIER to calculate the
  // the actual amount of buckets.
  GPU_FACTOR_MULTIPLIER: 512,
  DEFAULT_GPU_MEMORY_FACTOR: 3,
  DEFAULT_LOOK_UP_TEXTURE_WIDTH: 256,

  MAX_ZOOM_STEP_DIFF_PREFETCH: 1, // prefetch only fallback buckets for currentZoomStep + 1

  FPS: 50,

  DEFAULT_SPHERICAL_CAP_RADIUS: 140,

  RESIZE_THROTTLE_TIME: 50,

  MIN_TREE_ID: 1,
  MIN_NODE_ID: 1,

  // Maximum of how many buckets will be held in RAM (per layer)
  MAXIMUM_BUCKET_COUNT_PER_LAYER: 5000,

  FLOOD_FILL_EXTENTS: {
    _2D: process.env.BABEL_ENV === "test" ? [512, 512, 1] : [768, 768, 1],
    _3D: process.env.BABEL_ENV === "test" ? [64, 64, 32] : [96, 96, 96],
  },
};

export default Constants;
