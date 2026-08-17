import { UnitsMap } from "libs/format_utils";
import type { VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, UnitShort, type Vector3 } from "viewer/constants";

export function getBaseVoxelInUnit(voxelSizeFactor: Vector3): number {
  // base voxel should be a cube with highest resolution
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

export function getBaseVoxelFactorsInUnit(voxelSize: VoxelSize): Vector3 {
  const scaleFactor = voxelSize.factor;
  // base voxel should be a cube with highest mag
  const baseVoxel = getBaseVoxelInUnit(scaleFactor);
  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [baseVoxel / scaleFactor[0], baseVoxel / scaleFactor[1], baseVoxel / scaleFactor[2]];
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

// Returns the per-axis factor by which a layer needs to be scaled so that data stored with
// sourceVoxelSize appears at its correct physical size in a dataset that uses targetVoxelSize.
// E.g. a source voxel size of 6/6/6 in a target of 2/2/2 yields [3, 3, 3].
export function getVoxelSizeScaleFactor(
  sourceVoxelSize: VoxelSize,
  targetVoxelSize: VoxelSize,
): Vector3 {
  const sourceFactor = convertVoxelSizeToUnit(
    sourceVoxelSize,
    LongUnitToShortUnitMap[targetVoxelSize.unit],
  );
  return sourceFactor.map((sourceValue, index) => {
    const targetValue = targetVoxelSize.factor[index];
    // Guard against degenerate voxel sizes, which would yield a non-finite scale factor.
    return targetValue !== 0 && Number.isFinite(targetValue) && Number.isFinite(sourceValue)
      ? sourceValue / targetValue
      : 1;
  }) as Vector3;
}

// Returns the finest of the given voxel sizes, i.e. the per-axis minimum. Voxel sizes may use
// different units; the result is expressed in the unit of the voxel size with the smallest base
// voxel, so that the common case of all voxel sizes sharing a unit preserves that unit.
export function getFinestVoxelSize(voxelSizes: VoxelSize[]): VoxelSize {
  if (voxelSizes.length === 0) {
    throw new Error("Cannot determine the finest voxel size of an empty list of voxel sizes.");
  }
  const finestVoxelSize = voxelSizes.reduce((finest, current) =>
    getBaseVoxelInUnit(convertVoxelSizeToUnit(current, UnitShort.nm)) <
    getBaseVoxelInUnit(convertVoxelSizeToUnit(finest, UnitShort.nm))
      ? current
      : finest,
  );
  const unit = finestVoxelSize.unit;
  const factor = voxelSizes
    .map((voxelSize) => convertVoxelSizeToUnit(voxelSize, LongUnitToShortUnitMap[unit]))
    .reduce(
      (finestFactor, currentFactor) =>
        finestFactor.map((value, index) => Math.min(value, currentFactor[index])) as Vector3,
    );
  return { factor, unit };
}
