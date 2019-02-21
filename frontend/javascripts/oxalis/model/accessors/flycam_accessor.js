// @flow
import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";

import type { Flycam, OxalisState } from "oxalis/store";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import { ZOOM_STEP_INTERVAL } from "oxalis/model/reducers/flycam_reducer";
import { clamp, map3 } from "libs/utils";
import { getInputCatcherRect, getViewportRects } from "oxalis/model/accessors/view_mode_accessor";
import { getMaxZoomStep, getResolutions } from "oxalis/model/accessors/dataset_accessor";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  type OrthoViewRects,
  OrthoViews,
  type Vector3,
  type ViewMode,
} from "oxalis/constants";
import determineBucketsForOrthogonal from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import * as scaleInfo from "oxalis/model/scaleinfo";

function calculateTotalBucketCountForZoomLevel(
  viewMode: ViewMode,
  datasetScale: Vector3,
  resolutions: Array<Vector3>,
  logZoomStep: number,
  zoomFactor: number,
  viewportRects: OrthoViewRects,
  abortLimit: number,
) {
  let counter = 0;
  const enqueueFunction = () => {
    counter++;
  };
  // Define dummy values
  const position = [0, 0, 0];
  const anchorPoint = [0, 0, 0, 0];
  const fallbackAnchorPoint = [0, 0, 0, 0];
  const subBucketLocality = [1, 1, 1];
  const sphericalCapRadius = constants.DEFAULT_SPHERICAL_CAP_RADIUS;

  const areas = getAreas(viewportRects, position, zoomFactor, datasetScale);
  const fallbackZoomStep = logZoomStep + 1;
  const isFallbackAvailable = fallbackZoomStep < resolutions.length;
  const dummyMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrix = M4x4.scale1(zoomFactor, dummyMatrix);

  if (viewMode === constants.MODE_ARBITRARY_PLANE) {
    determineBucketsForOblique(
      resolutions,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      fallbackZoomStep,
      isFallbackAvailable,
      abortLimit,
    );
  } else if (viewMode === constants.MODE_ARBITRARY) {
    determineBucketsForFlight(
      resolutions,
      position,
      sphericalCapRadius,
      enqueueFunction,
      matrix,
      logZoomStep,
      fallbackZoomStep,
      isFallbackAvailable,
      abortLimit,
    );
  } else {
    determineBucketsForOrthogonal(
      resolutions,
      enqueueFunction,
      logZoomStep,
      anchorPoint,
      fallbackAnchorPoint,
      areas,
      subBucketLocality,
      abortLimit,
    );
  }

  return counter;
}

// This function returns the maximum zoom value in which a given magnification (resolutionIndex)
// can be rendered without exceeding the necessary bucket capacity.
// Similar to other functions in this module, the function name is prefixed with _ which means
// that there is a memoized function as a counterpart (which is not prefixed with _).
// Example:
// The function might return 1.3 for resolutionIndex 0, which means that until a zoom value of 1.3
// the first magnification can still be rendered.
// For resolutionIndex 1, the function might return 1.5 etc.
// These values are used to determine the appropriate magnification for a given zoom value (e.g., a zoom value of 1.4
// would require the second magnification).
// This function is only exported for testing purposes
export function _getMaximumZoomForAllResolutions(
  viewMode: ViewMode,
  datasetScale: Vector3,
  resolutions: Array<Vector3>,
  viewportRects: OrthoViewRects,
): Array<number> {
  const maximumCapacity = constants.MINIMUM_REQUIRED_BUCKET_CAPACITY;
  // maximumIterationCount is used as an upper limit to avoid an endless loop, in case
  // the following while loop causes havoc for some reason (e.g., because
  // the calculated bucket size isn't strictly increasing anymore). It means,
  // that even with the best GPU specs and biggest dataset (i.e., many magnifications),
  // wk will at most zoom out until a zoom value of ZOOM_STEP_INTERVAL**maximumIterationCount.
  // With the current values, this would indicate a maximum zoom value of ~ 35 000, meaning
  // that ~ 15 different magnifications (~ log2 of 35000) are supported properly.
  const maximumIterationCount = 120;
  let currentIterationCount = 0;
  // Since the viewports can be quite large, it can happen that even a zoom value of 1 is not feasible.
  // That's why we start the search with a smaller value than 1. We use the ZOOM_STEP_INTERVAL factor
  // to ensure that the calculated thresholds correspond to the normal zoom behavior.
  let maxZoomValue = 1 / ZOOM_STEP_INTERVAL ** 20;
  let currentResolutionIndex = 0;
  const maxZoomValueThresholds = [];

  while (
    currentIterationCount < maximumIterationCount &&
    currentResolutionIndex < resolutions.length
  ) {
    const nextZoomValue = maxZoomValue * ZOOM_STEP_INTERVAL;
    const nextCapacity = calculateTotalBucketCountForZoomLevel(
      viewMode,
      datasetScale,
      resolutions,
      currentResolutionIndex,
      nextZoomValue,
      viewportRects,
      // The bucket picker will stop after reaching the maximum capacity.
      // Increment the limit by one, so that rendering is still possible
      // when exactly meeting the limit.
      maximumCapacity + 1,
    );
    if (nextCapacity > maximumCapacity) {
      maxZoomValueThresholds.push(maxZoomValue);
      currentResolutionIndex++;
    }

    maxZoomValue = nextZoomValue;
    currentIterationCount++;
  }

  return maxZoomValueThresholds;
}
const getMaximumZoomForAllResolutions = memoizeOne(_getMaximumZoomForAllResolutions);

export function getUp(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[4], matrix[5], matrix[6]];
}

export function getLeft(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[0], matrix[1], matrix[2]];
}

