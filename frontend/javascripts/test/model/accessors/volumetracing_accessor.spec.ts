import type { Vector3 } from "viewer/constants";
import {
  getBrushCenterInMag,
  getBrushDiameterInMag,
  getEraseBrushDiameterInMag,
} from "viewer/model/accessors/volumetracing_accessor";
import { describe, expect, it } from "vitest";

const XY_PLANE_AXIS = 2;
const ISOTROPIC: Vector3 = [1, 1, 1];

function getCenter(position: Vector3, mag: Vector3, brushSize: number): Vector3 {
  const diameterInMag = getBrushDiameterInMag(brushSize, ISOTROPIC, mag);
  return getBrushCenterInMag(position, mag, diameterInMag, XY_PLANE_AXIS);
}

describe("getBrushCenterInMag", () => {
  it("snaps odd brush sizes to the center of the hovered voxel", () => {
    expect(getCenter([4.2, 4.8, 7.5], [1, 1, 1], 5)).toEqual([4.5, 4.5, 7.5]);
    expect(getCenter([4.2, 4.8, 7.5], [1, 1, 1], 1)).toEqual([4.5, 4.5, 7.5]);
  });

  it("snaps even brush sizes to the closest voxel corner", () => {
    expect(getCenter([4.2, 4.8, 7.5], [1, 1, 1], 10)).toEqual([4, 5, 7.5]);
  });

  it("keeps the plane axis in the hovered slice for even brush sizes", () => {
    expect(getCenter([4.2, 4.8, 7.9], [1, 1, 1], 10)[XY_PLANE_AXIS]).toBe(7.5);
  });

  it("uses the parity of the diameter in the brush mag", () => {
    // A brush size of 12 at mag 4 is 3 voxels -> odd -> voxel center
    expect(getCenter([9, 15, 0], [4, 4, 1], 12)).toEqual([2.5, 3.5, 0.5]);
    // A brush size of 16 at mag 4 is 4 voxels -> even -> closest corner
    expect(getCenter([9, 15, 0], [4, 4, 1], 16)).toEqual([2, 4, 0.5]);
  });

  it("treats diameters below one voxel as odd so that the hovered voxel is painted", () => {
    expect(getCenter([9, 15, 0], [4, 4, 1], 1)).toEqual([2.5, 3.5, 0.5]);
  });
});

const NO_MAXIMUM: Vector3 = [10000, 10000, 10000];

function getEraseDiameter(brushSize: number, voxelPerPixel: Vector3, mag: Vector3): Vector3 {
  return getEraseBrushDiameterInMag(
    getBrushDiameterInMag(brushSize, voxelPerPixel, mag),
    NO_MAXIMUM,
  );
}

describe("getEraseBrushDiameterInMag", () => {
  it("enlarges the brush by roughly 5%", () => {
    expect(getEraseDiameter(50, ISOTROPIC, [1, 1, 1])).toEqual([52, 52, 52]);
    expect(getEraseDiameter(200, ISOTROPIC, [1, 1, 1])).toEqual([210, 210, 210]);
  });

  it("does not enlarge brushes which are tiny in the labeled mag", () => {
    for (const brushSize of [1, 5, 19]) {
      expect(getEraseDiameter(brushSize, ISOTROPIC, [1, 1, 1])).toEqual([
        brushSize,
        brushSize,
        brushSize,
      ]);
    }
    // 50 pixels are 12.5 voxels in mag 4
    expect(getEraseDiameter(50, ISOTROPIC, [4, 4, 1])).toEqual([12.5, 12.5, 52]);
  });

  it("enlarges each axis by an even number of voxels of the labeled mag", () => {
    // 100 pixels are 50 voxels in mag 2 and 25 voxels along the anisotropic axis.
    expect(getEraseDiameter(100, [1, 1, 0.5], [2, 2, 2])).toEqual([52, 52, 27]);
  });

  it("centers the eraser exactly like the draw brush in all mags and viewports", () => {
    const voxelSizes: Vector3[] = [ISOTROPIC, [1, 1, 0.5], [1, 0.4, 0.25]];
    const mags: Vector3[] = [
      [1, 1, 1],
      [2, 2, 1],
      [2, 2, 2],
      [4, 4, 2],
      [8, 8, 8],
    ];
    const position: Vector3 = [123.3, 77.8, 41.6];
    for (const voxelPerPixel of voxelSizes) {
      for (const mag of mags) {
        for (let brushSize = 1; brushSize <= 300; brushSize++) {
          const drawDiameter = getBrushDiameterInMag(brushSize, voxelPerPixel, mag);
          const eraseDiameter = getEraseBrushDiameterInMag(drawDiameter, NO_MAXIMUM);
          for (const planeAxis of [0, 1, 2]) {
            expect(getBrushCenterInMag(position, mag, eraseDiameter, planeAxis)).toEqual(
              getBrushCenterInMag(position, mag, drawDiameter, planeAxis),
            );
          }
          for (const axis of [0, 1, 2]) {
            expect(eraseDiameter[axis]).toBeGreaterThanOrEqual(drawDiameter[axis]);
          }
        }
      }
    }
  });

  it("does not exceed the maximum brush size and keeps the parity when capped", () => {
    const maximum: Vector3 = [300, 300, 300];
    const erase = (diameter: number) =>
      getEraseBrushDiameterInMag([diameter, diameter, diameter], maximum)[0];
    expect(erase(300)).toBe(300);
    expect(erase(290)).toBe(300);
    expect(erase(295)).toBe(299);
    expect(erase(299)).toBe(299);
  });
});
