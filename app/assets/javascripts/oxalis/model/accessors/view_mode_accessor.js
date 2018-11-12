// @flow

import Store from "oxalis/store";
import constants, { ArbitraryViewport, type Rect, type Viewport } from "oxalis/constants";

export function getTDViewportSize(): number {
  // the viewport is always quadratic
  const camera = Store.getState().viewModeData.plane.tdCamera;
  return camera.right - camera.left;
}

export function getInputCatcherRect(viewport: Viewport): Rect {
  if (viewport === ArbitraryViewport) {
    return Store.getState().viewModeData.arbitrary.inputCatcherRect;
  } else {
    // $FlowFixMe Flow does not understand that viewport cannot be ArbitraryViewport at this point
    return Store.getState().viewModeData.plane.inputCatcherRects[viewport];
  }
}

export function getViewportScale(viewport: Viewport): number {
  const { width } = getInputCatcherRect(viewport);
  return width / constants.VIEWPORT_WIDTH;
}

export default {};
