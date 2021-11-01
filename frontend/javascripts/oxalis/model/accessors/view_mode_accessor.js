// @flow

import memoizeOne from "memoize-one";
import _ from "lodash";
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
  OrthoViewValuesWithoutTDView,
  type ViewMode,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import {
  getPosition,
  getPlaneExtentInVoxelFromStore,
} from "oxalis/model/accessors/flycam_accessor";
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
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);
  const { width, height } = getInputCatcherRect(state, planeId);
  // Subtract clickPos from only half of the viewport extent as
  // the center of the viewport / the flycam position is used as a reference point.
  const diffX = (width / 2 - clickPos.x) * state.flycam.zoomStep;
  const diffY = (height / 2 - clickPos.y) * state.flycam.zoomStep;
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

export function getDisplayedDataExtentInPlaneMode(state: OxalisState) {
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);
  const curGlobalCenterPos = getPosition(state.flycam);
  const extents = OrthoViewValuesWithoutTDView.map(orthoView =>
    getPlaneExtentInVoxelFromStore(state, state.flycam.zoomStep, orthoView),
  );
  const [xyExtent, yzExtent, xzExtent] = extents;
  const minExtent = 1;
  const getMinExtent = (val1, val2) => _.min([val1, val2].filter(v => v >= minExtent)) || minExtent;
  const xMinExtent = getMinExtent(xyExtent[0], xzExtent[0]) * planeRatio[0];
  const yMinExtent = getMinExtent(xyExtent[1], yzExtent[1]) * planeRatio[1];
  const zMinExtent = getMinExtent(xzExtent[1], yzExtent[0]) * planeRatio[2];
  // The new bounding box should cover half of what is displayed in the viewports.
  // As the flycam position is taken as a center, the factor is halved again, resulting in a 0.25.
  const extentFactor = 0.25;
  const halfBoxExtent = [
    Math.max(xMinExtent * extentFactor, 1),
    Math.max(yMinExtent * extentFactor, 1),
    Math.max(zMinExtent * extentFactor, 1),
  ];
  return {
    min: V3.toArray(V3.round(V3.sub(curGlobalCenterPos, halfBoxExtent))),
    max: V3.toArray(V3.round(V3.add(curGlobalCenterPos, halfBoxExtent))),
    halfBoxExtent,
  };
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