export function getPosition(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[12], matrix[13], matrix[14]];
}

export function getFlooredPosition(flycam: Flycam): Vector3 {
  return map3(x => Math.floor(x), getPosition(flycam));
}

export function getRotation(flycam: Flycam): Vector3 {
  const object = new THREE.Object3D();
  const matrix = new THREE.Matrix4().fromArray(flycam.currentMatrix).transpose();
  object.applyMatrix(matrix);

  // Fix JS modulo bug
  // http://javascript.about.com/od/problemsolving/a/modulobug.htm
  const mod = (x, n) => ((x % n) + n) % n;

  const rotation: Vector3 = [object.rotation.x, object.rotation.y, object.rotation.z - Math.PI];
  return [
    mod((180 / Math.PI) * rotation[0], 360),
    mod((180 / Math.PI) * rotation[1], 360),
    mod((180 / Math.PI) * rotation[2], 360),
  ];
}

export function getZoomedMatrix(flycam: Flycam): Matrix4x4 {
  return M4x4.scale1(flycam.zoomStep, flycam.currentMatrix);
}

export function getRequestLogZoomStep(state: OxalisState): number {
  const { viewMode } = state.temporaryConfiguration;
  const maximumZoomSteps = getMaximumZoomForAllResolutions(
    viewMode,
    state.dataset.dataSource.scale,
    getResolutions(state.dataset),
    getViewportRects(state),
  );
  const maxLogZoomStep = Math.log2(getMaxZoomStep(state.dataset));

  // Linearly search for the resolution index, for which the zoomFactor
  // is acceptable.
  const zoomStep = _.findIndex(
    maximumZoomSteps,
    maximumZoomStep => state.flycam.zoomStep <= maximumZoomStep,
  );
  if (zoomStep === -1) {
    return maxLogZoomStep;
  }

  const qualityAdaptedZoomStep = zoomStep + state.datasetConfiguration.quality;
  const min = Math.min(state.datasetConfiguration.quality, maxLogZoomStep);
  return clamp(min, qualityAdaptedZoomStep, maxLogZoomStep);
}

export function getMaxZoomValue(state: OxalisState): number {
  const { viewMode } = state.temporaryConfiguration;

  const maximumZoomSteps = getMaximumZoomForAllResolutions(
    viewMode,
    state.dataset.dataSource.scale,
    getResolutions(state.dataset),
    getViewportRects(state),
  );
  return _.last(maximumZoomSteps);
}

export function getZoomValue(flycam: Flycam): number {
  return flycam.zoomStep;
}

export function getPlaneScalingFactor(
  state: OxalisState,
  flycam: Flycam,
  planeID: OrthoView,
): [number, number] {
  const [width, height] = getPlaneExtentInVoxelFromStore(state, flycam.zoomStep, planeID);
  return [width / constants.VIEWPORT_WIDTH, height / constants.VIEWPORT_WIDTH];
}

export function getPlaneExtentInVoxelFromStore(
  state: OxalisState,
  zoomStep: number,
  planeID: OrthoView,
): [number, number] {
  const { width, height } = getInputCatcherRect(state, planeID);
  return [width * zoomStep, height * zoomStep];
}

export function getPlaneExtentInVoxel(
  rects: OrthoViewRects,
  zoomStep: number,
  planeID: OrthoView,
): [number, number] {
  const { width, height } = rects[planeID];
  return [width * zoomStep, height * zoomStep];
}

export function getRotationOrtho(planeId: OrthoView): Vector3 {
  switch (planeId) {
    case OrthoViews.PLANE_YZ:
      return [0, 270, 0];
    case OrthoViews.PLANE_XZ:
      return [90, 0, 0];
    default:
    case OrthoViews.PLANE_XY:
      return [0, 0, 0];
  }
}

export type Area = { left: number, top: number, right: number, bottom: number };

function getArea(
  rects: OrthoViewRects,
  position: Vector3,
  zoomStep: number,
  datasetScale: Vector3,
  planeId: OrthoView,
): Area {
  const [u, v] = Dimensions.getIndices(planeId);

  const [viewportWidthHalf, viewportHeightHalf] = getPlaneExtentInVoxel(
    rects,
    zoomStep,
    planeId,
  ).map(el => el / 2);
  const baseVoxelFactors = scaleInfo.getBaseVoxelFactors(datasetScale);

  const uHalf = viewportWidthHalf * baseVoxelFactors[u];
  const vHalf = viewportHeightHalf * baseVoxelFactors[v];

  const left = Math.floor((position[u] - uHalf) / constants.BUCKET_WIDTH);
  const top = Math.floor((position[v] - vHalf) / constants.BUCKET_WIDTH);
  const right = Math.floor((position[u] + uHalf) / constants.BUCKET_WIDTH);
  const bottom = Math.floor((position[v] + vHalf) / constants.BUCKET_WIDTH);

  return {
    left,
    top,
    right,
    bottom,
  };
}

function getAreas(
  rects: OrthoViewRects,
  position: Vector3,
  zoomStep: number,
  datasetScale: Vector3,
): OrthoViewMap<Area> {
  return {
    [OrthoViews.PLANE_XY]: getArea(rects, position, zoomStep, datasetScale, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(rects, position, zoomStep, datasetScale, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(rects, position, zoomStep, datasetScale, OrthoViews.PLANE_YZ),
  };
}

export function getAreasFromState(state: OxalisState): OrthoViewMap<Area> {
  const position = getPosition(state.flycam);
  const rects = getViewportRects(state);
  const { zoomStep } = state.flycam;
  const datasetScale = state.dataset.dataSource.scale;
  return getAreas(rects, position, zoomStep, datasetScale);
}
