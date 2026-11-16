import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import {
  getBoundsResizedAlongEdge,
  getClosestEdgesAtPosition,
  type SelectedEdge,
} from "viewer/controller/combinations/bounding_box_handlers";
import Dimension from "viewer/model/dimensions";
import type { UserBoundingBox } from "viewer/store";
import { describe, expect, it } from "vitest";

const isotropicPlaneRatio: Vector3 = [1, 1, 1];
const MAX_DISTANCE = 15;
// In the YZ viewport, the first (horizontal) dimension is z and the second (vertical) one is y.
// Edge ids: 0 = top (min y), 1 = bottom (max y), 2 = left (min z), 3 = right (max z).
const yzIndices = Dimension.getIndices("PLANE_YZ");
const TOP = 0;
const LEFT = 2;
const RIGHT = 3;

// A box that is 28 voxels tall (y) and 200 voxels deep (z) in the YZ viewport.
const flatBox: UserBoundingBox = {
  id: 1,
  boundingBox: { min: [0, 100, 100], max: [10, 128, 300] },
  name: "flat box",
  color: [1, 0, 0],
  isVisible: true,
};

function getEdgeIds(position: Vector3, planeRatio: Vector3 = isotropicPlaneRatio) {
  const edges = getClosestEdgesAtPosition([flatBox], position, yzIndices, planeRatio, MAX_DISTANCE);
  if (edges == null) return null;
  const [primary, secondary] = edges;
  return [primary.edgeId, secondary?.edgeId ?? null];
}

// Converts a viewport position (z, y) into a global position in the YZ viewport.
const yz = (z: number, y: number): Vector3 => [5, y, z];

describe("getClosestEdgesAtPosition", () => {
  it("should grab only the edge in the middle of a short edge", () => {
    // 2 voxels right of the left edge, halfway down.
    expect(getEdgeIds(yz(102, 114))).toEqual([LEFT, null]);
  });

  it("should grab a corner near the end of a short edge", () => {
    // 3 voxels right of the left edge and 2 below the top edge.
    expect(getEdgeIds(yz(103, 102))).toEqual([TOP, LEFT]);
    // 2 voxels right of the left edge and 5 below the top edge.
    expect(getEdgeIds(yz(102, 105))).toEqual([LEFT, TOP]);
  });

  it("should not grab a corner when the long edge is the nearest one", () => {
    // 12 voxels right of the left edge and 10 below the top edge, i.e. the top edge is nearest.
    // The left edge is only 28 voxels long, so the corner region ends 7 voxels below the top edge.
    expect(getEdgeIds(yz(112, 110))).toEqual([TOP, null]);
  });

  it("should not depend on which edge is nearest along the diagonal of a corner", () => {
    // Close to the diagonal through the top left corner, the nearest edge flips.
    expect(getEdgeIds(yz(108, 109))).toEqual([LEFT, null]);
    expect(getEdgeIds(yz(110, 109))).toEqual([TOP, null]);
    expect(getEdgeIds(yz(108, 105))).toEqual([TOP, LEFT]);
    expect(getEdgeIds(yz(105, 106))).toEqual([LEFT, TOP]);
  });

  it("should grab a corner diagonally outside of the box", () => {
    // Outside of a corner, both edges are equally far away, so the first one (top) is the primary edge.
    expect(getEdgeIds(yz(90, 95))).toEqual([TOP, LEFT]);
    expect(getEdgeIds(yz(305, 95))).toEqual([TOP, RIGHT]);
    // Further outside than a quarter of the short edge: still a corner, as there is no limit outside of the box.
    expect(getEdgeIds(yz(90, 90))).toEqual([TOP, LEFT]);
  });

  it("should not jump from a corner to an edge when crossing the end of a short edge", () => {
    // 10 voxels left of the box: just above the top end and just below it.
    expect(getEdgeIds(yz(90, 99))).toEqual([TOP, LEFT]);
    expect(getEdgeIds(yz(90, 100))).toEqual([TOP, LEFT]);
    expect(getEdgeIds(yz(90, 106))).toEqual([LEFT, TOP]);
    // Beyond the outer quarter of the left edge, only the left edge is grabbed.
    expect(getEdgeIds(yz(90, 108))).toEqual([LEFT, null]);
  });

  it("should take the voxel size into account", () => {
    // z voxels that are rendered half as large make the top edge 100 units long on screen, so its
    // corner region is still capped by the max distance, but the offset to the left edge is halved.
    expect(getEdgeIds(yz(120, 102))).toEqual([TOP, null]);
    expect(getEdgeIds(yz(120, 102), [2, 1, 2])).toEqual([TOP, LEFT]);
  });

  it("should return the offset between the position and the grabbed edges", () => {
    const edges = getClosestEdgesAtPosition(
      [flatBox],
      yz(103, 102),
      yzIndices,
      isotropicPlaneRatio,
      MAX_DISTANCE,
    );
    // The top edge (min y = 100) is grabbed 2 voxels below it, the left edge (min z = 100) 3 voxels right of it.
    expect(edges?.[0].grabOffset).toBe(-2);
    expect(edges?.[1]?.grabOffset).toBe(-3);
  });

  it("should not grab anything far away from the box", () => {
    expect(getEdgeIds(yz(200, 60))).toBeNull();
  });
});

