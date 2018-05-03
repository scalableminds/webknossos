// @flow
import Constants, { OrthoViews, OrthoViewValues, OrthoViewColors } from "oxalis/constants";
import type { OrthoViewType, OrthoViewMapType, Vector2 } from "oxalis/constants";

export function getViewportPositionsForLayout(viewportWidth: number) {
  const widthWithMargin = viewportWidth + Constants.VIEWPORT_GAP_WIDTH;

  return {
    [OrthoViews.PLANE_XY]: [0, 0],
    [OrthoViews.PLANE_YZ]: [widthWithMargin, 0],
    [OrthoViews.PLANE_XZ]: [0, widthWithMargin],
    [OrthoViews.TDView]: [widthWithMargin, widthWithMargin],
  };
}

export function getCanvasExtent(viewportWidth: number): Vector2 {
  const widthWithMargin = viewportWidth + Constants.VIEWPORT_GAP_WIDTH;
  return [2 * widthWithMargin, 2 * widthWithMargin];
}

export default {};
