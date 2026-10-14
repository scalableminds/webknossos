import DiffableMap from "libs/diffable_map";
import {
  FIXED_POSITIONS,
  MOVING_POSITIONS,
  RED,
  toLandmarks,
} from "test/fixtures/layer_registration_fixtures";
import type { APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { createAffineTransform } from "viewer/model/helpers/transformation_helpers";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
import {
  getCompleteLandmarkPairs,
  getLandmarkColor,
  getLandmarkGroupPath,
  getLandmarkPairId,
  getLandmarkPairInfo,
  getLandmarkPairs,
  getLandmarks,
  getLandmarkTreeName,
  getMeanResidual,
  getNextLandmarkPairId,
  getOverlayLayerColors,
  isHighResidual,
  prepareLandmarkTreesForImport,
} from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import { describe, expect, it } from "vitest";

describe("Layer registration landmark helpers", () => {
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

  it("pairs landmarks by pair id and has no residual without a transform", () => {
    const landmarks = {
      fixed: toLandmarks(FIXED_POSITIONS, [1, 2, 4, 2]),
      moving: toLandmarks(MOVING_POSITIONS.slice(0, 3), [4, 3, null]),
    };
    const pairs = getLandmarkPairs(landmarks, null);

    expect(
      pairs.map((pair) => [
        pair.pairId,
        pair.landmarks.fixed?.position,
        pair.landmarks.moving?.position,
      ]),
    ).toEqual([
      [1, FIXED_POSITIONS[0], undefined],
      [2, FIXED_POSITIONS[1], undefined],
      [3, undefined, MOVING_POSITIONS[1]],
      [4, FIXED_POSITIONS[2], MOVING_POSITIONS[0]],
      // The second fixed landmark with pair id 2 and the moving landmark without pair id.
      [null, FIXED_POSITIONS[3], undefined],
      [null, undefined, MOVING_POSITIONS[2]],
    ]);
    expect(pairs.every((pair) => pair.residual == null)).toBe(true);
    expect(getMeanResidual(pairs)).toBeNull();
    expect(getCompleteLandmarkPairs(landmarks).map((pair) => pair.pairId)).toEqual([4]);
  });

  it("measures the residuals in the unit of the dataset", () => {
    const voxelSizeFactor: Vector3 = [4, 4, 40];
    // A transform that shifts by one voxel along x and z.
    const shiftedMovingPositions = FIXED_POSITIONS.map(([x, y, z]): Vector3 => [x - 1, y, z - 1]);
    const transform = createAffineTransform(shiftedMovingPositions, FIXED_POSITIONS);
    const landmarks = {
      fixed: toLandmarks([[0, 0, 0]]),
      // Before the transform, this landmark is at the same position as the fixed one.
      moving: toLandmarks([[0, 0, 0]]),
    };
    const [pair] = getLandmarkPairs(landmarks, transform, voxelSizeFactor);
    expect(pair.residual).toBeCloseTo(Math.hypot(4, 40), 5);
  });

  it("shows the floating point noise of an exact fit as an error of 0", () => {
    const transform = createAffineTransform(MOVING_POSITIONS, FIXED_POSITIONS);
    const pairs = getLandmarkPairs(
      { fixed: toLandmarks(FIXED_POSITIONS), moving: toLandmarks(MOVING_POSITIONS) },
      transform,
      [1, 1, 1],
    );
    expect(pairs.map((pair) => pair.residual)).toEqual([0, 0, 0, 0]);
  });

  it("computes the mean residual of the pairs that have one", () => {
    const pairs = [
      { key: "1", pairId: 1, landmarks: {}, residual: 1 },
      { key: "2", pairId: 2, landmarks: {}, residual: null },
      { key: "3", pairId: 3, landmarks: {}, residual: 3 },
    ];
    expect(getMeanResidual(pairs)).toBe(2);
  });

  it("never treats errors below the voxel size as high", () => {
    expect(isHighResidual(0.5, 0.01, [1, 1, 1])).toBe(false);
    expect(isHighResidual(5, 2, [1, 1, 1])).toBe(true);
    expect(isHighResidual(3, 2, [1, 1, 1])).toBe(false);
  });

  it("tells a worker which pairs miss a landmark on its side", () => {
    const landmarks = {
      fixed: toLandmarks(FIXED_POSITIONS, [1, 2, 5, 7]),
      moving: toLandmarks(MOVING_POSITIONS.slice(0, 2), [5, 3]),
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

  it("stores the landmarks of each side in a group of the moving layer", () => {
    const layerNames = { fixed: "color_1", moving: "color_3" };
    expect(getLandmarkGroupPath(layerNames, "fixed")).toEqual(["color_3", "color_1 landmarks"]);
    expect(getLandmarkGroupPath(layerNames, "moving")).toEqual(["color_3", "color_3 landmarks"]);
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
});
