import { V3 } from "libs/mjs";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type {
  OrthoView,
  OrthoViewExtents,
  Point2,
  Rect,
  Vector2,
  Vector3,
  ViewMode,
  Viewport,
} from "oxalis/constants";
import constants, {
  ArbitraryViewport,
  OrthoViews,
  OrthoViewValuesWithoutTDView,
} from "oxalis/constants";
import { reuseInstanceOnEquality } from "oxalis/model/accessors/accessor_helpers";
import { getPosition, getRotationInRadian } from "oxalis/model/accessors/flycam_accessor";
import { getBaseVoxelFactorsInUnit } from "oxalis/model/scaleinfo";
import type { Flycam, WebknossosState } from "oxalis/store";
import Dimensions from "../dimensions";
import * as THREE from "three";

export function getTDViewportSize(state: WebknossosState): [number, number] {
  const camera = state.viewModeData.plane.tdCamera;
  return [camera.right - camera.left, camera.top - camera.bottom];
}
export function getTDViewZoom(state: WebknossosState) {
  const { width } = getInputCatcherRect(state, OrthoViews.TDView);
  const [viewplaneWidth] = getTDViewportSize(state);
  const { factor } = state.dataset.dataSource.scale;
  // We only need to calculate scaleX as scaleY would have the same value.
  const scaleX = viewplaneWidth / (width * factor[0]);
  return scaleX;
}
export function getInputCatcherRect(state: WebknossosState, viewport: Viewport): Rect {
  if (viewport === ArbitraryViewport) {
    return state.viewModeData.arbitrary.inputCatcherRect;
  } else {
    return state.viewModeData.plane.inputCatcherRects[viewport];
  }
}

const _getViewportExtents = memoizeOne((rects) => {
  const getExtent = (rect: Rect): Vector2 => [rect.width, rect.height];

  return {
    PLANE_XY: getExtent(rects.PLANE_XY),
    PLANE_YZ: getExtent(rects.PLANE_YZ),
    PLANE_XZ: getExtent(rects.PLANE_XZ),
    TDView: getExtent(rects.TDView),
  };
});

export function getViewportRects(state: WebknossosState) {
  return state.viewModeData.plane.inputCatcherRects;
}
export function getViewportExtents(state: WebknossosState): OrthoViewExtents {
  const rects = state.viewModeData.plane.inputCatcherRects;
  return _getViewportExtents(rects);
}
export function getInputCatcherAspectRatio(state: WebknossosState, viewport: Viewport): number {
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
export function getViewportScale(state: WebknossosState, viewport: Viewport): [number, number] {
  const { width, height } = getInputCatcherRect(state, viewport);
  const xScale = width / constants.VIEWPORT_WIDTH;
  const yScale = height / constants.VIEWPORT_WIDTH;
  return [xScale, yScale];
}

function _calculateMaybeGlobalPos(
  state: WebknossosState,
  clickPos: Point2,
  planeId?: OrthoView | null | undefined,
): Vector3 | null | undefined {
  let position: Vector3;
  planeId = planeId || state.viewModeData.plane.activeViewport;
  const curGlobalPos = getPosition(state.flycam);
  const flycamRotation = getRotationInRadian(state.flycam);
  const planeRatio = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);
  const { width, height } = getInputCatcherRect(state, planeId);
  // Subtract clickPos from only half of the viewport extent as
  // the center of the viewport / the flycam position is used as a reference point.
  const diffX = clickPos.x === 0 ? 0 : (width / 2 - clickPos.x) * state.flycam.zoomStep;
  const diffY = clickPos.y === 0 ? 0 : (height / 2 - clickPos.y) * state.flycam.zoomStep;
  const positionInPlane = [diffX, diffY, 0] as Vector3;
  const positionPlaneDefaultRotation = Dimensions.transDim(positionInPlane, planeId);
  const flycamRotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(...flycamRotation),
  );
  const flycamPositionMatrix = new THREE.Matrix4().makeTranslation(
    new THREE.Vector3(...curGlobalPos),
  );
  const rotatedPosition = new THREE.Vector3(...positionPlaneDefaultRotation).applyMatrix4(
    flycamRotationMatrix,
  );
  const scaledRotatedPosition = rotatedPosition
    .multiply(new THREE.Vector3(...planeRatio))
    .multiplyScalar(-1);

  const globalFloatingPosition = scaledRotatedPosition.applyMatrix4(flycamPositionMatrix);

  switch (planeId) {
    case OrthoViews.PLANE_XY: {
      position = [
        Math.round(globalFloatingPosition.x),
        Math.round(globalFloatingPosition.y),
        Math.floor(globalFloatingPosition.z),
      ];
      break;
    }

    case OrthoViews.PLANE_YZ: {
      position = [
        Math.floor(globalFloatingPosition.x),
        Math.round(globalFloatingPosition.y),
        Math.round(globalFloatingPosition.z),
      ];
      break;
    }

    case OrthoViews.PLANE_XZ: {
      position = [
        Math.round(globalFloatingPosition.x),
        Math.floor(globalFloatingPosition.y),
        Math.round(globalFloatingPosition.z),
      ];
      break;
    }

    default:
      return null;
  }

  return position;
}

