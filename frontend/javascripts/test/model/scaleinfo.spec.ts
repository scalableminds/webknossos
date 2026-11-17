import { UnitLong, UnitShort, type Vector3 } from "viewer/constants";
import { convertVoxelSizeToUnit, getUnitPerPixel, getVoxelPerPixel } from "viewer/model/scaleinfo";
import { describe, expect, it } from "vitest";

describe("Pixel conversion", () => {
  const voxelSize = { factor: [4, 8, 40] as Vector3, unit: UnitLong.nm };

  it("should cover the smallest voxel extent with one pixel at zoom step 1", () => {
    expect(getUnitPerPixel(voxelSize)).toBe(4);
    expect(getVoxelPerPixel(voxelSize)).toEqual([1, 0.5, 0.1]);
  });

  it("should scale linearly with the zoom step", () => {
    expect(getUnitPerPixel(voxelSize, 2.5)).toBe(10);
    expect(getVoxelPerPixel(voxelSize, 2)).toEqual([2, 1, 0.2]);
  });
});

describe("Format Utils", () => {
  it("Test conversion of VoxelSize in unit to nm", () => {
    expect([1, 1, 1]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.nm }, UnitShort.nm),
    );
    expect([1e3, 1e3, 1e3]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.µm }, UnitShort.nm),
    );
    expect([1e6, 1e6, 1e6]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.mm }, UnitShort.nm),
    );
    expect([1e7, 1e7, 1e7]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.cm }, UnitShort.nm),
    );
    expect([1e9, 1e9, 1e9]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.m }, UnitShort.nm),
    );
    expect([1e-3, 1e-3, 1e-3]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.pm }, UnitShort.nm),
    );
    expect([1e-6, 1e-6, 1e-6]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.fm }, UnitShort.nm),
    );
  });

  it("Test conversion of VoxelSize in unit to m", () => {
    expect([1, 1, 1]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.m }, UnitShort.m),
    );
    expect([1e3, 1e3, 1e3]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.km }, UnitShort.m),
    );
    expect([1e-3, 1e-3, 1e-3]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.mm }, UnitShort.m),
    );
    expect([1e-6, 1e-6, 1e-6]).toEqual(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.µm }, UnitShort.m),
    );
  });
});
