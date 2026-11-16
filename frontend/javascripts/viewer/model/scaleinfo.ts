import { UnitsMap } from "libs/format_utils";
import type { VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type UnitShort, type Vector3 } from "viewer/constants";

// The zoom step is defined so that, at zoom step 1, one screen pixel covers the smallest
// voxel extent of the dataset. The brush size and the flycam's local coordinates are
// measured in such "pixels at zoom step 1", too.
export function getUnitPerPixel(voxelSize: VoxelSize, zoomStep: number = 1): number {
  return zoomStep * Math.min(...voxelSize.factor);
}

// Returns how many voxels one screen pixel covers per axis.
export function getVoxelPerPixel(voxelSize: VoxelSize, zoomStep: number = 1): Vector3 {
  const unitPerPixel = getUnitPerPixel(voxelSize, zoomStep);
  return [
    unitPerPixel / voxelSize.factor[0],
    unitPerPixel / voxelSize.factor[1],
    unitPerPixel / voxelSize.factor[2],
  ];
}

export function voxelToVolumeInUnit(
  voxelSize: VoxelSize,
  mag: Vector3,
  volumeInVx: number,
): number {
  return (
    mag[0] *
    mag[1] *
    mag[2] *
    voxelSize.factor[0] *
    voxelSize.factor[1] *
    voxelSize.factor[2] *
    volumeInVx
  );
}

export function voxelToUnit(voxelSize: VoxelSize, posArray: Vector3): Vector3 {
  const result = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    result[i] = posArray[i] * voxelSize.factor[i];
  }
  return result;
}

export function convertVoxelSizeToUnit(voxelSize: VoxelSize, newUnit: UnitShort): Vector3 {
  const shortUnit = LongUnitToShortUnitMap[voxelSize.unit];
  const conversionFactor = UnitsMap[shortUnit] / UnitsMap[newUnit];
  const voxelSizeInNewUnit = voxelSize.factor.map((value) => value * conversionFactor) as Vector3;
  return voxelSizeInNewUnit;
}
