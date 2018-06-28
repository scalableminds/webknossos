// @flow
import type { Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { FlycamType, OxalisState } from "oxalis/store";
import constants, { OrthoViews } from "oxalis/constants";
import Maybe from "data.maybe";
import Dimensions from "oxalis/model/dimensions";
import * as scaleInfo from "oxalis/model/scaleinfo";
import Utils from "libs/utils";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4 } from "libs/mjs";
import * as THREE from "three";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";

// All methods in this file should use constants.PLANE_WIDTH instead of constants.VIEWPORT_WIDTH
// as the area that is rendered is only of size PLANE_WIDTH.
// If VIEWPORT_WIDTH, which is a little bigger, is used instead, we end up with a data texture
// that is shrinked a little bit, which leads to the texture not being in sync with the THREEjs scene.

// maximum difference between requested coordinate and actual texture position
const MAX_ZOOM_STEP_DIFF = constants.MAX_RENDERING_TARGET_WIDTH / constants.PLANE_WIDTH;

export function getUp(flycam: FlycamType): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[4], matrix[5], matrix[6]];
}

export function getLeft(flycam: FlycamType): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[0], matrix[1], matrix[2]];
}

export function getPosition(flycam: FlycamType): Vector3 {
  const matrix = flycam.currentMatrix;
  return [matrix[12], matrix[13], matrix[14]];
}

export function getRotation(flycam: FlycamType): Vector3 {
  const object = new THREE.Object3D();
  const matrix = new THREE.Matrix4().fromArray(flycam.currentMatrix).transpose();
  object.applyMatrix(matrix);

  // Fix JS modulo bug
  // http://javascript.about.com/od/problemsolving/a/modulobug.htm
  const mod = (x, n) => (x % n + n) % n;

  const rotation: Vector3 = [object.rotation.x, object.rotation.y, object.rotation.z - Math.PI];
  return [
    mod(180 / Math.PI * rotation[0], 360),
    mod(180 / Math.PI * rotation[1], 360),
    mod(180 / Math.PI * rotation[2], 360),
  ];
}

export function getZoomedMatrix(flycam: FlycamType): Matrix4x4 {
  return M4x4.scale1(flycam.zoomStep, flycam.currentMatrix);
}

export function getMaxZoomStep(state: OxalisState): number {
  const minimumZoomStepCount = 1;
  const maxZoomstep = Maybe.fromNullable(state.dataset)
    .map(dataset =>
      Math.max(
        minimumZoomStepCount,
        Math.max(0, ...getResolutions(dataset).map(r => Math.max(r[0], r[1], r[2]))),
      ),
    )
    .getOrElse(2 ** (minimumZoomStepCount + constants.DOWNSAMPLED_ZOOM_STEP_COUNT - 1));
  return maxZoomstep;
}

export function getRequestLogZoomStep(state: OxalisState): number {
  const maxLogZoomStep = Math.log2(getMaxZoomStep(state));
  const min = Math.min(state.datasetConfiguration.quality, maxLogZoomStep);
  const value =
    Math.ceil(Math.log2(state.flycam.zoomStep / MAX_ZOOM_STEP_DIFF)) +
    state.datasetConfiguration.quality;
  return Utils.clamp(min, value, maxLogZoomStep);
}

export function getTextureScalingFactor(state: OxalisState): number {
  return state.flycam.zoomStep / Math.pow(2, getRequestLogZoomStep(state));
}

export function getPlaneScalingFactor(flycam: FlycamType): number {
  return flycam.zoomStep;
}

export function getRotationOrtho(planeId: OrthoViewType): Vector3 {
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

export type AreaType = { left: number, top: number, right: number, bottom: number };

export function getArea(state: OxalisState, planeId: OrthoViewType): AreaType {
  const [u, v] = Dimensions.getIndices(planeId);

  const position = getPosition(state.flycam);
  const viewportWidthHalf = getPlaneScalingFactor(state.flycam) * constants.PLANE_WIDTH / 2;
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

export function getAreas(state: OxalisState): OrthoViewMapType<AreaType> {
  return {
    [OrthoViews.PLANE_XY]: getArea(state, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(state, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(state, OrthoViews.PLANE_YZ),
  };
}
