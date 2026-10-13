import DiffableMap from "libs/diffable_map";
import type { APIAnnotationInfo, APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
import { getAlignmentEditBlocker } from "viewer/view/align_datasets/alignment_edit_blocker";
import {
  estimateTransformBtoA,
  getCompleteLandmarkPairs,
  getLandmarkColor,
  getLandmarkPairId,
  getLandmarkPairInfo,
  getLandmarkPairs,
  getLandmarks,
  getLandmarkTreeName,
  getMeanResidual,
  getMissingLayerNames,
  getNextLandmarkPairId,
  type Landmark,
  prepareLandmarkTreesForImport,
} from "viewer/view/align_datasets/alignment_helpers";
import { describe, expect, it } from "vitest";

const RED: Vector3 = [1, 0, 0];

// The landmarks get the pair ids 1, 2, … unless other pair ids are given.
function toLandmarks(positions: Vector3[], pairIds?: Array<number | null>): Landmark[] {
  return positions.map((position, index) => ({
    pairId: pairIds != null ? pairIds[index] : index + 1,
    treeId: index + 1,
    nodeId: index + 1,
    position,
    color: RED,
  }));
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
  it("reads the pair id from a landmark tree name", () => {
    expect(getLandmarkPairId(getLandmarkTreeName(12))).toBe(12);
    expect(getLandmarkPairId("Landmark 0")).toBeNull();
    expect(getLandmarkPairId("Landmark 5 ")).toBeNull();
    expect(getLandmarkPairId("Tree001")).toBeNull();
  });

  it("orders the landmarks by tree id and node id and reads their pair ids", () => {
    const createTree = (treeId: number, name: string, nodes: Array<[number, Vector3]>) => ({
      treeId,
      name,
      color: RED,
      nodes: new Map(nodes.map(([id, position]) => [id, { id, untransformedPosition: position }])),
    });
    const trees = new Map([
      [
        2,
        createTree(2, "Tree002", [
          [5, [3, 3, 3]],
          [4, [2, 2, 2]],
        ]),
      ],
      [1, createTree(1, "Landmark 7", [[6, [1, 1, 1]]])],
    ]) as unknown as MutableTreeMap;

    expect(getLandmarks(trees).map(({ pairId, position }) => [pairId, position])).toEqual([
      [7, [1, 1, 1]],
      [null, [2, 2, 2]],
      [null, [3, 3, 3]],
    ]);
  });

  it("prepares stored landmark trees for the import into a worker", () => {
    const createTree = (treeId: number, name: string, nodeCount = 1) => ({
      treeId,
      name,
      color: RED,
      nodes: new DiffableMap(
        Array.from({ length: nodeCount }, (_, index) => [treeId * 10 + index, { id: index }]),
      ),
    });
    const trees = new Map([
      [5, createTree(5, "Landmark 3")],
      [2, createTree(2, "Tree002")],
      [7, createTree(7, "Landmark 1")],
      [9, createTree(9, "Landmark 6", 0)],
    ]) as unknown as MutableTreeMap;

    const preparedTrees = Array.from(prepareLandmarkTreesForImport(trees).values());

    // The empty tree is left out, and the tree without a pair id gets the next free one.
    expect(preparedTrees.map((tree) => [tree.treeId, tree.name])).toEqual([
      [2, "Landmark 4"],
      [5, "Landmark 3"],
      [7, "Landmark 1"],
    ]);
    expect(preparedTrees.map((tree) => tree.color)).toEqual([
      getLandmarkColor(4),
      getLandmarkColor(3),
      getLandmarkColor(1),
    ]);
  });

  it("refuses to estimate a transform from too few complete pairs", () => {
    expect(
      estimateTransformBtoA({
        A: toLandmarks(POSITIONS_A),
        B: toLandmarks(POSITIONS_B.slice(0, 2)),
      }),
    ).toHaveProperty("errorMessage");
  });

  it("leaves landmarks without a partner out of the transform", () => {
    const landmarks = {
      A: toLandmarks([...POSITIONS_A, [100, 200, 300]], [1, 2, 3, 4, 9]),
      B: toLandmarks(POSITIONS_B),
    };
    const result = estimateTransformBtoA(landmarks);
    if (!("transform" in result)) {
      throw new Error(result.errorMessage);
    }

    for (const pair of getLandmarkPairs(landmarks, result.transform)) {
      if (pair.pairId !== 9) {
        expect(pair.residual).toBeCloseTo(0, 5);
      }
    }
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

  it("pairs landmarks by pair id and has no residual without a transform", () => {
    const pairs = getLandmarkPairs(
      {
        A: toLandmarks(POSITIONS_A, [1, 2, 4, 2]),
        B: toLandmarks(POSITIONS_B.slice(0, 3), [4, 3, null]),
      },
      null,
    );

    expect(
      pairs.map((pair) => [pair.pairId, pair.landmarks.A?.position, pair.landmarks.B?.position]),
    ).toEqual([
      [1, POSITIONS_A[0], undefined],
      [2, POSITIONS_A[1], undefined],
      [3, undefined, POSITIONS_B[1]],
      [4, POSITIONS_A[2], POSITIONS_B[0]],
      // The second landmark with pair id 2 in A and the landmark without pair id in B.
      [null, POSITIONS_A[3], undefined],
      [null, undefined, POSITIONS_B[2]],
    ]);
    expect(pairs.every((pair) => pair.residual == null)).toBe(true);
    expect(getMeanResidual(pairs)).toBeNull();
    expect(
      getCompleteLandmarkPairs({
        A: toLandmarks(POSITIONS_A, [1, 2, 4, 2]),
        B: toLandmarks(POSITIONS_B.slice(0, 3), [4, 3, null]),
      }).map((pair) => pair.pairId),
    ).toEqual([4]);
  });

  it("computes the mean residual of the pairs that have one", () => {
    const pairs = [
      { key: "1", pairId: 1, landmarks: {}, residual: 1 },
      { key: "2", pairId: 2, landmarks: {}, residual: null },
      { key: "3", pairId: 3, landmarks: {}, residual: 3 },
    ];
    expect(getMeanResidual(pairs)).toBe(2);
  });

  it("tells a worker which pairs miss a landmark on its side", () => {
    const landmarks = {
      A: toLandmarks(POSITIONS_A, [1, 2, 5, 7]),
      B: toLandmarks(POSITIONS_B.slice(0, 2), [5, 3]),
    };
    expect(getLandmarkPairInfo(landmarks, "A")).toEqual({ openPairIds: [3], otherMaxPairId: 5 });
    expect(getLandmarkPairInfo(landmarks, "B")).toEqual({
      openPairIds: [1, 2, 7],
      otherMaxPairId: 7,
    });
  });

  it("completes the lowest open pair or starts a new one", () => {
    const pairInfo = { openPairIds: [2, 4], otherMaxPairId: 6 };
    expect(getNextLandmarkPairId(new Set([1]), pairInfo)).toBe(2);
    // The pair info can be outdated: pair 2 was completed since it was sent.
    expect(getNextLandmarkPairId(new Set([1, 2]), pairInfo)).toBe(4);
    expect(getNextLandmarkPairId(new Set([1, 2, 4]), pairInfo)).toBe(7);
    expect(getNextLandmarkPairId(new Set([9]), { openPairIds: [], otherMaxPairId: 6 })).toBe(10);
    expect(getNextLandmarkPairId(new Set(), { openPairIds: [], otherMaxPairId: 0 })).toBe(1);
  });
});

describe("Alignment annotation helpers", () => {
  const createAnnotation = (overrides: Partial<APIAnnotationInfo>) =>
    ({
      owner: { id: "owner", firstName: "A", lastName: "B" },
      state: "Active",
      isLockedByOwner: false,
      ...overrides,
    }) as APIAnnotationInfo;

  it("lets only the owner work on an active, unlocked alignment", () => {
    expect(getAlignmentEditBlocker(createAnnotation({}), "owner")).toBeNull();
    expect(getAlignmentEditBlocker(createAnnotation({}), "someone else")).toBe("notOwner");
    expect(getAlignmentEditBlocker(createAnnotation({}), null)).toBe("notOwner");
    expect(getAlignmentEditBlocker(createAnnotation({ state: "Finished" }), "owner")).toBe(
      "archived",
    );
    expect(getAlignmentEditBlocker(createAnnotation({ isLockedByOwner: true }), "owner")).toBe(
      "locked",
    );
  });

  it("finds the layers of an alignment that the dataset doesn't have", () => {
    const dataset = {
      dataSource: { dataLayers: [{ name: "color_1" }, { name: "color_2" }] },
    } as APIDataset;
    expect(getMissingLayerNames(dataset, { A: "color_1", B: "color_2" })).toEqual([]);
    expect(getMissingLayerNames(dataset, { A: "color_1", B: "renamed" })).toEqual(["renamed"]);
  });
});
