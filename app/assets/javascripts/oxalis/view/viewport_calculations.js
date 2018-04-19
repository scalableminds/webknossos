// @flow
import Constants, { OrthoViews, OrthoViewValues, OrthoViewColors } from "oxalis/constants";
import type { OrthoViewType, OrthoViewMapType, Vector2 } from "oxalis/constants";
import type { PlaneLayoutType } from "oxalis/store";

const twoRows = true;

export function getViewportPositionsForLayout(
  activeLayout: PlaneLayoutType,
  viewportWidth: number,
) {
  const widthWithMargin = viewportWidth + Constants.VIEWPORT_GAP_WIDTH;

  switch (activeLayout) {
    case "two-rows-two-columns": {
      return {
        [OrthoViews.PLANE_XY]: [0, 0],
        [OrthoViews.PLANE_YZ]: [widthWithMargin, 0],
        [OrthoViews.PLANE_XZ]: [0, widthWithMargin],
        [OrthoViews.TDView]: [widthWithMargin, widthWithMargin],
      };
    }
    case "one-row-four-columns": {
      return {
        [OrthoViews.PLANE_XY]: [0, 0],
        [OrthoViews.PLANE_YZ]: [widthWithMargin, 0],
        [OrthoViews.PLANE_XZ]: [2 * widthWithMargin, 0],
        [OrthoViews.TDView]: [3 * widthWithMargin, 0],
      };
    }
    default: {
      (activeLayout: empty);
      throw new Error("Unhandled branch");
    }
  }
}

export function getCanvasExtent(activeLayout: PlaneLayoutType, viewportWidth: number): Vector2 {
  const widthWithMargin = viewportWidth + Constants.VIEWPORT_GAP_WIDTH;
  switch (activeLayout) {
    case "two-rows-two-columns": {
      return [2 * widthWithMargin, 2 * widthWithMargin];
    }
    case "one-row-four-columns": {
      return [4 * widthWithMargin, widthWithMargin];
    }
    default: {
      (activeLayout: empty);
      throw new Error("Unhandled branch");
    }
  }
}

export default {};
