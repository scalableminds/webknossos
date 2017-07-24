// @flow

import constants from "oxalis/constants";
import type { OrthoViewType } from "oxalis/constants";
import type { PartialCameraData } from "oxalis/store";
import * as THREE from "three";
import { getTDViewportSize } from "oxalis/model/accessors/view_mode_accessor";

type SetViewportActionType = {
  type: "SET_VIEWPORT",
  viewport: OrthoViewType,
};

type SetTDCameraActionType = {
  type: "SET_TD_CAMERA",
  cameraData: PartialCameraData,
}

type CenterTDViewActionType = {
  type: "CENTER_TD_VIEW",
};

type ZoomTDViewActionType = {
  type: "ZOOM_TD_VIEW",
  value: number,
  targetPosition: THREE.Vector3,
  curWidth: number,
};

type MoveTDViewByVectorActionType = {
  type: "MOVE_TD_VIEW_BY_VECTOR",
  x: number,
  y: number,
};

export const setViewportAction = (viewport: OrthoViewType): SetViewportActionType => ({
  type: "SET_VIEWPORT",
  viewport,
});

export const setTDCameraAction = (cameraData: PartialCameraData): SetTDCameraActionType => ({
  type: "SET_TD_CAMERA",
  cameraData,
});

export const centerTDViewAction = (): CenterTDViewActionType => ({
  type: "CENTER_TD_VIEW",
});

export const zoomTDViewAction = (value: number, targetPosition: THREE.Vector3, curWidth: number): ZoomTDViewActionType => ({
  type: "ZOOM_TD_VIEW",
  value,
  targetPosition,
  curWidth,
});

export const moveTDViewByVectorAction = (x: number, y: number): MoveTDViewByVectorActionType => ({
  type: "MOVE_TD_VIEW_BY_VECTOR",
  x,
  y,
});

export const moveTDViewXAction = (x: number): MoveTDViewByVectorActionType =>
  moveTDViewByVectorAction((x * getTDViewportSize()) / constants.VIEWPORT_WIDTH, 0);

export const moveTDViewYAction = (y: number): MoveTDViewByVectorActionType =>
  moveTDViewByVectorAction(0, (-y * getTDViewportSize()) / constants.VIEWPORT_WIDTH);

export type ViewModeActionType =
    SetViewportActionType
  | SetTDCameraActionType
  | CenterTDViewActionType
  | ZoomTDViewActionType
  | MoveTDViewByVectorActionType;

export default {};
