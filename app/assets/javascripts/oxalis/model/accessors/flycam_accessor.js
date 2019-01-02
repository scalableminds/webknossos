// @flow
import * as THREE from "three";
import memoizeOne from "memoize-one";

import type { Flycam, OxalisState } from "oxalis/store";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import { calculateUnzoomedBucketCount } from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";
import { extraBucketsPerDim } from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker_constants";
import { getMaxZoomStep } from "oxalis/model/accessors/dataset_accessor";
import Dimensions from "oxalis/model/dimensions";
import { clamp, map3 } from "libs/utils";
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

// This function returns a value which indicates how much larger the rendered
// plane can be than its original size **without** having to use the next
// magnification. E.g., a value of two indicates that the viewport
// can be 2 * viewport_width pixel wide while still being in zoom step 0.
function unmemoizedCalculateMaxZoomStepDiff(dataSetScale: Vector3): number {
  // This is more of a theoretical limit to avoid an endless loop, in case
  // the following while loop causes havoc for some reason. It means,
  // that even with the best GPU specs and weirdest dataset properties,
  // wk will at most render magnification 20 when being in zoom level 1.
  const maximumMagnificationAtZoomLevelOne = 20;
  const maximumCapacity = constants.MINIMUM_REQUIRED_BUCKET_CAPACITY;
  let maxZoomStep = 1;

  while (
    calculateUnzoomedBucketCount(dataSetScale, maxZoomStep) < maximumCapacity &&
    maxZoomStep < maximumMagnificationAtZoomLevelOne
  ) {
    maxZoomStep += 0.1;
  }

  return maxZoomStep;
}

const calculateMaxZoomStepDiff = memoizeOne(unmemoizedCalculateMaxZoomStepDiff);

function unmemoizedGetMaxBucketCountPerDim(dataSetScale: Vector3): Vector3 {
  const maximumPlaneExtentInNm =
    constants.PLANE_WIDTH *
    calculateMaxZoomStepDiff(dataSetScale) *
    scaleInfo.getBaseVoxel(dataSetScale);

  const maxBucketCountPerDim = dataSetScale.map(
    nm => extraBucketsPerDim + Math.ceil(maximumPlaneExtentInNm / nm / constants.BUCKET_WIDTH),
  );

  return ((maxBucketCountPerDim: any): Vector3);
}

export const getMaxBucketCountPerDim = memoizeOne(unmemoizedGetMaxBucketCountPerDim);

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
  const maxLogZoomStep = Math.log2(getMaxZoomStep(state.dataset));
  const min = Math.min(state.datasetConfiguration.quality, maxLogZoomStep);
  const maxZoomStepDiff = calculateMaxZoomStepDiff(state.dataset.dataSource.scale);
  const value =
    Math.ceil(Math.log2(state.flycam.zoomStep / maxZoomStepDiff)) +
    state.datasetConfiguration.quality;
  return clamp(min, value, maxLogZoomStep);
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
  const vWidthhalf = viewportWidthHalf * baseVoxelFactors[v];

  const left = Math.floor((position[u] - uWidthHalf) / constants.BUCKET_WIDTH);
  const top = Math.floor((position[v] - vWidthhalf) / constants.BUCKET_WIDTH);
  const right = Math.floor((position[u] + uWidthHalf) / constants.BUCKET_WIDTH);
  const bottom = Math.floor((position[v] + vWidthhalf) / constants.BUCKET_WIDTH);

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
