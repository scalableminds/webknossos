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
export type OrthoView = $Keys<typeof OrthoViews>;
export type OrthoViewMap<T> = { [key: OrthoView]: T };
export type OrthoViewExtents = $ReadOnly<OrthoViewMap<Vector2>>;
export type OrthoViewRects = $ReadOnly<OrthoViewMap<Rect>>;

export const ArbitraryViewport = "arbitraryViewport";
export const ArbitraryViews = {
  arbitraryViewport: "arbitraryViewport",
  TDView: "TDView",
};
export type ArbitraryView = $Keys<typeof ArbitraryViews>;
export type ArbitraryViewMap<T> = { [key: ArbitraryView]: T };

export type Viewport = OrthoView | typeof ArbitraryViewport;

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

export const OrthoViewGrayCrosshairColor = 0x222222;

export const ControlModeEnum = {
  TRACE: "TRACE",
  VIEW: "VIEW",
};
export type ControlMode = $Keys<typeof ControlModeEnum>;

export const VolumeToolEnum = {
  MOVE: "MOVE",
  TRACE: "TRACE",
  BRUSH: "BRUSH",
};
export type VolumeTool = $Keys<typeof VolumeToolEnum>;

export function volumeToolEnumToIndex(volumeTool: ?VolumeTool): number {
  return Object.keys(VolumeToolEnum).indexOf(volumeTool);
}

export const ContourModeEnum = {
  IDLE: "IDLE",
  DRAW: "DRAW",
  DRAW_OVERWRITE: "DRAW_OVERWRITE",
  DELETE_FROM_ACTIVE_CELL: "DELETE_FROM_ACTIVE_CELL",
  DELETE_FROM_ANY_CELL: "DELETE_FROM_ANY_CELL",
};
export type ContourMode = $Keys<typeof ContourModeEnum>;

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
  MultiplicationSymbol: "×",
};

const Constants = {
  ARBITRARY_VIEW: 4,

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
  // About the area the brush reaches at maximum radius (pi * 300 ^ 2).
  AUTO_FILL_AREA_LIMIT: 200000,

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

  RESIZE_THROTTLE_TIME: 250,

  MIN_TREE_ID: 1,
  MIN_NODE_ID: 1,
};

export default Constants;
