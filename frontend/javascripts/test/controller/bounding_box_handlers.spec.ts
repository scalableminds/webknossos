import type { BoundingBoxMinMaxType } from "types/bounding_box";
import {
  getBoundsResizedAlongEdge,
  type SelectedEdge,
} from "viewer/controller/combinations/bounding_box_handlers";
import { describe, expect, it } from "vitest";

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
