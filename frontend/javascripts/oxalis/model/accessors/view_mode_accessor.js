// @flow

import memoizeOne from "memoize-one";

import { type OxalisState } from "oxalis/store";
import constants, {
  ArbitraryViewport,
  OUTER_CSS_BORDER,
  type OrthoViewExtents,
  type Rect,
  type Viewport,
  OrthoViews,
  type OrthoView,
  type Point2,
  type Vector3,
  type ViewMode,
} from "oxalis/constants";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getPosition, getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import { reuseInstanceOnEquality } from "oxalis/model/accessors/accessor_helpers";

export function getTDViewportSize(state: OxalisState): [number, number] {
  const camera = state.viewModeData.plane.tdCamera;
  return [camera.right - camera.left, camera.top - camera.bottom];
}

export function getTDViewZoom(state: OxalisState) {
  const { width } = getInputCatcherRect(state, OrthoViews.TDView);
  const [viewplaneWidth] = getTDViewportSize(state);
  const { scale } = state.dataset.dataSource;
  // We only need to calculate scaleX as scaleY would have the same value.
  const scaleX = viewplaneWidth / (width * scale[0]);
  return scaleX;
}

export function getInputCatcherRect(state: OxalisState, viewport: Viewport): Rect {
  if (viewport === ArbitraryViewport) {
    return state.viewModeData.arbitrary.inputCatcherRect;
  } else {
    // $FlowIssue[prop-missing] Flow does not understand that viewport cannot be ArbitraryViewport at this point
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
  if (width === 0 || height === 0) {
    return 1;
  }
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
//   // useWidth: false

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

function _calculateGlobalPos(state: OxalisState, clickPos: Point2, planeId: ?OrthoView): Vector3 {
  let position;
  planeId = planeId || state.viewModeData.plane.activeViewport;
  const curGlobalPos = getPosition(state.flycam);
  const zoomFactors = getPlaneScalingFactor(state, state.flycam, planeId);
  const viewportScale = getViewportScale(state, planeId);
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);

  const center = [0, 1].map(dim => (constants.VIEWPORT_WIDTH * viewportScale[dim]) / 2);
  const diffX = ((center[0] - clickPos.x) / viewportScale[0]) * zoomFactors[0];
  const diffY = ((center[1] - clickPos.y) / viewportScale[1]) * zoomFactors[1];

  switch (planeId) {
    case OrthoViews.PLANE_XY:
      position = [
        curGlobalPos[0] - diffX * planeRatio[0],
        curGlobalPos[1] - diffY * planeRatio[1],
        curGlobalPos[2],
      ];
      break;
    case OrthoViews.PLANE_YZ:
      position = [
        curGlobalPos[0],
        curGlobalPos[1] - diffY * planeRatio[1],
        curGlobalPos[2] - diffX * planeRatio[2],
      ];
      break;
    case OrthoViews.PLANE_XZ:
      position = [
        curGlobalPos[0] - diffX * planeRatio[0],
        curGlobalPos[1],
        curGlobalPos[2] - diffY * planeRatio[2],
      ];
      break;
    default:
      console.error(
        `Trying to calculate the global position, but no viewport is active: ${planeId}`,
      );
      return [0, 0, 0];
  }

  return position;
}

export const calculateGlobalPos = reuseInstanceOnEquality(_calculateGlobalPos);

export function getViewMode(state: OxalisState): ViewMode {
  return state.temporaryConfiguration.viewMode;
}

export function isPlaneMode(state: OxalisState): boolean {
  const viewMode = getViewMode(state);
  return constants.MODES_PLANE.includes(viewMode);
}

export default {};
