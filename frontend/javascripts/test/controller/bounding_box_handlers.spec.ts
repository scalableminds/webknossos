import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import {
  getBoundsResizedAlongEdge,
  isThinDimensionOverlappingOnScreen,
  type SelectedEdge,
} from "viewer/controller/combinations/bounding_box_handlers";
import { describe, expect, it } from "vitest";

// A box that was drawn in the XY viewport in slice z=1024: one slice deep.
const singleSliceBox: BoundingBoxMinMaxType = { min: [100, 100, 1024], max: [200, 200, 1025] };
const isotropicPlaneRatio: Vector3 = [1, 1, 1];

function getAnchoredDepthEdge(): SelectedEdge {
  // The edge that is grabbed in the YZ viewport when clicking on the single-slice box.
  return {
    boxId: 1,
    direction: "vertical",
    isMaxEdge: false,
    edgeId: 2,
    resizableDimension: 2,
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

describe("isThinDimensionOverlappingOnScreen", () => {
  it("should treat the edges of a single-slice box as overlapping", () => {
    expect(isThinDimensionOverlappingOnScreen(singleSliceBox, 2, isotropicPlaneRatio, 1)).toBe(
      true,
    );
  });

  it("should not treat the edges of a wide box as overlapping", () => {
    expect(isThinDimensionOverlappingOnScreen(singleSliceBox, 0, isotropicPlaneRatio, 1)).toBe(
      false,
    );
  });

  it("should take the zoom and the voxel size into account", () => {
    const tenSliceBox: BoundingBoxMinMaxType = { min: [0, 0, 0], max: [100, 100, 10] };
    // Zoomed in, the 10 slices are 10 / 0.5 = 20 px apart.
    expect(isThinDimensionOverlappingOnScreen(tenSliceBox, 2, isotropicPlaneRatio, 0.5)).toBe(
      false,
    );
    // Zoomed out, they are 10 / 4 = 2.5 px apart.
    expect(isThinDimensionOverlappingOnScreen(tenSliceBox, 2, isotropicPlaneRatio, 4)).toBe(true);
    // A z voxel that is 2.5 times as thick as an x/y voxel is rendered 2.5 times as wide.
    expect(isThinDimensionOverlappingOnScreen(tenSliceBox, 2, [1, 1, 0.4], 4)).toBe(false);
  });

  it("should ignore dimensions that are not the box's thinnest one, even when zoomed far out", () => {
    // At zoomStep 20, the 100 voxels in x are only 5 px wide, but x is not the thin dimension.
    expect(isThinDimensionOverlappingOnScreen(singleSliceBox, 0, isotropicPlaneRatio, 20)).toBe(
      false,
    );
  });
});

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
