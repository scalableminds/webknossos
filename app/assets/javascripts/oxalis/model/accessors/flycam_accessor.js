// @flow
import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";

import type { Flycam, OxalisState } from "oxalis/store";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import { ZOOM_STEP_INTERVAL } from "oxalis/model/reducers/flycam_reducer";
import { getInputCatcherRect, getViewportExtents } from "oxalis/model/accessors/view_mode_accessor";
import {
  calculateTotalBucketCountForZoomLevel,
  // calculateBucketCountPerDim,
} from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import { clamp, map3 } from "libs/utils";
import { getMaxZoomStep, getResolutions } from "oxalis/model/accessors/dataset_accessor";
// import { getResolutionsFactors } from "oxalis/model/helpers/position_converter";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoView,
  type OrthoViewExtents,
  type OrthoViewMap,
  OrthoViews,
  type Vector3,
} from "oxalis/constants";
import * as scaleInfo from "oxalis/model/scaleinfo";

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
function _approximateMaxZoomForZoomStep(
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
  viewportExtents: OrthoViewExtents,
): number {
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
  let maxZoomStep = 1 / ZOOM_STEP_INTERVAL ** 20;

  while (currentIterationCount < maximumIterationCount) {
    const nextZoomStep = maxZoomStep * ZOOM_STEP_INTERVAL;
    const nextCapacity = calculateTotalBucketCountForZoomLevel(
      dataSetScale,
      resolutionIndex,
      resolutions,
      nextZoomStep,
      viewportExtents,
    );
    if (nextCapacity > maximumCapacity) {
      break;
    }

    maxZoomStep = nextZoomStep;
    currentIterationCount++;
  }

  return maxZoomStep;
}

// This function is only exported for testing purposes
export function _getMaximumZoomForAllResolutions(
  dataSetScale: Vector3,
  resolutions: Array<Vector3>,
  viewportExtents: OrthoViewExtents,
): Array<number> {
  return resolutions.map((_resolution, resolutionIndex) =>
    _approximateMaxZoomForZoomStep(dataSetScale, resolutionIndex, resolutions, viewportExtents),
  );
}
const getMaximumZoomForAllResolutions = memoizeOne(_getMaximumZoomForAllResolutions);

// function _getMaxBucketCountPerDim(
//   dataSetScale: Vector3,
//   resolutionIndex: number,
//   resolutions: Array<Vector3>,
// ): Vector3 {
//   const maximumZoomFactor = getMaximumZoomForAllResolutions(dataSetScale, resolutions)[
//     resolutionIndex
//   ];
//   return calculateBucketCountPerDim(dataSetScale, resolutionIndex, resolutions, maximumZoomFactor);
// }

// function _getMaxBucketCountPerDimForAllResolutions(
//   dataSetScale: Vector3,
//   resolutions: Array<Vector3>,
// ): Array<Vector3> {
//   return resolutions.map((_resolution, resolutionIndex) =>
//     _getMaxBucketCountPerDim(dataSetScale, resolutionIndex, resolutions),
//   );
// }

// const getMaxBucketCountPerDimForAllResolutions = memoizeOne(
//   _getMaxBucketCountPerDimForAllResolutions,
// );

// export function getMaxBucketCountPerDim(
//   dataSetScale: Vector3,
//   resolutionIndex: number,
//   resolutions: Array<Vector3>,
// ): Vector3 {
//   return getMaxBucketCountPerDimForAllResolutions(dataSetScale, resolutions)[resolutionIndex];
// }

// function _getMaxBucketCountsForFallback(
//   dataSetScale: Vector3,
//   resolutionIndex: number,
//   resolutions: Array<Vector3>,
// ): Vector3 {
//   // In the fallback scenario, we determine the maxBucketCounts of the better magnification
//   // and adapt these to the fallback resolution (for isotropic magnifications, this would simply
//   // divide all counts by 2).
//   const nonFallbackResolution = resolutionIndex - 1;
//   const nonFallbackCounts = getMaxBucketCountPerDim(
//     dataSetScale,
//     nonFallbackResolution,
//     resolutions,
//   );

