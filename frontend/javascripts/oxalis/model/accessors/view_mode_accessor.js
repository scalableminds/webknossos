// @flow

import memoizeOne from "memoize-one";

import Store, { type OxalisState } from "oxalis/store";
import constants, {
  ArbitraryViewport,
  OUTER_CSS_BORDER,
  type OrthoViewExtents,
  type Rect,
  type Viewport,
} from "oxalis/constants";

export function getTDViewportSize(): [number, number] {
  const camera = Store.getState().viewModeData.plane.tdCamera;
  return [camera.right - camera.left, camera.top - camera.bottom];
}

export function getInputCatcherRect(state: OxalisState, viewport: Viewport): Rect {
  if (viewport === ArbitraryViewport) {
    return state.viewModeData.arbitrary.inputCatcherRect;
  } else {
    // $FlowFixMe Flow does not understand that viewport cannot be ArbitraryViewport at this point
    return state.viewModeData.plane.inputCatcherRects[viewport];
  }
}

const _getViewportExtents = memoizeOne(rects => {
  const getExtent = rect => [rect.width, rect.height];
  return {
    PLANE_XY: getExtent(rects.PLANE_XY),
    PLANE_YZ: getExtent(rects.PLANE_YZ),
    PLANE_XZ: getExtent(rects.PLANE_XZ),
    TDView: getExtent(rects.TDView),
  };
});

export function getViewportRects(state: OxalisState) {
  return state.viewModeData.plane.inputCatcherRects;
}

export function getViewportExtents(state: OxalisState): OrthoViewExtents {
  const rects = state.viewModeData.plane.inputCatcherRects;
  return _getViewportExtents(rects);
}

export function getInputCatcherAspectRatio(state: OxalisState, viewport: Viewport): number {
  const { width, height } = getInputCatcherRect(state, viewport);
  return width / height;
}

// Given a width and an aspectRatio, this function returns a [width, height] pair
// which corresponds to the defined aspect ratio. Depending on the configured strategy
// (ensureSmallerEdge), this function either uses the smaller or the larger edge as the
// ground truth.
// export function applyAspectRatioToWidth(aspectRatio: number, width: number): [number, number] {
//   // const useWidth = ensureSmallerEdge ? aspectRatio >= 1 : aspectRatio < 1;

//   // example I:
//   // 16 : 9 --> 1.78
//   // useWdth: false

//   const useWidth = false;
//   const scaledWidth = width * (useWidth ? 1 : aspectRatio);
//   const scaledHeight = width / (!useWidth ? 1 : aspectRatio);

//   return [scaledWidth, scaledHeight];
// }

// Returns the ratio between VIEWPORT_WIDTH and the actual extent of the viewport for width and height
export function getViewportScale(state: OxalisState, viewport: Viewport): [number, number] {
  const { width, height } = getInputCatcherRect(state, viewport);
  // For the orthogonal views the CSS border width was subtracted before, so we'll need to
  // add it back again to get an accurate scale
  const borderWidth = viewport === ArbitraryViewport ? 0 : OUTER_CSS_BORDER;
  const xScale = (width + 2 * borderWidth) / constants.VIEWPORT_WIDTH;
  const yScale = (height + 2 * borderWidth) / constants.VIEWPORT_WIDTH;
  return [xScale, yScale];
}

export default {};
