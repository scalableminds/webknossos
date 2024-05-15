import type { Vector3 } from "oxalis/constants";
import { DatasetScale } from "types/api_flow_types";

export function getBaseVoxelInUnit(datasetScaleFactor: Vector3): number {
  // base voxel should be a cube with highest resolution
  return Math.min(...datasetScaleFactor);
}

export function voxelToVolumeInUnit(
  datasetScale: DatasetScale,
  mag: Vector3,
  volumeInVx: number,
): number {
  return (
    mag[0] *
    mag[1] *
    mag[2] *
    datasetScale.factor[0] *
    datasetScale.factor[1] *
    datasetScale.factor[2] *
    volumeInVx
  );
}

export function getBaseVoxelFactorsInUnit(datasetScale: DatasetScale): Vector3 {
  const scaleFactor = datasetScale.factor;
  // base voxel should be a cube with highest resolution
  const baseVoxel = getBaseVoxelInUnit(scaleFactor);
  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [baseVoxel / scaleFactor[0], baseVoxel / scaleFactor[1], baseVoxel / scaleFactor[2]];
}

export function getVoxelPerUnit(datasetScale: DatasetScale): Vector3 {
  const voxelPerUnit = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    voxelPerUnit[i] = 1 / datasetScale.factor[i];
  }
  return voxelPerUnit;
}

export function voxelToUnit(datasetScale: DatasetScale, posArray: Vector3): Vector3 {
  const result = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    result[i] = posArray[i] * datasetScale.factor[i];
  }
  return result;
}
