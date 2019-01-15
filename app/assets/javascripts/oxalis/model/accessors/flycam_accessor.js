// @flow
import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";

import type { Flycam, OxalisState } from "oxalis/store";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import {
  calculateTotalBucketCountForZoomLevel,
  calculateBucketCountPerDim,
} from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import { clamp, map3 } from "libs/utils";
import { getMaxZoomStep, getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { getResolutionsFactors } from "oxalis/model/helpers/position_converter";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Vector3,
} from "oxalis/constants";
import * as scaleInfo from "oxalis/model/scaleinfo";

// All methods in this file should use constants.PLANE_WIDTH instead of constants.VIEWPORT_WIDTH
// as the area that is rendered is only of size PLANE_WIDTH.
// If VIEWPORT_WIDTH, which is a little bigger, is used instead, we end up with a data texture
// that is shrinked a little bit, which leads to the texture not being in sync with the THREEjs scene.

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
): number {
  const maximumCapacity = constants.MINIMUM_REQUIRED_BUCKET_CAPACITY;
  // This is more of a theoretical limit to avoid an endless loop, in case
  // the following while loop causes havoc for some reason. It means,
  // that even with the best GPU specs and weirdest dataset properties,
  // wk will at most render magnification 20 when being in zoom level 1.
  const maximumMagnificationAtZoomLevelOne = 20;
  let maxZoomStep = 1;

  while (
    calculateTotalBucketCountForZoomLevel(dataSetScale, resolutionIndex, resolutions, maxZoomStep) <
      maximumCapacity &&
    maxZoomStep < maximumMagnificationAtZoomLevelOne
  ) {
    maxZoomStep += 0.1;
  }

  return maxZoomStep;
}

function _getMaximumZoomForAllResolutions(
  dataSetScale: Vector3,
  resolutions: Array<Vector3>,
): Array<number> {
  return resolutions.map((_resolution, resolutionIndex) =>
    _approximateMaxZoomForZoomStep(dataSetScale, resolutionIndex, resolutions),
  );
}
const getMaximumZoomForAllResolutions = memoizeOne(_getMaximumZoomForAllResolutions);

function _getMaxBucketCountPerDim(
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
): Vector3 {
  const maximumZoomFactor = getMaximumZoomForAllResolutions(dataSetScale, resolutions)[
    resolutionIndex
  ];
  return calculateBucketCountPerDim(dataSetScale, resolutionIndex, resolutions, maximumZoomFactor);
}

function _getMaxBucketCountPerDimForAllResolutions(
  dataSetScale: Vector3,
  resolutions: Array<Vector3>,
): Array<Vector3> {
  return resolutions.map((_resolution, resolutionIndex) =>
    _getMaxBucketCountPerDim(dataSetScale, resolutionIndex, resolutions),
  );
}

export const getMaxBucketCountPerDimForAllResolutions = memoizeOne(
  _getMaxBucketCountPerDimForAllResolutions,
);

export function getMaxBucketCountPerDim(
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
): Vector3 {
  return getMaxBucketCountPerDimForAllResolutions(dataSetScale, resolutions)[resolutionIndex];
}

function _getMaxBucketCountsForFallback(
  dataSetScale: Vector3,
  resolutionIndex: number,
  resolutions: Array<Vector3>,
): Vector3 {
  // In the fallback scenario, we determine the maxBucketCounts of the better magnification
  // and adapt these to the fallback resolution (for isotropic magnifications, this would simply
  // divide all counts by 2).
  const nonFallbackResolution = resolutionIndex - 1;
  const nonFallbackCounts = getMaxBucketCountPerDim(
    dataSetScale,
    nonFallbackResolution,
    resolutions,
  );

  const resolution = resolutions[resolutionIndex];
  const previousResolution = resolutions[nonFallbackResolution];
  const resolutionChangeRatio = getResolutionsFactors(resolution, previousResolution);

  const bucketsPerDim = map3(
    (count, dim) => Math.ceil(count / resolutionChangeRatio[dim]),
    nonFallbackCounts,
  );
  return bucketsPerDim;
}

export const getMaxBucketCountsForFallback = memoizeOne(_getMaxBucketCountsForFallback);

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

export function getTextureScalingFactor(state: OxalisState): number {
  return state.flycam.zoomStep / Math.pow(2, getRequestLogZoomStep(state));
}

export function getPlaneScalingFactor(flycam: Flycam): number {
  return flycam.zoomStep;
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

export function getArea(state: OxalisState, planeId: OrthoView): Area {
  const [u, v] = Dimensions.getIndices(planeId);

  const position = getPosition(state.flycam);
  const viewportWidthHalf = (getPlaneScalingFactor(state.flycam) * constants.PLANE_WIDTH) / 2;
  const baseVoxelFactors = scaleInfo.getBaseVoxelFactors(state.dataset.dataSource.scale);

  const uWidthHalf = viewportWidthHalf * baseVoxelFactors[u];
  const vWidthHalf = viewportWidthHalf * baseVoxelFactors[v];

  const left = Math.floor((position[u] - uWidthHalf) / constants.BUCKET_WIDTH);
  const top = Math.floor((position[v] - vWidthHalf) / constants.BUCKET_WIDTH);
  const right = Math.floor((position[u] + uWidthHalf) / constants.BUCKET_WIDTH);
  const bottom = Math.floor((position[v] + vWidthHalf) / constants.BUCKET_WIDTH);

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
