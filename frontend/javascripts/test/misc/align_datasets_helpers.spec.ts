import type { Vector3 } from "viewer/constants";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
import {
  estimateTransformBtoA,
  getLandmarkPairs,
  getLandmarks,
  type Landmark,
} from "viewer/view/align_datasets/alignment_helpers";
import { describe, expect, it } from "vitest";

const RED: Vector3 = [1, 0, 0];

function toLandmarks(positions: Vector3[]): Landmark[] {
  return positions.map((position) => ({ position, color: RED }));
}

// The corners of a tetrahedron, so that the landmarks don't lie in one plane.
const POSITIONS_A: Vector3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [0, 0, 10],
];
const OFFSET_B_TO_A: Vector3 = [5, -3, 2];
const POSITIONS_B = POSITIONS_A.map(
  ([x, y, z]): Vector3 => [x - OFFSET_B_TO_A[0], y - OFFSET_B_TO_A[1], z - OFFSET_B_TO_A[2]],
);

describe("Dataset alignment helpers", () => {
  it("orders the landmarks by tree id and node id", () => {
    const createTree = (treeId: number, nodes: Array<[number, Vector3]>) => ({
      treeId,
      color: RED,
      nodes: new Map(nodes.map(([id, position]) => [id, { id, untransformedPosition: position }])),
    });
    const trees = new Map([
      [
        2,
        createTree(2, [
          [5, [3, 3, 3]],
          [4, [2, 2, 2]],
        ]),
      ],
      [1, createTree(1, [[6, [1, 1, 1]]])],
    ]) as unknown as MutableTreeMap;

    expect(getLandmarks(trees).map((landmark) => landmark.position)).toEqual([
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
    ]);
  });

  it("refuses to estimate a transform from too few or unpaired landmarks", () => {
    expect(
      estimateTransformBtoA({
        A: toLandmarks(POSITIONS_A.slice(0, 2)),
        B: toLandmarks(POSITIONS_B.slice(0, 2)),
      }),
    ).toHaveProperty("errorMessage");
    expect(
      estimateTransformBtoA({ A: toLandmarks(POSITIONS_A), B: toLandmarks(POSITIONS_B.slice(1)) }),
    ).toHaveProperty("errorMessage");
  });

  it("refuses to estimate a transform from landmarks on one line", () => {
    const collinearPositions: Vector3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ];
    expect(
      estimateTransformBtoA({
        A: toLandmarks(collinearPositions),
        B: toLandmarks(collinearPositions),
      }),
    ).toHaveProperty("errorMessage");
  });

  it("estimates a transform from landmarks in a single z slice", () => {
    const positionsA: Vector3[] = [
      [0, 0, 7],
      [10, 0, 7],
      [0, 10, 7],
      [10, 10, 7],
    ];
    // B is rotated by 90 degrees in the xy plane and lies in another z slice.
    const positionsB = positionsA.map(([x, y]): Vector3 => [-y, x, 3]);
    const landmarks = { A: toLandmarks(positionsA), B: toLandmarks(positionsB) };
    const result = estimateTransformBtoA(landmarks);
    if (!("transform" in result)) {
      throw new Error(result.errorMessage);
    }

    expect(result.usedCopiesInNextSlice).toBe(true);
    for (const pair of getLandmarkPairs(landmarks, result.transform)) {
      expect(pair.residual).toBeCloseTo(0, 5);
    }
  });

  it("estimates a transform from realistic landmarks in a single z slice", () => {
    // With these coordinates, the affine solver returns huge values instead of throwing.
    const positionsA: Vector3[] = [
      [1203, 4511, 7],
      [3810, 402, 7],
      [2290, 3001, 7],
      [517, 980, 7],
      [4100, 4400, 7],
    ];
    const positionsB = positionsA.map(([x, y]): Vector3 => [x + 12, y - 30, 3]);
    const landmarks = { A: toLandmarks(positionsA), B: toLandmarks(positionsB) };
    const result = estimateTransformBtoA(landmarks);
    if (!("transform" in result)) {
      throw new Error(result.errorMessage);
    }

    expect(result.usedCopiesInNextSlice).toBe(true);
    for (const pair of getLandmarkPairs(landmarks, result.transform)) {
      expect(pair.residual).toBeCloseTo(0, 3);
    }
  });

  it("accepts two landmarks at the same position", () => {
    const landmarks = {
      A: toLandmarks([...POSITIONS_A, POSITIONS_A[0]]),
      B: toLandmarks([...POSITIONS_B, POSITIONS_B[0]]),
    };
    expect(estimateTransformBtoA(landmarks)).toHaveProperty("transform");
  });

  it("estimates a transform that maps the landmarks of B onto A", () => {
    const landmarks = { A: toLandmarks(POSITIONS_A), B: toLandmarks(POSITIONS_B) };
    const result = estimateTransformBtoA(landmarks);
    if (!("transform" in result)) {
      throw new Error(result.errorMessage);
    }

    expect(result.usedCopiesInNextSlice).toBe(false);
    const pairs = getLandmarkPairs(landmarks, result.transform);
    expect(pairs).toHaveLength(4);
    for (const pair of pairs) {
      expect(pair.residual).toBeCloseTo(0, 5);
    }
  });

  it("pairs landmarks by order and has no residual without a transform", () => {
    const pairs = getLandmarkPairs(
      { A: toLandmarks(POSITIONS_A), B: toLandmarks(POSITIONS_B.slice(0, 2)) },
      null,
    );
    expect(pairs).toHaveLength(4);
    expect(pairs[1].landmarks.B?.position).toEqual(POSITIONS_B[1]);
    expect(pairs[3].landmarks.B).toBeUndefined();
    expect(pairs.every((pair) => pair.residual == null)).toBe(true);
  });
});
