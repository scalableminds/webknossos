import { V3 } from "libs/mjs";
import _ from "lodash";
import memoizeOne from "memoize-one";
import * as THREE from "three";
import type {
  OrthoView,
  OrthoViewExtents,
  Point2,
  Rect,
  Vector2,
  Vector3,
  ViewMode,
  Viewport,
} from "viewer/constants";
import constants, {
  ArbitraryViewport,
  OrthoViews,
  OrthoViewValuesWithoutTDView,
} from "viewer/constants";
import { reuseInstanceOnEquality } from "viewer/model/accessors/accessor_helpers";
import { getPosition, getRotationInRadian } from "viewer/model/accessors/flycam_accessor";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import type { Flycam, WebknossosState } from "viewer/store";
import Dimensions from "../dimensions";

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

export type PositionWithRounding = { rounded: Vector3; floating: Vector3 };

// Avoiding object creation with each call.
const flycamRotationEuler = new THREE.Euler();
const flycamRotationMatrix = new THREE.Matrix4();
const flycamPositionMatrix = new THREE.Matrix4();
const rotatedDiff = new THREE.Vector3();
const planeRatioVector = new THREE.Vector3();

function _calculateMaybeGlobalPos(
  state: WebknossosState,
  clickPos: Point2,
  planeIdOpt?: OrthoView | null | undefined,
): PositionWithRounding | null | undefined {
  let roundedPosition: Vector3, floatingPosition: Vector3;
  const planeId = planeIdOpt || state.viewModeData.plane.activeViewport;
  const curGlobalPos = getPosition(state.flycam);
  const flycamRotation = getRotationInRadian(state.flycam);
  const planeRatio = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);
  const { width, height } = getInputCatcherRect(state, planeId);
  // Subtract clickPos from only half of the viewport extent as
  // the center of the viewport / the flycam position is used as a reference point.
  const diffU = (width / 2 - clickPos.x) * state.flycam.zoomStep;
  const diffV = (height / 2 - clickPos.y) * state.flycam.zoomStep;
  const diffUvw = [diffU, diffV, 0] as Vector3;
  const diffXyz = Dimensions.transDim(diffUvw, planeId);
  flycamRotationMatrix.makeRotationFromEuler(flycamRotationEuler.set(...flycamRotation, "ZYX"));
  flycamPositionMatrix.makeTranslation(...curGlobalPos);
  rotatedDiff.set(...diffXyz).applyMatrix4(flycamRotationMatrix);
  const scaledRotatedPosition = rotatedDiff
    .multiply(planeRatioVector.set(...planeRatio))
    .multiplyScalar(-1);

  const globalFloatingPosition = scaledRotatedPosition.applyMatrix4(flycamPositionMatrix);
  floatingPosition = globalFloatingPosition.toArray() as Vector3;

  switch (planeId) {
    case OrthoViews.PLANE_XY: {
      roundedPosition = [
        Math.round(globalFloatingPosition.x),
        Math.round(globalFloatingPosition.y),
        Math.floor(globalFloatingPosition.z),
      ];
      break;
    }

    case OrthoViews.PLANE_YZ: {
      roundedPosition = [
        Math.floor(globalFloatingPosition.x),
        Math.round(globalFloatingPosition.y),
        Math.round(globalFloatingPosition.z),
      ];
      break;
    }

    case OrthoViews.PLANE_XZ: {
      roundedPosition = [
        Math.round(globalFloatingPosition.x),
        Math.floor(globalFloatingPosition.y),
        Math.round(globalFloatingPosition.z),
      ];
      break;
    }

    default:
      return null;
  }

  return { rounded: roundedPosition, floating: floatingPosition };
}

// This function inverts parts of the _calculateMaybeGlobalPos function.
// It takes a global position and calculates a screen space vector relative to the flycam position for it.
// The result it like the input of position of _calculateMaybeGlobalPos but as a 3D vector from which the
// viewport dependant coordinates need to be extracted (xy -> xy, yz -> zy, xz -> xz).
function _calculateInViewportPos(
  globalPosition: Vector3,
  flycamPosition: Vector3,
  flycamRotationInRadian: Vector3,
  planeRatio: Vector3,
  zoomStep: number,
): THREE.Vector3 {
  // Difference in world space
  const positionDiff = new THREE.Vector3(...V3.sub(globalPosition, flycamPosition));

  // Inverse rotate the world difference vector into local plane-aligned space
  const inverseRotationMatrix = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(...flycamRotationInRadian, "ZYX"))
    .invert();

  // Unscale from voxel ratio (undo voxel scaling)
  const posInScreenSpaceScaling = positionDiff.divide(new THREE.Vector3(...planeRatio));
  const rotatedIntoScreenSpace = posInScreenSpaceScaling.applyMatrix4(inverseRotationMatrix);
  const unzoomedPosition = rotatedIntoScreenSpace.multiplyScalar(1 / zoomStep);
  return unzoomedPosition;
}

function _calculateMaybePlaneScreenPos(
  state: WebknossosState,
  globalPosition: Vector3,
  planeId: OrthoView,
): Vector2 | null | undefined {
  // This method now accounts for flycam rotation, matching the forward transformation
  let point: Vector2;

  const { width, height, top, left } = getInputCatcherRect(state, planeId);

  const flycamPosition = getPosition(state.flycam);
  const flycamRotation = getRotationInRadian(state.flycam);
  const planeRatio = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);
  const navbarHeight = state.uiInformation.navbarHeight;

  const positionInViewportPerspective = calculateInViewportPos(
    globalPosition,
    flycamPosition,
    flycamRotation,
    planeRatio,
    state.flycam.zoomStep,
  );

  // Get plane-aligned screen-space coordinates (u/v)
  switch (planeId) {
    case OrthoViews.PLANE_XY: {
      point = [positionInViewportPerspective.x, positionInViewportPerspective.y];
      break;
    }

    case OrthoViews.PLANE_YZ: {
      point = [positionInViewportPerspective.z, positionInViewportPerspective.y];
      break;
    }

    case OrthoViews.PLANE_XZ: {
      point = [positionInViewportPerspective.x, positionInViewportPerspective.z];
      break;
    }

    default:
      return null;
  }

  point = [
    Math.round(point[0] + width / 2 + left),
    Math.round(point[1] + height / 2 + top + navbarHeight),
  ];
  return point;
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
): PositionWithRounding {
  const positions = _calculateMaybeGlobalPos(state, clickPos, planeId);

  if (!positions || !positions.rounded) {
    console.error("Trying to calculate the global position, but no data viewport is active.");
    return { rounded: [0, 0, 0], floating: [0, 0, 0] };
  }

  return positions;
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
export const calculateMaybePlaneScreenPos = reuseInstanceOnEquality(_calculateMaybePlaneScreenPos);
export const calculateInViewportPos = reuseInstanceOnEquality(_calculateInViewportPos);
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