//   const resolution = resolutions[resolutionIndex];
//   const previousResolution = resolutions[nonFallbackResolution];
//   const resolutionChangeRatio = getResolutionsFactors(resolution, previousResolution);

//   const bucketsPerDim = map3(
//     (count, dim) => Math.ceil(count / resolutionChangeRatio[dim]),
//     nonFallbackCounts,
//   );
//   return bucketsPerDim;
// }

// export const getMaxBucketCountsForFallback = memoizeOne(_getMaxBucketCountsForFallback);

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
  const maximumZoomSteps = getMaximumZoomForAllResolutions(
    state.dataset.dataSource.scale,
    getResolutions(state.dataset),
    getViewportExtents(state),
  );
  const maxLogZoomStep = Math.log2(getMaxZoomStep(state.dataset));

  // Linearly search for the resolution index, for which the zoomFactor
  // is acceptable.
  const zoomStep = constants.MODES_ARBITRARY.includes(state.temporaryConfiguration.viewMode)
    ? Math.max(0, Math.floor(Math.log2(state.flycam.zoomStep / 1.3)))
    : _.findIndex(maximumZoomSteps, maximumZoomStep => state.flycam.zoomStep <= maximumZoomStep);
  if (zoomStep === -1) {
    return maxLogZoomStep;
  }

  const qualityAdaptedZoomStep = zoomStep + state.datasetConfiguration.quality;
  const min = Math.min(state.datasetConfiguration.quality, maxLogZoomStep);
  return clamp(min, qualityAdaptedZoomStep, maxLogZoomStep);
}

export function getMaxZoomValue(state: OxalisState): number {
  const maximumZoomSteps = getMaximumZoomForAllResolutions(
    state.dataset.dataSource.scale,
    getResolutions(state.dataset),
    getViewportExtents(state),
  );
  return _.last(maximumZoomSteps);
}

export function getZoomValue(flycam: Flycam): number {
  return flycam.zoomStep;
}

export function getPlaneScalingFactor(flycam: Flycam, planeID: OrthoView): [number, number] {
  const [width, height] = getPlaneExtentInVoxel(flycam, planeID);
  return [width / constants.VIEWPORT_WIDTH, height / constants.VIEWPORT_WIDTH];
}

export function getPlaneExtentInVoxel(flycam: Flycam, planeID: OrthoView): [number, number] {
  const { width, height } = getInputCatcherRect(planeID);
  return [width * flycam.zoomStep, height * flycam.zoomStep];
}

// export function getPlaneExtentInWorldCoordinates(
//   flycam: Flycam,
//   planeID: OrthoView,
//   datasetScale: Vector3,
// ): [number, number] {
//   const [u, v] = Dimensions.getIndices(planeID);
//   const baseVoxelFactors = scaleInfo.getBaseVoxelFactors(datasetScale);
//   const [width, height] = getPlaneExtentInVoxel(flycam, planeID);
//   return [width * baseVoxelFactors[u], height * baseVoxelFactors[v]];
// }

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

export function getArea(state: OxalisState, planeId: OrthoView): Area {
  const [u, v] = Dimensions.getIndices(planeId);

  const position = getPosition(state.flycam);

  const planeScalingFactors = getPlaneScalingFactor(state.flycam, planeId);
  const viewportWidthHalf = (planeScalingFactors[0] * constants.VIEWPORT_WIDTH) / 2;
  const viewportHeightHalf = (planeScalingFactors[1] * constants.VIEWPORT_WIDTH) / 2;
  const baseVoxelFactors = scaleInfo.getBaseVoxelFactors(state.dataset.dataSource.scale);

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

export function getAreas(state: OxalisState): OrthoViewMap<Area> {
  return {
    [OrthoViews.PLANE_XY]: getArea(state, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(state, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(state, OrthoViews.PLANE_YZ),
  };
}
