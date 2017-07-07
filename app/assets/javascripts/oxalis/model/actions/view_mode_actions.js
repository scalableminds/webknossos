// @flow

import type { OrthoViewType } from "oxalis/constants";
import type { PartialCameraData } from "oxalis/store";

type SetViewportActionType = {
  type: "SET_VIEWPORT",
  viewport: OrthoViewType,
};

type SetTDCameraActionType = {
	type: "SET_TD_CAMERA",
	cameraData: PartialCameraData,
}

export const setViewportAction = (viewport: OrthoViewType): SetViewportActionType => ({
  type: "SET_VIEWPORT",
  viewport,
});

export const setTDCameraAction = (cameraData: PartialCameraData): SetTDCameraActionType => ({
	type: "SET_TD_CAMERA",
	cameraData,
});

export type ViewModeActionType = SetViewportActionType | SetTDCameraActionType;

export default {};
