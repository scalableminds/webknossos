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

// Historically, this width decided when which zoom step was.
// There is no specific reason why this exact size has to be chosen. As long as enough buckets are sent
// to the GPU (RENDERED_BUCKETS_PER_DIMENSION) this width can be increased or decreased.
const MAX_RENDING_TARGET_WIDTH = 512 - 32 - 1;

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
  return (
    1 +
    Maybe.fromNullable(state.dataset)
      .map(dataset =>
        Math.max(
          0,
          ...dataset.dataLayers.map(layer =>
            Math.max(0, ...layer.resolutions.map(r => Math.max(r[0], r[1], r[2]))),
          ),
        ),
      )
      .getOrElse(1)
  );
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

export function getTexturePosition(state: OxalisState, planeId: OrthoViewType): Vector3 {
  const texturePosition = _.clone(getPosition(state.flycam));
  // As the Model does not render textures for exact positions, the last 5 bits of
  // the X and Y coordinates for each texture have to be set to 0
  const ind = Dimensions.getIndices(planeId);
  const bitMask = -1 << (5 + getRequestLogZoomStep(state));
  texturePosition[ind[0]] &= bitMask;
  texturePosition[ind[1]] &= bitMask;
  return texturePosition;
}

export function getOffsets(state: OxalisState, planeId: OrthoViewType): Vector2 {
  // return the coordinate of the upper left corner of the viewport as texture-relative coordinate
  const position = getPosition(state.flycam);
  const requestZoomStep = Math.pow(2, getRequestLogZoomStep(state));
  const texturePosition = getTexturePosition(state, planeId);
  const ind = Dimensions.getIndices(planeId);
  return [
    (position[ind[0]] - texturePosition[ind[0]]) / requestZoomStep,
    (position[ind[1]] - texturePosition[ind[1]]) / requestZoomStep,
  ];
}

export function getExtent(state: OxalisState, planeId: OrthoViewType): Vector2 {
  const scaleArray = Dimensions.transDim(
    scaleInfo.getBaseVoxelFactors(state.dataset.scale),
    planeId,
  );
  const size = getTextureScalingFactor(state) * constants.PLANE_WIDTH;
  return [size * scaleArray[0], size * scaleArray[1]];
}

export function getArea(state: OxalisState, planeId: OrthoViewType): Vector4 {
  // returns [left, top, right, bottom] array
  const scaleArray = Dimensions.transDim(
    scaleInfo.getBaseVoxelFactors(state.dataset.scale),
    planeId,
  );
  const offsets = getOffsets(state, planeId);
  const size = getTextureScalingFactor(state) * constants.PLANE_WIDTH;
  // two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
  // [offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
  return [
    offsets[0],
    offsets[1],
    offsets[0] + size * scaleArray[0],
    offsets[1] + size * scaleArray[1],
  ];
}

export function getAreas(state: OxalisState): OrthoViewMapType<Vector4> {
  return {
    [OrthoViews.PLANE_XY]: getArea(state, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(state, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(state, OrthoViews.PLANE_YZ),
  };
}
