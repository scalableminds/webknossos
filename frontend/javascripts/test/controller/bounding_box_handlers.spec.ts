import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import { getMaxDistanceToSecondaryEdge } from "viewer/controller/combinations/bounding_box_handlers";
import Dimension from "viewer/model/dimensions";
import { describe, expect, it } from "vitest";

const isotropicPlaneRatio: Vector3 = [1, 1, 1];
const MAX_DISTANCE = 60;
// In the YZ viewport, the first (horizontal) dimension is z and the second (vertical) one is y.
const yzIndices = Dimension.getIndices("PLANE_YZ");
// The vertical edges (ids 2 and 3) are the depth (z) edges and extend along y.
const MIN_Z_EDGE_ID = 2;

describe("getMaxDistanceToSecondaryEdge", () => {
  it("should use the full tolerance along a long edge", () => {
    const tallBox: BoundingBoxMinMaxType = { min: [0, 0, 100], max: [100, 1000, 101] };
    const position: Vector3 = [50, 500, 100];
    expect(
      getMaxDistanceToSecondaryEdge(
        tallBox,
        MIN_Z_EDGE_ID,
        position,
        yzIndices,
        isotropicPlaneRatio,
        MAX_DISTANCE,
      ),
    ).toBe(MAX_DISTANCE);
  });

  it("should restrict the corner regions to the outer quarters of a short edge", () => {
    // The box is 112 voxels tall, so the full tolerance of 60 would cover the whole edge.
    const shortBox: BoundingBoxMinMaxType = { min: [0, 0, 100], max: [100, 112, 101] };
    const position: Vector3 = [50, 40, 100];
    expect(
      getMaxDistanceToSecondaryEdge(
        shortBox,
        MIN_Z_EDGE_ID,
        position,
        yzIndices,
        isotropicPlaneRatio,
        MAX_DISTANCE,
      ),
    ).toBe(28);
  });

  it("should take the voxel size into account", () => {
    const shortBox: BoundingBoxMinMaxType = { min: [0, 0, 100], max: [100, 112, 101] };
    const position: Vector3 = [50, 40, 100];
    // y voxels that are rendered twice as large make the edge twice as long on screen.
    expect(
      getMaxDistanceToSecondaryEdge(
        shortBox,
        MIN_Z_EDGE_ID,
        position,
        yzIndices,
        [1, 0.5, 1],
        MAX_DISTANCE,
      ),
    ).toBe(56);
  });

  it("should use the full tolerance beyond the end of a short edge", () => {
    const shortBox: BoundingBoxMinMaxType = { min: [0, 0, 100], max: [100, 112, 101] };
    // Above the box's top (min y) end.
    const position: Vector3 = [50, -10, 100];
    expect(
      getMaxDistanceToSecondaryEdge(
        shortBox,
        MIN_Z_EDGE_ID,
        position,
        yzIndices,
        isotropicPlaneRatio,
        MAX_DISTANCE,
      ),
    ).toBe(MAX_DISTANCE);
  });
});
