import { UnitLong, UnitShort } from "viewer/constants";
import {
  convertVoxelSizeToUnit,
  getFinestVoxelSize,
  getVoxelSizeScaleFactor,
} from "viewer/model/scaleinfo";
import { describe, expect, it } from "vitest";

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

describe("getVoxelSizeScaleFactor", () => {
  it("should scale a coarser source up to a finer target", () => {
    expect(
      getVoxelSizeScaleFactor(
        { factor: [6, 6, 6], unit: UnitLong.nm },
        { factor: [2, 2, 2], unit: UnitLong.nm },
      ),
    ).toEqual([3, 3, 3]);
  });

  it("should return the identity for identical voxel sizes", () => {
    expect(
      getVoxelSizeScaleFactor(
        { factor: [4, 4, 40], unit: UnitLong.nm },
        { factor: [4, 4, 40], unit: UnitLong.nm },
      ),
    ).toEqual([1, 1, 1]);
  });

  it("should scale each axis independently", () => {
    expect(
      getVoxelSizeScaleFactor(
        { factor: [4, 8, 40], unit: UnitLong.nm },
        { factor: [2, 2, 10], unit: UnitLong.nm },
      ),
    ).toEqual([2, 4, 4]);
  });

  it("should handle differing units", () => {
    expect(
      getVoxelSizeScaleFactor(
        { factor: [1, 1, 1], unit: UnitLong.µm },
        { factor: [10, 10, 10], unit: UnitLong.nm },
      ),
    ).toEqual([100, 100, 100]);
  });

  it("should fall back to 1 for degenerate target voxel sizes", () => {
    expect(
      getVoxelSizeScaleFactor(
        { factor: [6, 6, 6], unit: UnitLong.nm },
        { factor: [0, 2, 2], unit: UnitLong.nm },
      ),
    ).toEqual([1, 3, 3]);
  });
});

describe("getFinestVoxelSize", () => {
  it("should return a single voxel size unchanged", () => {
    expect(getFinestVoxelSize([{ factor: [6, 6, 6], unit: UnitLong.nm }])).toEqual({
      factor: [6, 6, 6],
      unit: UnitLong.nm,
    });
  });

  it("should take the per-axis minimum", () => {
    expect(
      getFinestVoxelSize([
        { factor: [4, 4, 40], unit: UnitLong.nm },
        { factor: [2, 8, 10], unit: UnitLong.nm },
      ]),
    ).toEqual({ factor: [2, 4, 10], unit: UnitLong.nm });
  });

  it("should use the unit of the finest voxel size when units differ", () => {
    // 1 µm is coarser than 10 nm, so the result is expressed in nm.
    expect(
      getFinestVoxelSize([
        { factor: [1, 1, 1], unit: UnitLong.µm },
        { factor: [10, 10, 10], unit: UnitLong.nm },
      ]),
    ).toEqual({ factor: [10, 10, 10], unit: UnitLong.nm });
  });

  it("should throw for an empty list", () => {
    expect(() => getFinestVoxelSize([])).toThrow();
  });
});
