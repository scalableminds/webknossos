import * as THREE from "three";
import type { PartialCameraData } from "oxalis/store";
import type { OrthoView, Rect, Viewport, ViewportRects } from "oxalis/constants";
type SetViewportAction = {
  type: "SET_VIEWPORT";
  viewport: OrthoView;
};
type SetTDCameraAction = {
  type: "SET_TD_CAMERA";
  cameraData: PartialCameraData;
};
type CenterTDViewAction = {
  type: "CENTER_TD_VIEW";
};
type ZoomTDViewAction = {
  type: "ZOOM_TD_VIEW";
  value: number;
  targetPosition: THREE.Vector3;
  curWidth: number;
  curHeight: number;
};
type MoveTDViewByVectorAction = {
  type: "MOVE_TD_VIEW_BY_VECTOR";
  x: number;
  y: number;
};
type MoveTDViewToPositionAction = {
  type: "MOVE_TD_VIEW_TO_POSITION";
  x: number;
  y: number;
  z: number;
};
type MoveTDViewToPositionWithoutTimeTrackingAction = {
  type: "MOVE_TD_VIEW_TO_POSITION_WITHOUT_TIME_TRACKING";
  x: number;
  y: number;
  z: number;
};
// These two actions are used instead of their functionally identical counterparts
// (without the `_WITHOUT_TIME_TRACKING` suffix)
// when dispatching these actions should not trigger the save queue diffing.
// Therefore, the save queue will not become dirty and no time is tracked by the backend.
// The actions are used by initialization code and by the `setTargetAndFixPosition`
// workaround in the td_controller.js.
type SetTDCameraWithoutTimeTrackingAction = {
  type: "SET_TD_CAMERA_WITHOUT_TIME_TRACKING";
  cameraData: PartialCameraData;
};
type MoveTDViewByVectorWithoutTimeTrackingAction = {
  type: "MOVE_TD_VIEW_BY_VECTOR_WITHOUT_TIME_TRACKING";
  x: number;
  y: number;
};
type SetInputCatcherRect = {
  type: "SET_INPUT_CATCHER_RECT";
  viewport: Viewport;
  rect: Rect;
};
type SetInputCatcherRects = {
  type: "SET_INPUT_CATCHER_RECTS";
  viewportRects: ViewportRects;
};
export const setViewportAction = (viewport: OrthoView): SetViewportAction => ({
  type: "SET_VIEWPORT",
  viewport,
});
export const setTDCameraAction = (cameraData: PartialCameraData): SetTDCameraAction => ({
  type: "SET_TD_CAMERA",
  cameraData,
});
// See the explanation further up for when to use this action instead of the setTDCameraAction
export const setTDCameraWithoutTimeTrackingAction = (
  cameraData: PartialCameraData,
): SetTDCameraWithoutTimeTrackingAction => ({
  type: "SET_TD_CAMERA_WITHOUT_TIME_TRACKING",
  cameraData,
});
export const centerTDViewAction = (): CenterTDViewAction => ({
  type: "CENTER_TD_VIEW",
});
export const zoomTDViewAction = (
  value: number,
  targetPosition: THREE.Vector3,
  curWidth: number,
  curHeight: number,
): ZoomTDViewAction => ({
  type: "ZOOM_TD_VIEW",
  value,
  targetPosition,
  curWidth,
  curHeight,
});
export const moveTDViewByVectorAction = (x: number, y: number): MoveTDViewByVectorAction => ({
  type: "MOVE_TD_VIEW_BY_VECTOR",
  x,
  y,
});
// See the explanation further up for when to use this action instead of the moveTDViewByVectorAction
export const moveTDViewByVectorWithoutTimeTrackingAction = (
  x: number,
  y: number,
): MoveTDViewByVectorWithoutTimeTrackingAction => ({
  type: "MOVE_TD_VIEW_BY_VECTOR_WITHOUT_TIME_TRACKING",
  x,
  y,
});
export const moveTDViewToPositionWithoutTimeTrackingAction = (
  x: number,
  y: number,
  z: number,
): MoveTDViewToPositionWithoutTimeTrackingAction => ({
  type: "MOVE_TD_VIEW_TO_POSITION_WITHOUT_TIME_TRACKING",
  x,
  y,
  z,
});
export const moveTDViewToPositionAction = (
  x: number,
  y: number,
  z: number,
): MoveTDViewToPositionAction => ({
  type: "MOVE_TD_VIEW_TO_POSITION",
  x,
  y,
  z,
});
export const setInputCatcherRect = (viewport: Viewport, rect: Rect): SetInputCatcherRect => ({
  type: "SET_INPUT_CATCHER_RECT",
  viewport,
  rect,
});
export const setInputCatcherRects = (viewportRects: ViewportRects): SetInputCatcherRects => ({
  type: "SET_INPUT_CATCHER_RECTS",
  viewportRects,
});
export type ViewModeAction =
  | SetViewportAction
  | SetTDCameraAction
  | SetTDCameraWithoutTimeTrackingAction
  | CenterTDViewAction
  | ZoomTDViewAction
  | MoveTDViewByVectorAction
  | MoveTDViewByVectorWithoutTimeTrackingAction
  | SetInputCatcherRect
  | SetInputCatcherRects
  | MoveTDViewToPositionAction
  | MoveTDViewToPositionWithoutTimeTrackingAction;
export const ViewModeSaveRelevantActions = [
  "SET_TD_CAMERA",
  "CENTER_TD_VIEW",
  "ZOOM_TD_VIEW",
  "MOVE_TD_VIEW_BY_VECTOR",
];
export default {};
