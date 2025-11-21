import { UnitsMap } from "libs/format_utils";
import type { VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type UnitShort, type Vector3 } from "viewer/constants";

export function getBaseVoxelInUnit(voxelSizeFactor: Vector3): number {
  // base voxel should be a cube with highest mag
  return Math.min(...voxelSizeFactor);
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

export function getBaseVoxelFactorsInUnit(maybeTransformedVoxelSize: VoxelSize): Vector3 {
  const scaleFactor = maybeTransformedVoxelSize.factor;
  // base voxel should be a cube with highest mag
  const baseVoxel = getBaseVoxelInUnit(scaleFactor);
  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [baseVoxel / scaleFactor[0], baseVoxel / scaleFactor[1], baseVoxel / scaleFactor[2]];
}

export function voxelToUnit(maybeTransformedVoxelSize: VoxelSize, posArray: Vector3): Vector3 {
  const result = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    result[i] = posArray[i] * maybeTransformedVoxelSize.factor[i];
  }
  return result;
}

export function convertVoxelSizeToUnit(
  maybeTransformedVoxelSize: VoxelSize,
  newUnit: UnitShort,
): Vector3 {
  const shortUnit = LongUnitToShortUnitMap[maybeTransformedVoxelSize.unit];
  const conversionFactor = UnitsMap[shortUnit] / UnitsMap[newUnit];
  const voxelSizeInNewUnit = maybeTransformedVoxelSize.factor.map(
    (value) => value * conversionFactor,
  ) as Vector3;
  return voxelSizeInNewUnit;
}
