import { UnitLong, UnitShort } from "viewer/constants";
import { convertVoxelSizeToUnit } from "viewer/model/scaleinfo";
import { describe, it, expect } from "vitest";

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
