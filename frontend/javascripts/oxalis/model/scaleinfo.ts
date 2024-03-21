import type { Vector3 } from "oxalis/constants";
export function getBaseVoxel(datasetScale: Vector3): number {
  // base voxel should be a cube with highest resolution
  return Math.min(...datasetScale);
}

export function voxelToNm3(datasetScale: Vector3, mag: Vector3, volumeInVx: number): number {
  return (
    mag[0] * mag[1] * mag[2] * datasetScale[0] * datasetScale[1] * datasetScale[2] * volumeInVx
  );
}

export function getBaseVoxelFactors(datasetScale: Vector3): Vector3 {
  // base voxel should be a cube with highest resolution
  const baseVoxel = getBaseVoxel(datasetScale);
  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [baseVoxel / datasetScale[0], baseVoxel / datasetScale[1], baseVoxel / datasetScale[2]];
}
export function getVoxelPerNM(datasetScale: Vector3): Vector3 {
  const voxelPerNM = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    voxelPerNM[i] = 1 / datasetScale[i];
  }

  return voxelPerNM;
}
export function voxelToNm(datasetScale: Vector3, posArray: Vector3): Vector3 {
  const result = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    result[i] = posArray[i] * datasetScale[i];
  }

  return result;
}
