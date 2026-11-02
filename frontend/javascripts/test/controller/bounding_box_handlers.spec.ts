import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import {
  areMinAndMaxEdgeOverlappingOnScreen,
  resolveEdgeByDragDirection,
  type SelectedEdge,
} from "viewer/controller/combinations/bounding_box_handlers";
import { describe, expect, it } from "vitest";

// A box that was drawn in the XY viewport in slice z=1024: one slice deep.
const singleSliceBox: BoundingBoxMinMaxType = { min: [100, 100, 1024], max: [200, 200, 1025] };
const isotropicPlaneRatio: Vector3 = [1, 1, 1];

function getAmbiguousDepthEdge(): SelectedEdge {
  // The edge that is grabbed in the YZ viewport when clicking on the single-slice box.
  return {
    boxId: 1,
    direction: "vertical",
    isMaxEdge: false,
    edgeId: 2,
    resizableDimension: 2,
    isAmbiguous: true,
  };
}

describe("areMinAndMaxEdgeOverlappingOnScreen", () => {
  it("should treat the edges of a single-slice box as overlapping", () => {
    expect(areMinAndMaxEdgeOverlappingOnScreen(singleSliceBox, 2, isotropicPlaneRatio, 1)).toBe(
      true,
    );
  });

  it("should not treat the edges of a wide box as overlapping", () => {
    expect(areMinAndMaxEdgeOverlappingOnScreen(singleSliceBox, 0, isotropicPlaneRatio, 1)).toBe(
      false,
    );
  });

  it("should take the zoom and the voxel size into account", () => {
    const tenSliceBox: BoundingBoxMinMaxType = { min: [0, 0, 0], max: [100, 100, 10] };
    // Zoomed in, the 10 slices are 10 / 0.5 = 20 px apart.
    expect(areMinAndMaxEdgeOverlappingOnScreen(tenSliceBox, 2, isotropicPlaneRatio, 0.5)).toBe(
      false,
    );
    // Zoomed out, they are 10 / 4 = 2.5 px apart.
    expect(areMinAndMaxEdgeOverlappingOnScreen(tenSliceBox, 2, isotropicPlaneRatio, 4)).toBe(true);
    // A z voxel that is 2.5 times as thick as an x/y voxel is rendered 2.5 times as wide.
    expect(areMinAndMaxEdgeOverlappingOnScreen(tenSliceBox, 2, [1, 1, 0.4], 4)).toBe(false);
  });
});

describe("resolveEdgeByDragDirection", () => {
  it("should pick the max edge when dragging beyond the box", () => {
    const edge = getAmbiguousDepthEdge();
    expect(resolveEdgeByDragDirection(edge, singleSliceBox, 1030)).toBe(true);
    expect(edge.isMaxEdge).toBe(true);
    expect(edge.isAmbiguous).toBe(false);
  });

  it("should pick the min edge when dragging below the box", () => {
    const edge = { ...getAmbiguousDepthEdge(), isMaxEdge: true };
    expect(resolveEdgeByDragDirection(edge, singleSliceBox, 1010)).toBe(true);
    expect(edge.isMaxEdge).toBe(false);
    expect(edge.isAmbiguous).toBe(false);
  });

  it("should stay undecided while the mouse is within the box's extent", () => {
    for (const position of [1024, 1025]) {
      const edge = getAmbiguousDepthEdge();
      expect(resolveEdgeByDragDirection(edge, singleSliceBox, position)).toBe(false);
      expect(edge.isAmbiguous).toBe(true);
    }
  });
});
