import DiffableMap from "libs/diffable_map";
import type { APIAnnotationInfo, APIDataset, CoordinateTransformation } from "types/api_types";
import { Identity4x4, type Vector3 } from "viewer/constants";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { createAffineTransform } from "viewer/model/helpers/transformation_helpers";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
import { getLayerRegistrationEditBlocker } from "viewer/view/layer_registration/layer_registration_edit_blocker";
import {
  estimateMovingToFixedTransform,
  getActiveMovingLayerName,
  getAppliedState,
  getCompleteLandmarkPairs,
  getDataLayersWithAppliedTransforms,
  getLandmarkColor,
  getLandmarkGroupPath,
  getLandmarkPairId,
  getLandmarkPairInfo,
  getLandmarkPairs,
  getLandmarks,
  getLandmarkTreeName,
  getLayerPairTransformEstimate,
  getMeanResidual,
  getMovingLayerNames,
  getNextLandmarkPairId,
  getOverlayLayerColors,
  isTransformAppliedToDataset,
  type Landmark,
  prepareLandmarkTreesForImport,
} from "viewer/view/layer_registration/layer_registration_helpers";
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

describe("Layer registration helpers", () => {
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
      estimateMovingToFixedTransform({
        fixed: toLandmarks(POSITIONS_A),
        moving: toLandmarks(POSITIONS_B.slice(0, 2)),
      }),
    ).toHaveProperty("errorMessage");
  });

  it("leaves landmarks without a partner out of the transform", () => {
    const landmarks = {
      fixed: toLandmarks([...POSITIONS_A, [100, 200, 300]], [1, 2, 3, 4, 9]),
      moving: toLandmarks(POSITIONS_B),
    };
    const result = estimateMovingToFixedTransform(landmarks);
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
      estimateMovingToFixedTransform({
        fixed: toLandmarks(collinearPositions),
        moving: toLandmarks(collinearPositions),
      }),
    ).toHaveProperty("errorMessage");
  });

  it("estimates a transform from landmarks in a single z slice", () => {
    const fixedPositions: Vector3[] = [
      [0, 0, 7],
      [10, 0, 7],
      [0, 10, 7],
      [10, 10, 7],
    ];
    // B is rotated by 90 degrees in the xy plane and lies in another z slice.
    const movingPositions = fixedPositions.map(([x, y]): Vector3 => [-y, x, 3]);
    const landmarks = { fixed: toLandmarks(fixedPositions), moving: toLandmarks(movingPositions) };
    const result = estimateMovingToFixedTransform(landmarks);
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
    const fixedPositions: Vector3[] = [
      [1203, 4511, 7],
      [3810, 402, 7],
      [2290, 3001, 7],
      [517, 980, 7],
      [4100, 4400, 7],
    ];
    const movingPositions = fixedPositions.map(([x, y]): Vector3 => [x + 12, y - 30, 3]);
    const landmarks = { fixed: toLandmarks(fixedPositions), moving: toLandmarks(movingPositions) };
    const result = estimateMovingToFixedTransform(landmarks);
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
      fixed: toLandmarks([...POSITIONS_A, POSITIONS_A[0]]),
      moving: toLandmarks([...POSITIONS_B, POSITIONS_B[0]]),
    };
    expect(estimateMovingToFixedTransform(landmarks)).toHaveProperty("transform");
  });

  it("estimates a transform that maps the landmarks of B onto A", () => {
    const landmarks = { fixed: toLandmarks(POSITIONS_A), moving: toLandmarks(POSITIONS_B) };
    const result = estimateMovingToFixedTransform(landmarks);
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
        fixed: toLandmarks(POSITIONS_A, [1, 2, 4, 2]),
        moving: toLandmarks(POSITIONS_B.slice(0, 3), [4, 3, null]),
      },
      null,
    );

    expect(
      pairs.map((pair) => [
        pair.pairId,
        pair.landmarks.fixed?.position,
        pair.landmarks.moving?.position,
      ]),
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
        fixed: toLandmarks(POSITIONS_A, [1, 2, 4, 2]),
        moving: toLandmarks(POSITIONS_B.slice(0, 3), [4, 3, null]),
      }).map((pair) => pair.pairId),
    ).toEqual([4]);
  });

  it("measures the residuals in the unit of the dataset", () => {
    const voxelSizeFactor: Vector3 = [4, 4, 40];
    // A transform that shifts by one voxel along x and z.
    const shiftedMovingPositions = POSITIONS_A.map(([x, y, z]): Vector3 => [x - 1, y, z - 1]);
    const transform = createAffineTransform(shiftedMovingPositions, POSITIONS_A);
    const landmarks = {
      fixed: toLandmarks([[0, 0, 0]]),
      // Before the transform, this landmark is at the same position as the one of A.
      moving: toLandmarks([[0, 0, 0]]),
    };
    const [pair] = getLandmarkPairs(landmarks, transform, voxelSizeFactor);
    expect(pair.residual).toBeCloseTo(Math.hypot(4, 40), 5);
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
      fixed: toLandmarks(POSITIONS_A, [1, 2, 5, 7]),
      moving: toLandmarks(POSITIONS_B.slice(0, 2), [5, 3]),
    };
    expect(getLandmarkPairInfo(landmarks, "fixed")).toEqual({
      openPairIds: [3],
      otherMaxPairId: 5,
    });
    expect(getLandmarkPairInfo(landmarks, "moving")).toEqual({
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

describe("Layer registration annotation helpers", () => {
  const createAnnotation = (overrides: Partial<APIAnnotationInfo>) =>
    ({
      owner: { id: "owner", firstName: "A", lastName: "B" },
      state: "Active",
      isLockedByOwner: false,
      ...overrides,
    }) as APIAnnotationInfo;

  it("lets only the owner work on an active, unlocked layer registration", () => {
    expect(getLayerRegistrationEditBlocker(createAnnotation({}), "owner")).toBeNull();
    expect(getLayerRegistrationEditBlocker(createAnnotation({}), "someone else")).toBe("notOwner");
    expect(getLayerRegistrationEditBlocker(createAnnotation({}), null)).toBe("notOwner");
    expect(getLayerRegistrationEditBlocker(createAnnotation({ state: "Finished" }), "owner")).toBe(
      "archived",
    );
    expect(
      getLayerRegistrationEditBlocker(createAnnotation({ isLockedByOwner: true }), "owner"),
    ).toBe("locked");
  });

  it("colors the fixed layer green and the moving layer magenta if both are color layers", () => {
    const createDataset = (movingLayerCategory: string) =>
      ({
        dataSource: {
          dataLayers: [
            { name: "fixed", category: "color" },
            { name: "moving", category: movingLayerCategory },
          ],
        },
      }) as APIDataset;
    const layerNames = { fixed: "fixed", moving: "moving" };
    expect(getOverlayLayerColors(createDataset("color"), layerNames)).toEqual({
      fixed: [0, 255, 0],
      moving: [255, 0, 255],
    });
    expect(getOverlayLayerColors(createDataset("segmentation"), layerNames)).toBeNull();
  });

  it("recognizes whether the moving layer has the applied transform", () => {
    const transform = createAffineTransform(POSITIONS_B, POSITIONS_A);
    const fixedLayerTransforms: CoordinateTransformation[] = [
      { type: "affine", matrix: flatToNestedMatrix(Identity4x4) },
    ];
    const appliedTransforms: CoordinateTransformation[] = [
      { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrix) },
      ...fixedLayerTransforms,
    ];
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, appliedTransforms)).toBe(
      true,
    );
    expect(isTransformAppliedToDataset(transform, null, appliedTransforms)).toBe(false);
    expect(isTransformAppliedToDataset(transform, fixedLayerTransforms, null)).toBe(false);
  });

  const datasetWithLayers = (...names: string[]) =>
    ({ dataSource: { dataLayers: names.map((name) => ({ name })) } }) as APIDataset;

  it("offers all other layers of the dataset as moving layers", () => {
    const dataset = datasetWithLayers("color_1", "color_2", "color_3");
    expect(getMovingLayerNames(dataset, "color_2")).toEqual(["color_1", "color_3"]);
  });

  it("shows the requested moving layer or falls back to the first one", () => {
    const movingLayerNames = ["color_2", "color_3"];
    expect(getActiveMovingLayerName(movingLayerNames, "color_3")).toBe("color_3");
    expect(getActiveMovingLayerName(movingLayerNames, null)).toBe("color_2");
    expect(getActiveMovingLayerName(movingLayerNames, "renamed")).toBe("color_2");
    expect(getActiveMovingLayerName([], null)).toBeNull();
  });

  it("stores the landmarks of each side in a group of the moving layer", () => {
    const layerNames = { fixed: "color_1", moving: "color_3" };
    expect(getLandmarkGroupPath(layerNames, "fixed")).toEqual(["color_3", "color_1 landmarks"]);
    expect(getLandmarkGroupPath(layerNames, "moving")).toEqual(["color_3", "color_3 landmarks"]);
  });

  it("applies the transforms of the given moving layers on top of the fixed layer's transforms", () => {
    const transform = createAffineTransform(POSITIONS_B, POSITIONS_A);
    const fixedLayerTransforms: CoordinateTransformation[] = [
      { type: "affine", matrix: flatToNestedMatrix(Identity4x4) },
    ];
    const oldTransforms: CoordinateTransformation[] = [
      { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrixInv) },
    ];
    const dataLayers = [
      { name: "fixed", coordinateTransformations: fixedLayerTransforms },
      { name: "transformed", coordinateTransformations: oldTransforms },
      { name: "unchanged", coordinateTransformations: oldTransforms },
    ] as APIDataset["dataSource"]["dataLayers"];
    const [fixed, transformed, unchanged] = getDataLayersWithAppliedTransforms(
      dataLayers,
      "fixed",
      new Map([["transformed", transform]]),
    );
    expect(fixed).toBe(dataLayers[0]);
    expect(unchanged).toBe(dataLayers[2]);
    expect(transformed.coordinateTransformations).toEqual([
      { type: "affine", matrix: flatToNestedMatrix(transform.affineMatrix) },
      ...fixedLayerTransforms,
    ]);
    expect(() =>
      getDataLayersWithAppliedTransforms(dataLayers, "fixed", new Map([["renamed", transform]])),
    ).toThrow('"renamed"');
  });

  it("summarizes the estimated transform of a moving layer and whether the dataset uses it", () => {
    const tooFewPairs = getLayerPairTransformEstimate(
      { fixed: toLandmarks(POSITIONS_A.slice(0, 2)), moving: toLandmarks(POSITIONS_B.slice(0, 2)) },
      [1, 1, 1],
    );
    expect(tooFewPairs.completePairCount).toBe(2);
    expect(tooFewPairs.meanResidual).toBeNull();
    expect(getAppliedState(tooFewPairs.estimation, null, null)).toBe("notEnoughPairs");

    const estimate = getLayerPairTransformEstimate(
      { fixed: toLandmarks(POSITIONS_A), moving: toLandmarks(POSITIONS_B) },
      [1, 1, 1],
    );
    expect(estimate.completePairCount).toBe(4);
    expect(estimate.meanResidual).toBeCloseTo(0);
    expect(getAppliedState(estimate.estimation, null, null)).toBe("notApplied");
    if (!("transform" in estimate.estimation)) {
      throw new Error("Expected a transform.");
    }
    const appliedTransforms: CoordinateTransformation[] = [
      { type: "affine", matrix: flatToNestedMatrix(estimate.estimation.transform.affineMatrix) },
    ];
    expect(getAppliedState(estimate.estimation, null, appliedTransforms)).toBe("applied");
  });
});