// A box that was drawn in the XY viewport in slice z=1024: one slice deep.
const singleSliceBox: BoundingBoxMinMaxType = { min: [100, 100, 1024], max: [200, 200, 1025] };

function getAnchoredDepthEdge(): SelectedEdge {
  // The edge that is grabbed in the YZ viewport when clicking on the single-slice box.
  return {
    boxId: 1,
    direction: "vertical",
    isMaxEdge: false,
    edgeId: 2,
    resizableDimension: 2,
    grabOffset: 0,
    anchoredExtent: [1024, 1025],
  };
}

// Simulates a drag: the edge is moved to each z position in turn (as on consecutive mouse moves).
function dragTo(
  bounds: BoundingBoxMinMaxType,
  edge: SelectedEdge,
  positions: number[],
): BoundingBoxMinMaxType {
  return positions.reduce(
    (current, position) => getBoundsResizedAlongEdge(current, edge, position),
    bounds,
  );
}

describe("getBoundsResizedAlongEdge", () => {
  it("should keep the original slice when dragging an anchored edge deeper", () => {
    const bounds = dragTo(singleSliceBox, getAnchoredDepthEdge(), [1025, 1030, 1044]);
    expect(bounds.min[2]).toBe(1024);
    expect(bounds.max[2]).toBe(1044);
  });

  it("should keep the original slice when dragging an anchored edge shallower", () => {
    const bounds = dragTo(singleSliceBox, getAnchoredDepthEdge(), [1024, 1020, 1010]);
    expect(bounds.min[2]).toBe(1010);
    expect(bounds.max[2]).toBe(1025);
  });

  it("should keep the original slice when the drag starts outside the box and goes across it", () => {
    // The user grabs the line slightly left of it (z=1021) and drags to the right.
    const bounds = dragTo(singleSliceBox, getAnchoredDepthEdge(), [1022, 1024, 1030]);
    expect(bounds.min[2]).toBe(1024);
    expect(bounds.max[2]).toBe(1030);
  });

  it("should keep the original slice when dragging deeper and then back past the box", () => {
    const bounds = dragTo(singleSliceBox, getAnchoredDepthEdge(), [1030, 1020]);
    expect(bounds.min[2]).toBe(1020);
    expect(bounds.max[2]).toBe(1025);
  });

  it("should not change the bounds while the mouse stays within the anchored extent", () => {
    for (const position of [1024, 1025]) {
      expect(getBoundsResizedAlongEdge(singleSliceBox, getAnchoredDepthEdge(), position)).toEqual(
        singleSliceBox,
      );
    }
  });

  it("should still let a regular edge flip over its opposite edge", () => {
    const box: BoundingBoxMinMaxType = { min: [0, 0, 1000], max: [100, 100, 1100] };
    const minEdge: SelectedEdge = { ...getAnchoredDepthEdge(), anchoredExtent: undefined };
    const bounds = getBoundsResizedAlongEdge(box, minEdge, 1150);
    expect(bounds.min[2]).toBe(1100);
    expect(bounds.max[2]).toBe(1150);
    expect(minEdge.isMaxEdge).toBe(true);
  });
});
