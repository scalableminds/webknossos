// @flow
import type {
  Vector2,
  Vector3,
  Vector4,
  OrthoViewType,
  OrthoViewMapType,
  BoundingBoxType,
} from "oxalis/constants";
import type { FlycamType, OxalisState } from "oxalis/store";
import constants, { OrthoViews } from "oxalis/constants";
import Maybe from "data.maybe";
import Dimensions from "oxalis/model/dimensions";
import * as scaleInfo from "oxalis/model/scaleinfo";
import _ from "lodash";
import Utils from "libs/utils";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4 } from "libs/mjs";
import * as THREE from "three";

// All methods in this file should use constants.PLANE_WIDTH instead of constants.VIEWPORT_WIDTH
// as the area that is rendered is only of size PLANE_WIDTH.
// If VIEWPORT_WIDTH, which is a little bigger, is used instead, we end up with a data texture
// that is shrinked a little bit, which leads to the texture not being in sync with the THREEjs scene.

// Historically, this width decided at which point which zoom step was picked.
// There is no specific reason why this exact size has to be chosen. As long as enough buckets are sent
// to the GPU (RENDERED_BUCKETS_PER_DIMENSION) this width can be increased or decreased.
const MAX_RENDING_TARGET_WIDTH = 512 - constants.BUCKET_WIDTH - 1;

// maximum difference between requested coordinate and actual texture position
const MAX_ZOOM_STEP_DIFF = MAX_RENDING_TARGET_WIDTH / constants.PLANE_WIDTH;

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
  return Maybe.fromNullable(state.dataset)
    .map(dataset =>
      dataset.dataLayers.reduce(
        (maxZoomStep, layer) => Math.max(...layer.resolutions.map(r => Math.max(...r))),
        minimumZoomStepCount,
      ),
    )
    .getOrElse(minimumZoomStepCount + constants.DOWNSAMPLED_ZOOM_STEP_COUNT);
}

export function getIntegerZoomStep(state: OxalisState): number {
  return Math.floor(state.flycam.zoomStep);
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

export function getViewportBoundingBox(state: OxalisState): BoundingBoxType {
  const position = getPosition(state.flycam);
  const offset = getPlaneScalingFactor(state.flycam) * constants.PLANE_WIDTH / 2;
  const baseVoxelFactors = scaleInfo.getBaseVoxelFactors(state.dataset.scale);
  const min = [0, 0, 0];
  const max = [0, 0, 0];

  for (let i = 0; i <= 2; i++) {
    min[i] = position[i] - offset * baseVoxelFactors[i];
    max[i] = position[i] + offset * baseVoxelFactors[i];
  }

  return { min, max };
}

export function getTexturePosition(
  state: OxalisState,
  planeId: OrthoViewType,
  resolutions: Array<Vector3>,
): Vector3 {
  const texturePosition = _.clone(getPosition(state.flycam));
  // As the Model does not render textures for exact positions, the last 5 bits of
  // the X and Y coordinates for each texture have to be set to 0
  const [u, v] = Dimensions.getIndices(planeId);
  const logZoomStep = getRequestLogZoomStep(state);
  const resolution = resolutions[logZoomStep];
  const uMultiplier = constants.BUCKET_WIDTH * resolution[u];
  const vMultiplier = constants.BUCKET_WIDTH * resolution[v];
  texturePosition[u] = Math.floor(texturePosition[u] / uMultiplier) * uMultiplier;
  texturePosition[v] = Math.floor(texturePosition[v] / vMultiplier) * vMultiplier;

  return texturePosition;
}
