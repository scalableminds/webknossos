/**
 * scaleinfo.js
 * @flow
 */

import type { Vector3 } from "oxalis/constants";

export function getBaseVoxel(dataSetScale: Vector3): number {
  // base voxel should be a cube with highest resolution
  return Math.min(...dataSetScale);
}

export function getBaseVoxelFactors(dataSetScale: Vector3): Vector3 {
  // base voxel should be a cube with highest resolution
  const baseVoxel = getBaseVoxel(dataSetScale);

  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [baseVoxel / dataSetScale[0], baseVoxel / dataSetScale[1], baseVoxel / dataSetScale[2]];
}

export function getVoxelPerNM(dataSetScale: Vector3): Vector3 {
  const voxelPerNM = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    voxelPerNM[i] = 1 / dataSetScale[i];
  }
  return voxelPerNM;
}

export function voxelToNm(dataSetScale: Vector3, posArray: Vector3): Vector3 {
  const result = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    result[i] = posArray[i] * dataSetScale[i];
  }
  return result;
}
