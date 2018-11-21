// @flow

import * as THREE from "three";

import type { PartialCameraData } from "oxalis/store";
import { getTDViewportSize } from "oxalis/model/accessors/view_mode_accessor";
import constants, { type OrthoView, type Rect, type Viewport } from "oxalis/constants";

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
  targetPosition: THREE.Vector3,
  curWidth: number,
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
  targetPosition: THREE.Vector3,
  curWidth: number,
): ZoomTDViewAction => ({
  type: "ZOOM_TD_VIEW",
  value,
  targetPosition,
  curWidth,
});

export const moveTDViewByVectorAction = (x: number, y: number): MoveTDViewByVectorAction => ({
  type: "MOVE_TD_VIEW_BY_VECTOR",
  x,
  y,
});

export const moveTDViewXAction = (x: number): MoveTDViewByVectorAction =>
  moveTDViewByVectorAction((x * getTDViewportSize()) / constants.VIEWPORT_WIDTH, 0);

export const moveTDViewYAction = (y: number): MoveTDViewByVectorAction =>
  moveTDViewByVectorAction(0, (-y * getTDViewportSize()) / constants.VIEWPORT_WIDTH);

export const setInputCatcherRect = (viewport: Viewport, rect: Rect): SetInputCatcherRect => ({
  type: "SET_INPUT_CATCHER_RECT",
  viewport,
  rect,
});

export type ViewModeAction =
  | SetViewportAction
  | SetTDCameraAction
  | CenterTDViewAction
  | ZoomTDViewAction
  | MoveTDViewByVectorAction
  | SetInputCatcherRect;

export default {};