function _calculateMaybeGlobalDelta(
  state: WebknossosState,
  delta: Point2,
  planeId?: OrthoView | null | undefined,
): Vector3 | null | undefined {
  let position: Vector3;
  planeId = planeId || state.viewModeData.plane.activeViewport;
  const planeRatio = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);
  const diffX = delta.x * state.flycam.zoomStep;
  const diffY = delta.y * state.flycam.zoomStep;

  switch (planeId) {
    case OrthoViews.PLANE_XY: {
      position = [Math.round(diffX * planeRatio[0]), Math.round(diffY * planeRatio[1]), 0];
      break;
    }

    case OrthoViews.PLANE_YZ: {
      position = [0, Math.round(diffY * planeRatio[1]), Math.round(diffX * planeRatio[2])];
      break;
    }

    case OrthoViews.PLANE_XZ: {
      position = [Math.round(diffX * planeRatio[0]), 0, Math.round(diffY * planeRatio[2])];
      break;
    }

    default:
      return null;
  }

  return position;
}

function _calculateGlobalPos(
  state: WebknossosState,
  clickPos: Point2,
  planeId?: OrthoView | null | undefined,
): Vector3 {
  const position = _calculateMaybeGlobalPos(state, clickPos, planeId);

  if (!position) {
    console.error("Trying to calculate the global position, but no data viewport is active.");
    return [0, 0, 0];
  }

  return position;
}

function _calculateGlobalDelta(
  state: WebknossosState,
  delta: Point2,
  planeId?: OrthoView | null | undefined,
): Vector3 {
  const position = _calculateMaybeGlobalDelta(state, delta, planeId);

  if (!position) {
    console.error("Trying to calculate the global position, but no data viewport is active.");
    return [0, 0, 0];
  }

  return position;
}

export function getDisplayedDataExtentInPlaneMode(state: WebknossosState) {
  const planeRatio = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);
  const curGlobalCenterPos = getPosition(state.flycam);
  const extents = OrthoViewValuesWithoutTDView.map((orthoView) =>
    getPlaneExtentInVoxelFromStore(state, state.flycam.zoomStep, orthoView),
  );
  const [xyExtent, yzExtent, xzExtent] = extents;
  const minExtent = 1;

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'val1' implicitly has an 'any' type.
  const getMinExtent = (val1, val2) =>
    _.min([val1, val2].filter((v) => v >= minExtent)) || minExtent;

  const xMinExtent = getMinExtent(xyExtent[0], xzExtent[0]) * planeRatio[0];
  const yMinExtent = getMinExtent(xyExtent[1], yzExtent[1]) * planeRatio[1];
  const zMinExtent = getMinExtent(xzExtent[1], yzExtent[0]) * planeRatio[2];
  // The new bounding box should cover half of what is displayed in the viewports.
  // As the flycam position is taken as a center, the factor is halved again, resulting in a 0.25.
  const extentFactor = 0.25;
  const halfBoxExtent: Vector3 = [
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
export const calculateMaybeGlobalPos = reuseInstanceOnEquality(_calculateMaybeGlobalPos);
export const calculateGlobalPos = reuseInstanceOnEquality(_calculateGlobalPos);
export const calculateGlobalDelta = reuseInstanceOnEquality(_calculateGlobalDelta);
export function getViewMode(state: WebknossosState): ViewMode {
  return state.temporaryConfiguration.viewMode;
}
export function isPlaneMode(state: WebknossosState): boolean {
  const viewMode = getViewMode(state);
  return constants.MODES_PLANE.includes(viewMode);
}

export function getPlaneScalingFactor(
  state: WebknossosState,
  flycam: Flycam,
  planeID: OrthoView,
): [number, number] {
  const [width, height] = getPlaneExtentInVoxelFromStore(state, flycam.zoomStep, planeID);
  return [width / constants.VIEWPORT_WIDTH, height / constants.VIEWPORT_WIDTH];
}
export function getPlaneExtentInVoxelFromStore(
  state: WebknossosState,
  zoomStep: number,
  planeID: OrthoView,
): [number, number] {
  const { width, height } = getInputCatcherRect(state, planeID);
  return [width * zoomStep, height * zoomStep];
}

export default {};
