// @flow
import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";

import type { Flycam, LoadingStrategy, OxalisState } from "oxalis/store";
import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import { ZOOM_STEP_INTERVAL } from "oxalis/model/reducers/flycam_reducer";
import { getAddressSpaceDimensions } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getInputCatcherRect, getViewportRects } from "oxalis/model/accessors/view_mode_accessor";
import {
  getMaxZoomStep,
  getResolutionByMax,
  getResolutions,
} from "oxalis/model/accessors/dataset_accessor";
import { map3, mod } from "libs/utils";
import { userSettings } from "libs/user_settings.schema";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  type OrthoViewRects,
  OrthoViews,
  type Vector2,
  type Vector3,
  type ViewMode,
} from "oxalis/constants";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForOrthogonal from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import * as scaleInfo from "oxalis/model/scaleinfo";

function calculateTotalBucketCountForZoomLevel(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  datasetScale: Vector3,
  resolutions: Array<Vector3>,
  logZoomStep: number,
  zoomFactor: number,
  viewportRects: OrthoViewRects,
  abortLimit: number,
  initializedGpuFactor: number,
) {
  let counter = 0;
  let minPerDim = [Infinity, Infinity, Infinity];
  let maxPerDim = [0, 0, 0];
  const enqueueFunction = bucketAddress => {
    minPerDim = minPerDim.map((el, index) => Math.min(el, bucketAddress[index]));
    maxPerDim = maxPerDim.map((el, index) => Math.max(el, bucketAddress[index]));
    counter++;
  };
  // Define dummy values
  const position = [0, 0, 0];
  const anchorPoint = [0, 0, 0, 0];
  const subBucketLocality = [1, 1, 1];
  const sphericalCapRadius = constants.DEFAULT_SPHERICAL_CAP_RADIUS;

  const areas = getAreas(viewportRects, position, zoomFactor, datasetScale);
  const dummyMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrix = M4x4.scale1(zoomFactor, dummyMatrix);

  if (viewMode === constants.MODE_ARBITRARY_PLANE) {
    determineBucketsForOblique(
      resolutions,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
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
      abortLimit,
    );
  } else {
    determineBucketsForOrthogonal(
      resolutions,
      enqueueFunction,
      loadingStrategy,
      logZoomStep,
      anchorPoint,
      areas,
      subBucketLocality,
      abortLimit,
      initializedGpuFactor,
    );
  }

  const addressSpaceDimensions = getAddressSpaceDimensions(initializedGpuFactor);
  const volumeDimension = V3.sub(maxPerDim, minPerDim);
  if (
    volumeDimension[0] > addressSpaceDimensions[0] ||
    volumeDimension[1] > addressSpaceDimensions[1] ||
    volumeDimension[2] > addressSpaceDimensions[2]
  ) {
    return Infinity;
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
  loadingStrategy: LoadingStrategy,
  datasetScale: Vector3,
  resolutions: Array<Vector3>,
  viewportRects: OrthoViewRects,
  maximumCapacity: number,
  initializedGpuFactor: number,
): Array<number> {
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
      loadingStrategy,
      datasetScale,
      resolutions,
      currentResolutionIndex,
      nextZoomValue,
      viewportRects,
      // The bucket picker will stop after reaching the maximum capacity.
      // Increment the limit by one, so that rendering is still possible
      // when exactly meeting the limit.
      maximumCapacity + 1,
      initializedGpuFactor,
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

function getMaximumZoomForAllResolutionsFromStore(state: OxalisState): Array<number> {
  const { viewMode } = state.temporaryConfiguration;
  return getMaximumZoomForAllResolutions(
    viewMode,
    state.datasetConfiguration.loadingStrategy,
    state.dataset.dataSource.scale,
    getResolutions(state.dataset),
    getViewportRects(state),
    state.temporaryConfiguration.gpuSetup.smallestCommonBucketCapacity,
    state.temporaryConfiguration.gpuSetup.initializedGpuFactor,
  );
}

function _getUp(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[4], matrix[5], matrix[6]];
}

function _getLeft(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[0], matrix[1], matrix[2]];
}

