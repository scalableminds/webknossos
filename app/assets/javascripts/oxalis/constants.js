/**
 * constants.js
 * @flow
 */

export const ModeValues = [0, 1, 2, 3];
export type VolumeModeType = 0 | 1;
export type ModeType = 0 | 1 | 2 | 3;
export type Vector2 = [number, number];
export type Vector3 = [number, number, number];
export type Vector4 = [number, number, number, number];
export type Vector5 = [number, number, number, number, number];
export type Vector6 = [number, number, number, number, number, number];
export type Point2 = { x: number, y: number };
export type Point3 = { x: number, y: number, z: number };
// TODO replace with BoundingBoxType
export type Extent3 = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export const OrthoViews = {
  PLANE_XY: "PLANE_XY",
  PLANE_YZ: "PLANE_YZ",
  PLANE_XZ: "PLANE_XZ",
  TDView: "TDView",
};
export const OrthoViewsWithoutTDView = [
  OrthoViews.PLANE_XY,
  OrthoViews.PLANE_YZ,
  OrthoViews.PLANE_XZ,
];
export type OrthoViewType = $Keys<typeof OrthoViews>;
export type OrthoViewMapType<T> = { [key: OrthoViewType]: T };

// TODO: Get rid of this
export const OrthoViewToNumber: OrthoViewMapType<number> = {
  [OrthoViews.PLANE_XY]: 0,
  [OrthoViews.PLANE_YZ]: 1,
  [OrthoViews.PLANE_XZ]: 2,
  [OrthoViews.TDView]: 3,
};
export const OrthoViewColors: OrthoViewMapType<number> = {
  [OrthoViews.PLANE_XY]: 0xff0000,
  [OrthoViews.PLANE_YZ]: 0x0000ff,
  [OrthoViews.PLANE_XZ]: 0x00ff00,
  [OrthoViews.TDView]: 0xffffff,
};

const Constants = {
  ARBITRARY_VIEW: 4,

  MODE_PLANE_TRACING: 0,
  MODE_ARBITRARY: 1,
  MODE_ARBITRARY_PLANE: 2,
  MODE_VOLUME: 3,
  MODES_PLANE: [0, 3],
  MODES_ARBITRARY: [1, 2],
  MODES_SKELETON: [0, 1, 2],
  MODE_NAME_TO_ID: {
    orthogonal: 0,
    flight: 1,
    oblique: 2,
    volume: 3,
  },

  CONTROL_MODE_TRACE: 0,
  CONTROL_MODE_VIEW: 1,

  VOLUME_MODE_MOVE: 0,
  VOLUME_MODE_TRACE: 1,

  DEFAULT_SEG_ALPHA: 20,

  THEME_BRIGHT: 0,
  THEME_DARK: 1,

  PLANE_WIDTH: 376,
  VIEWPORT_WIDTH: 384,
  TEXTURE_WIDTH: 512,
  TEXTURE_SIZE_P: 9,
  DISTANCE_3D: 140,

  TDView_MOVE_SPEED: 150,
  MIN_MOVE_VALUE: 30,
  MAX_MOVE_VALUE: 14000,
  MAX_MOVE_VALUE_SLIDER: 1500,

  FPS: 50,

  MIN_SCALE: 0.05,
  MAX_SCALE: 20,

  MIN_PARTICLE_SIZE: 1,
  MAX_PARTICLE_SIZE: 20,

  ZOOM_DIFF: 0.1,

  RESIZE_THROTTLE_TIME: 250,
  BRANCHPOINT_VIDEO_CLIPPING_DISTANCE: 3,
};

export default Constants;
