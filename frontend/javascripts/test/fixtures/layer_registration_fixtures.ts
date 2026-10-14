import type { Vector3 } from "viewer/constants";
import type { Landmark } from "viewer/view/layer_registration/layer_registration_helpers";

export const RED: Vector3 = [1, 0, 0];

// The landmarks get the pair ids 1, 2, … unless other pair ids are given.
export function toLandmarks(positions: Vector3[], pairIds?: Array<number | null>): Landmark[] {
  return positions.map((position, index) => ({
    pairId: pairIds != null ? pairIds[index] : index + 1,
    treeId: index + 1,
    nodeId: index + 1,
    position,
    color: RED,
  }));
}

// The corners of a tetrahedron, so that the landmarks don't lie in one plane.
export const FIXED_POSITIONS: Vector3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [0, 0, 10],
];
const MOVING_TO_FIXED_OFFSET: Vector3 = [5, -3, 2];
export const MOVING_POSITIONS = FIXED_POSITIONS.map(
  ([x, y, z]): Vector3 => [
    x - MOVING_TO_FIXED_OFFSET[0],
    y - MOVING_TO_FIXED_OFFSET[1],
    z - MOVING_TO_FIXED_OFFSET[2],
  ],
);
