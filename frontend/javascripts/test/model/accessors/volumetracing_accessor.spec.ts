import type { Vector3 } from "viewer/constants";
import {
  getBrushCenterInMag,
  getBrushDiameterInMag,
  getEraseBrushSize,
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
    // 12 base voxels at mag 4 are 3 voxels -> odd -> voxel center
    expect(getCenter([9, 15, 0], [4, 4, 1], 12)).toEqual([2.5, 3.5, 0.5]);
    // 16 base voxels at mag 4 are 4 voxels -> even -> closest corner
    expect(getCenter([9, 15, 0], [4, 4, 1], 16)).toEqual([2, 4, 0.5]);
  });

  it("treats diameters below one voxel as odd so that the hovered voxel is painted", () => {
    expect(getCenter([9, 15, 0], [4, 4, 1], 1)).toEqual([2.5, 3.5, 0.5]);
  });
});

describe("getEraseBrushSize", () => {
  it("enlarges the brush by roughly 5%", () => {
    expect(getEraseBrushSize(50)).toBe(52);
    expect(getEraseBrushSize(200)).toBe(210);
  });

  it("keeps the parity of the brush size so that the eraser is centered like the brush", () => {
    for (const brushSize of [1, 2, 9, 10, 15, 20, 33, 50, 77, 300]) {
      expect(getEraseBrushSize(brushSize) % 2).toBe(brushSize % 2);
      expect(getEraseBrushSize(brushSize)).toBeGreaterThanOrEqual(brushSize);
    }
  });

  it("does not enlarge tiny brushes which are used for voxel-precise edits", () => {
    expect(getEraseBrushSize(1)).toBe(1);
    expect(getEraseBrushSize(5)).toBe(5);
    expect(getEraseBrushSize(19)).toBe(19);
  });
});
