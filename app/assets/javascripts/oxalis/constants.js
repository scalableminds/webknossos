/**
 * constants.js
 * @flow
 */

export const ModeValues = [0, 1, 2, 3]; //   MODE_PLANE_TRACING | MODE_ARBITRARY | MODE_ARBITRARY_PLANE | MODE_VOLUME
export type VolumeTraceOrMoveModeType = 0 | 1; // VOLUME_MODE_MOVE | VOLUME_MODE_TRACE
export type ModeType = 0 | 1 | 2 | 3;
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
export const OrthoViewValues = Object.keys(OrthoViews);
export const OrthoViewValuesWithoutTDView = [
  OrthoViews.PLANE_XY,
  OrthoViews.PLANE_YZ,
  OrthoViews.PLANE_XZ,
];
export type OrthoViewType = $Keys<typeof OrthoViews>;
export type OrthoViewMapType<T> = { [key: OrthoViewType]: T };

export const OrthoViewColors: OrthoViewMapType<number> = {
  [OrthoViews.PLANE_XY]: 0xff0000,
  [OrthoViews.PLANE_YZ]: 0x0000ff,
  [OrthoViews.PLANE_XZ]: 0x00ff00,
  [OrthoViews.TDView]: 0xffffff,
};

export const OrthoViewCrosshairColors: OrthoViewMapType<[number, number]> = {
  [OrthoViews.PLANE_XY]: [0x0000ff, 0x00ff00],
  [OrthoViews.PLANE_YZ]: [0xff0000, 0x00ff00],
  [OrthoViews.PLANE_XZ]: [0x0000ff, 0xff0000],
  [OrthoViews.TDView]: [0x000000, 0x000000],
};

export const OrthoViewGrayCrosshairColor = 0x222222;

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
