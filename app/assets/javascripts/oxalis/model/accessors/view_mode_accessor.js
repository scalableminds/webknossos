// @flow

import Store from "oxalis/store";

export function getTDViewportSize(): number {
  // the viewport is always quadratic
  const camera = Store.getState().viewModeData.plane.tdCamera;
  return camera.right - camera.left;
}

export default {};