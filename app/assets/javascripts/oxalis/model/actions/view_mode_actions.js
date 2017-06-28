// @flow

import type { OrthoViewType } from "oxalis/constants";

type SetViewportActionType = {
  type: "SET_VIEWPORT",
  viewport: OrthoViewType,
};


export const setViewportAction = (viewport: OrthoViewType): SetViewportActionType => ({
  type: "SET_VIEWPORT",
  viewport,
});

export type ViewModeActionType = SetViewportActionType;

export default {};
