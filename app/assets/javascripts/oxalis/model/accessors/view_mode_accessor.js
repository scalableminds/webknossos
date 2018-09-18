// @flow

import Store from "oxalis/store";
import type { Rect, ViewportType } from "oxalis/constants";
import constants, { ArbitraryViewport } from "oxalis/constants";

export function getTDViewportSize(): number {
  // the viewport is always quadratic
  const camera = Store.getState().viewModeData.plane.tdCamera;
  return camera.right - camera.left;
}

export function getInputCatcherRect(viewport: ViewportType): Rect {
  if (viewport === ArbitraryViewport) {
    return Store.getState().viewModeData.arbitrary.inputCatcherRect;
  } else {
    // $FlowFixMe Flow does not understand that viewport cannot be ArbitraryViewport at this point
    return Store.getState().viewModeData.plane.inputCatcherRects[viewport];
  }
}

export function getViewportScale(viewport: ViewportType): number {
  const { width } = getInputCatcherRect(viewport);
  return width / constants.VIEWPORT_WIDTH;
}

export default {};
