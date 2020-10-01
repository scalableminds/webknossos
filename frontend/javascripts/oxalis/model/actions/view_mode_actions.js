// @flow

import * as THREE from "three";

import { getTDViewportSize } from "oxalis/model/accessors/view_mode_accessor";
import Store, { type PartialCameraData } from "oxalis/store";
import constants, {
  type OrthoView,
  type Rect,
  type Viewport,
  type ViewportRects,
} from "oxalis/constants";

type SetViewportAction = {
  type: "SET_VIEWPORT",
  viewport: OrthoView,
};

type SetTDCameraAction = {
  type: "SET_TD_CAMERA",
  cameraData: PartialCameraData,
};

type CenterTDViewAction = {
  type: "CENTER_TD_VIEW",
};

type ZoomTDViewAction = {
  type: "ZOOM_TD_VIEW",
  value: number,
  targetPosition: typeof THREE.Vector3,
  curWidth: number,
  curHeight: number,
};

type MoveTDViewByVectorAction = {
  type: "MOVE_TD_VIEW_BY_VECTOR",
  x: number,
  y: number,
};

type SetInputCatcherRect = {
  type: "SET_INPUT_CATCHER_RECT",
  viewport: Viewport,
  rect: Rect,
};

type SetInputCatcherRects = {
  type: "SET_INPUT_CATCHER_RECTS",
  viewportRects: ViewportRects,
};

export const setViewportAction = (viewport: OrthoView): SetViewportAction => ({
  type: "SET_VIEWPORT",
  viewport,
});

export const setTDCameraAction = (cameraData: PartialCameraData): SetTDCameraAction => ({
  type: "SET_TD_CAMERA",
  cameraData,
});

export const centerTDViewAction = (): CenterTDViewAction => ({
  type: "CENTER_TD_VIEW",
});

export const zoomTDViewAction = (
  value: number,
  targetPosition: typeof THREE.Vector3,
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

export const moveTDViewXAction = (x: number): MoveTDViewByVectorAction => {
  const state = Store.getState();
  return moveTDViewByVectorAction((x * getTDViewportSize(state)[0]) / constants.VIEWPORT_WIDTH, 0);
};

export const moveTDViewYAction = (y: number): MoveTDViewByVectorAction => {
  const state = Store.getState();
  return moveTDViewByVectorAction(0, (-y * getTDViewportSize(state)[1]) / constants.VIEWPORT_WIDTH);
};

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
  | CenterTDViewAction
  | ZoomTDViewAction
  | MoveTDViewByVectorAction
  | SetInputCatcherRect
  | SetInputCatcherRects;

export default {};