function _getPosition(flycam: Flycam): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[12], matrix[13], matrix[14]];
}

function _getFlooredPosition(flycam: Flycam): Vector3 {
  return map3(x => Math.floor(x), _getPosition(flycam));
}

function _getRotation(flycam: Flycam): Vector3 {
  const object = new THREE.Object3D();
  const matrix = new THREE.Matrix4().fromArray(flycam.currentMatrix).transpose();
  object.applyMatrix(matrix);

  const rotation: Vector3 = [object.rotation.x, object.rotation.y, object.rotation.z - Math.PI];
  return [
    mod((180 / Math.PI) * rotation[0], 360),
    mod((180 / Math.PI) * rotation[1], 360),
    mod((180 / Math.PI) * rotation[2], 360),
  ];
}

function _getZoomedMatrix(flycam: Flycam): Matrix4x4 {
  return M4x4.scale1(flycam.zoomStep, flycam.currentMatrix);
}

export const getUp = memoizeOne(_getUp);
export const getLeft = memoizeOne(_getLeft);
export const getPosition = memoizeOne(_getPosition);
export const getFlooredPosition = memoizeOne(_getFlooredPosition);
export const getRotation = memoizeOne(_getRotation);
export const getZoomedMatrix = memoizeOne(_getZoomedMatrix);

export function getRequestLogZoomStep(state: OxalisState): number {
  const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state);
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

  return Math.min(zoomStep, maxLogZoomStep);
}

export function getCurrentResolution(state: OxalisState): Vector3 {
  const resolutions = getResolutions(state.dataset);
  const logZoomStep = getRequestLogZoomStep(state);
  return resolutions[logZoomStep];
}

export function getValidZoomRangeForUser(state: OxalisState): [number, number] {
  const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state);
  const lastZoomStep = _.last(maximumZoomSteps);

  const [min, taskAwareMax] = getValidTaskZoomRange(state);
  const max = lastZoomStep != null ? Math.min(taskAwareMax, lastZoomStep) : 1;

  return [min, max];
}

export function getMaxZoomValueForResolution(
  state: OxalisState,
  targetResolution: Vector3,
): number {
  // Extract the max value from the range
  return getValidZoomRangeForResolution(state, targetResolution)[1];
}

function getValidZoomRangeForResolution(state: OxalisState, targetResolution: Vector3): Vector2 {
  const maximumZoomSteps = getMaximumZoomForAllResolutionsFromStore(state);
  const resolutions = getResolutions(state.dataset);

  const targetResolutionIndex = _.findIndex(resolutions, resolution =>
    _.isEqual(resolution, targetResolution),
  );

  const max = maximumZoomSteps[targetResolutionIndex];
  const min = targetResolutionIndex > 0 ? maximumZoomSteps[targetResolutionIndex - 1] : 0;
  // Since the min of the requested range is derived from the max of the previous range,
  // we add a small delta so that the returned range is inclusive.
  return [min + Number.EPSILON, max];
}

export function getZoomValue(flycam: Flycam): number {
  return flycam.zoomStep;
}

function getValidTaskZoomRange(state: OxalisState): [number, number] {
  const defaultRange = [userSettings.zoom.minimum, Infinity];
  const { allowedMagnifications } = state.tracing.restrictions;

  if (!allowedMagnifications || !allowedMagnifications.shouldRestrict) {
    return defaultRange;
  }

  function getMinMax(value, isMin) {
    const idx = isMin ? 0 : 1;

    return (
      (value == null
        ? defaultRange[idx]
        : getValidZoomRangeForResolution(state, getResolutionByMax(state.dataset, value))[idx]) ||
      // If the value is defined, but doesn't match any resolution, we default to the defaultRange values
      defaultRange[idx]
    );
  }

  const min = getMinMax(allowedMagnifications.min, true);
  const max = getMinMax(allowedMagnifications.max, false);

  return [min, max];
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
