/**
 * constants.js
 * @flow
 */

export const ModeValues = ["orthogonal", "flight", "oblique", "volume"]; //   MODE_PLANE_TRACING | MODE_ARBITRARY | MODE_ARBITRARY_PLANE | MODE_VOLUME
export const ModeValuesIndices = { Orthogonal: 0, Flight: 1, Oblique: 2, Volume: 3 };
export type Mode = "orthogonal" | "oblique" | "flight" | "volume";
export type Vector2 = [number, number];
export type Vector3 = [number, number, number];
export type Vector4 = [number, number, number, number];
export type Vector5 = [number, number, number, number, number];
export type Vector6 = [number, number, number, number, number, number];
export type Point2 = { x: number, y: number };
export type Point3 = { x: number, y: number, z: number };
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
export const ArbitraryViewport = "arbitraryViewport";
export type OrthoView = $Keys<typeof OrthoViews>;
export type OrthoViewMap<T> = { [key: OrthoView]: T };
export type Viewport = OrthoView | typeof ArbitraryViewport;
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
  [OrthoViews.PLANE_XY]: 0xff0000,
  [OrthoViews.PLANE_YZ]: 0x0000ff,
  [OrthoViews.PLANE_XZ]: 0x00ff00,
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
// as there are two borders (e.g., yellow and red) with width 2px each => 8px
export const OUTER_BORDER_ORTHO = 4;
const PLANE_WIDTH = 376;
const VIEWPORT_WIDTH = PLANE_WIDTH + OUTER_BORDER_ORTHO * 2;

const Constants = {
  ARBITRARY_VIEW: 4,

  MODE_PLANE_TRACING: "orthogonal",
  MODE_ARBITRARY: "flight",
  MODE_ARBITRARY_PLANE: "oblique",
  MODE_VOLUME: "volume",
  MODES_PLANE: ["orthogonal", "volume"],
  MODES_ARBITRARY: ["flight", "oblique"],
  MODES_SKELETON: ["orthogonal", "flight", "oblique"],

  DEFAULT_SEG_ALPHA: 20,

  BUCKET_WIDTH: 32,
  BUCKET_SIZE: 32 ** 3,
  PLANE_WIDTH,
  VIEWPORT_WIDTH,
  // The size of the gap between the 4 viewports in the orthogonal mode
  VIEWPORT_GAP_WIDTH: 20,

  // We require at least 3 * 512 === 1536 buckets per data layer to fit onto the GPU.
  // This number is used during setup to pick appropriate data texture sizes.
  // Previously, a minimum of 1200 buckets was enforced. Since, this limit required at least
  // three 4096**2 textures, a minimum of capacity of 1536 is actually reasonable.
  MINIMUM_REQUIRED_BUCKET_CAPACITY: 3 * 512,
  DISTANCE_3D: 140,
  MAX_TEXTURE_COUNT_PER_LAYER: 1,
  LOOK_UP_TEXTURE_WIDTH: 128,

  TDView_MOVE_SPEED: 150,
  MIN_MOVE_VALUE: 30,
  MAX_MOVE_VALUE: 14000,
  MAX_MOVE_VALUE_SLIDER: 1500,

  FPS: 50,

  MIN_LAYOUT_SCALE: 1,
  MAX_LAYOUT_SCALE: 5,

  MIN_BRUSH_SIZE: 5,
  MAX_BRUSH_SIZE: 5000,

  // The node radius is the actual radius of the node in nm, it's dependent on zoom and dataset scale
  MIN_NODE_RADIUS: 1,
  MAX_NODE_RADIUS: 5000,

  // The particle size is measured in pixels - it's independent of zoom and dataset scale
  MIN_PARTICLE_SIZE: 1,
  MAX_PARTICLE_SIZE: 20,

  ZOOM_DIFF: 0.1,

  // We always add another (read: one) zoomstep level by downsampling buckets from the highest
  // available zoomstep. This allows to zoom out far enough while still being able to load enough
  // buckets to the GPU.
  DOWNSAMPLED_ZOOM_STEP_COUNT: 1,

  RESIZE_THROTTLE_TIME: 250,

  MIN_TREE_ID: 1,
  MIN_NODE_ID: 1,
};

export default Constants;
