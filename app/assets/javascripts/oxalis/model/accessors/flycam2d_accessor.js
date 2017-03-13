// @flow
import type { Vector2, Vector3, Vector4, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { BoundingBoxType } from "oxalis/model";
import type { Flycam3DType, OxalisState } from "oxalis/store";
import constants, { OrthoViews, OrthoViewValues } from "oxalis/constants";
import Maybe from "data.maybe";
import Dimensions from "oxalis/model/dimensions";
import { getPosition } from "oxalis/model/accessors/flycam3d_accessor";
import * as scaleInfo2 from "oxalis/model/scaleinfo2";

const Flycam2dConstants = {
  // maximum difference between requested coordinate and actual texture position
  MAX_TEXTURE_OFFSET: 31,
  MAX_ZOOM_THRESHOLD: 2,
  PIXEL_RAY_THRESHOLD: 10,
};

export const maxZoomStepDiff = (() => {
  // Invariant: 2^zoomStep / 2^integerZoomStep <= 2^maxZoomDiff
  const zoomThreshold = Math.min(
    Flycam2dConstants.MAX_ZOOM_THRESHOLD,
    (constants.TEXTURE_WIDTH - Flycam2dConstants.MAX_TEXTURE_OFFSET) / constants.VIEWPORT_WIDTH,
  );
  return Math.log(zoomThreshold) / Math.LN2;
})();


export function getZoomStepCount(state: OxalisState): number {
  return 1 + Maybe.fromNullable(state.dataset)
    .map(dataset =>
      dataset.dataLayers.reduce((maxZoomStep, layer) =>
        Math.max(Math.log(Math.max(...layer.resolutions)) / Math.LN2),
        -Infinity))
    .getOrElse(-Infinity);
}

export function getMaxZoomStep(state: OxalisState): number {
  return Math.pow(2, getZoomStepCount(state) - 1 + maxZoomStepDiff);
}

export function getIntegerZoomStep(state: OxalisState): number {
  // round, because Model expects Integer
  let integerZoomStep = Math.ceil((state.flycam3d.zoomStep - maxZoomStepDiff) + state.datasetConfiguration.quality);
  integerZoomStep = Math.min(integerZoomStep, getZoomStepCount(state));
  integerZoomStep = Math.max(integerZoomStep, 0);
  return integerZoomStep;
}

export function calculateBuffer(state: OxalisState): OrthoViewMapType<Vector2> {
  // buffer: how many pixels is the texture larger than the canvas on each dimension?
  // --> two dimensional array with buffer[planeID][dimension], dimension: x->0, y->1
  let pixelNeeded;
  let scaleArray;
  const buffer = {};
  for (const planeID of OrthoViewValues) {
    scaleArray = Dimensions.transDim(scaleInfo2.getBaseVoxelFactors(state.dataset.scale), planeID);
    pixelNeeded = constants.VIEWPORT_WIDTH * getTextureScalingFactor(state);
    buffer[planeID] = [
      constants.TEXTURE_WIDTH - (pixelNeeded * scaleArray[0]),
      constants.TEXTURE_WIDTH - (pixelNeeded * scaleArray[1]),
    ];
  }
  return buffer;
}

export function getTextureScalingFactor(state: OxalisState): number {
  return Math.pow(2, state.flycam3d.zoomStep) / Math.pow(2, getIntegerZoomStep(state));
}

export function getPlaneScalingFactor(flycam3d: Flycam3DType): number {
  return Math.pow(2, flycam3d.zoomStep);
}

export function getRotationOrtho(planeID: OrthoViewType): Vector3 {
  switch (planeID) {
    case OrthoViews.PLANE_YZ: return [0, 270, 0];
    case OrthoViews.PLANE_XZ: return [90, 0, 0];
    default:
    case OrthoViews.PLANE_XY: return [0, 0, 0];
  }
}

export function getViewportBoundingBox(state: OxalisState): BoundingBoxType {
  const position = getPosition(state.flycam3d);
  const offset = (getPlaneScalingFactor(state.flycam3d) * constants.VIEWPORT_WIDTH) / 2;
  const baseVoxelFactors = scaleInfo2.getBaseVoxelFactors(state.dataset.scale);
  const min = [0, 0, 0];
  const max = [0, 0, 0];

  for (let i = 0; i <= 2; i++) {
    min[i] = position[i] - (offset * baseVoxelFactors[i]);
    max[i] = position[i] + (offset * baseVoxelFactors[i]);
  }

  return { min, max };
}

export function getTexturePosition(state: OxalisState, planeID: OrthoViewType): Vector3 {
  const texturePosition = getPosition(state.flycam3d);
  // As the Model does not render textures for exact positions, the last 5 bits of
  // the X and Y coordinates for each texture have to be set to 0
  for (let i = 0; i <= 2; i++) {
    if (i !== Dimensions.getIndices(planeID)[2]) {
      texturePosition[i] &= -1 << (5 + getIntegerZoomStep(state));
    }
  }
  return texturePosition;
}

export function getOffsets(state: OxalisState, planeID: OrthoViewType): Vector2 {
  const buffer = calculateBuffer(state);
  const position = getPosition(state.flycam3d);
  const integerZoomStep = getIntegerZoomStep(state);
  // return the coordinate of the upper left corner of the viewport as texture-relative coordinate
  const ind = Dimensions.getIndices(planeID);
  return [
    (buffer[planeID][0] / 2) + ((position[ind[0]] - getTexturePosition(state, planeID)[ind[0]]) / Math.pow(2, integerZoomStep)),
    (buffer[planeID][1] / 2) + ((position[ind[1]] - getTexturePosition(state, planeID)[ind[1]]) / Math.pow(2, integerZoomStep)),
  ];
}

export function getArea(state: OxalisState, planeID: OrthoViewType): Vector4 {
  // returns [left, top, right, bottom] array

  // convert scale vector to array in order to be able to use getIndices()
  const scaleArray = Dimensions.transDim(scaleInfo2.getBaseVoxelFactors(state.dataset.scale), planeID);
  const offsets = getOffsets(state, planeID);
  const size = getTextureScalingFactor(state) * constants.VIEWPORT_WIDTH;
  // two pixels larger, just to fight rounding mistakes (important for mouse click conversion)
  // [offsets[0] - 1, offsets[1] - 1, offsets[0] + size * scaleArray[ind[0]] + 1, offsets[1] + size * scaleArray[ind[1]] + 1]
  return [
    offsets[0],
    offsets[1],
    offsets[0] + (size * scaleArray[0]),
    offsets[1] + (size * scaleArray[1]),
  ];
}

export function getAreas(state: OxalisState): OrthoViewMapType<Vector4> {
  return {
    [OrthoViews.PLANE_XY]: getArea(state, OrthoViews.PLANE_XY),
    [OrthoViews.PLANE_XZ]: getArea(state, OrthoViews.PLANE_XZ),
    [OrthoViews.PLANE_YZ]: getArea(state, OrthoViews.PLANE_YZ),
  };
}

// getRayThreshold()
// getRayThresholdTDView(cameraRight: number, cameraLeft: number)
export function getRayThreshold(flycam3d: Flycam3DType): number {
  return Flycam2dConstants.PIXEL_RAY_THRESHOLD * Math.pow(2, flycam3d.zoomStep);
}

export function getRayThresholdTDView(dataSetScale: Vector3, cameraRight: number, cameraLeft: number): number {
  // Voxel threshold used for ray tracing
  const voxelPerPixel3DView =
    (cameraRight - cameraLeft) /
    constants.VIEWPORT_WIDTH /
    scaleInfo2.getBaseVoxel(dataSetScale);
  return Flycam2dConstants.PIXEL_RAY_THRESHOLD * voxelPerPixel3DView;
}
