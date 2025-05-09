import { UnitLong, UnitShort } from "oxalis/constants";
import { convertVoxelSizeToUnit } from "oxalis/model/scaleinfo";
import { describe, it, expect } from "vitest";

describe("Format Utils", () => {
  it("Test conversion of VoxelSize in unit to nm", () => {
    expect([1, 1, 1]).toBe(convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.nm }));
    expect([1e3, 1e3, 1e3]).toBe(convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.µm }));
    expect([1e6, 1e6, 1e6]).toBe(convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.mm }));
    expect([1e9, 1e9, 1e9]).toBe(convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.cm }));
    expect([1e12, 1e12, 1e12]).toBe(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.m }),
    );
    expect([1e-3, 1e-3, 1e-3]).toBe(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.fm }),
    );
    expect([1e-6, 1e-6, 1e-6]).toBe(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.pm }),
    );
  });

  it("Test conversion of VoxelSize in unit to m", () => {
    expect([1, 1, 1]).toBe(
      convertVoxelSizeToUnit({ factor: [1, 1, 1], unit: UnitLong.m }, UnitShort.m),
    );
    expect([1, 1, 1]).toBe(
      convertVoxelSizeToUnit({ factor: [1e3, 1e3, 1e3], unit: UnitLong.km }, UnitShort.m),
    );
    expect([1, 1, 1]).toBe(
      convertVoxelSizeToUnit({ factor: [1e-3, 1e-3, 1e-3], unit: UnitLong.mm }, UnitShort.m),
    );
    expect([1, 1, 1]).toBe(
      convertVoxelSizeToUnit({ factor: [1e-6, 1e-6, 1e-6], unit: UnitLong.µm }, UnitShort.m),
    );
  });
});
