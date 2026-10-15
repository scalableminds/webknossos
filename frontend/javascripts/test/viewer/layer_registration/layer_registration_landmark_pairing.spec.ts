import DiffableMap from "libs/diffable_map";
import {
  FIXED_POSITIONS,
  MOVING_POSITIONS,
  RED,
  toLandmarks,
} from "test/fixtures/layer_registration_fixtures";
import type { Vector3 } from "viewer/constants";
import { createAffineTransform } from "viewer/model/helpers/transformation_helpers";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
import {
  getCompleteLandmarkPairs,
  getLandmarkColor,
  getLandmarkPairId,
  getLandmarkPairInfo,
  getLandmarkPairs,
  getNextLandmarkPairId,
  prepareLandmarkTreesForImport,
} from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import { describe, expect, it } from "vitest";

// The landmarks of a pair are connected only by the pair id in their tree names. These tests
// cover how the pair ids are read, given out and used to pair the landmarks.
describe("Layer registration landmark pairing", () => {
  it("reads the pair id only from the exact landmark tree name", () => {
    expect(getLandmarkPairId("Landmark 12")).toBe(12);
    expect(getLandmarkPairId("Landmark 0")).toBeNull();
    expect(getLandmarkPairId("Landmark 5 ")).toBeNull();
    expect(getLandmarkPairId("Copy of Landmark 5")).toBeNull();
    expect(getLandmarkPairId("Tree001")).toBeNull();
  });

  it("gives stored trees without a pair id new pair ids when importing them", () => {
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
      [4, createTree(4, "Tree004")],
      [7, createTree(7, "Landmark 1")],
      // Deleting the only node of a tree keeps the empty tree.
      [9, createTree(9, "Landmark 6", 0)],
    ]) as unknown as MutableTreeMap;

    const preparedTrees = Array.from(prepareLandmarkTreesForImport(trees).values());

    expect(preparedTrees.map((tree) => [tree.treeId, tree.name])).toEqual([
      [2, "Landmark 4"],
      [4, "Landmark 5"],
      [5, "Landmark 3"],
      [7, "Landmark 1"],
    ]);
    expect(preparedTrees.map((tree) => tree.color)).toEqual(
      [4, 5, 3, 1].map((pairId) => getLandmarkColor(pairId)),
    );
  });

  it("pairs the landmarks by pair id and lists the ones that can't be paired", () => {
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
    // The table uses the keys, so they must differ.
    expect(new Set(pairs.map((pair) => pair.key)).size).toBe(pairs.length);
    // Only complete pairs are used for the transform.
    expect(getCompleteLandmarkPairs(landmarks).map((pair) => pair.pairId)).toEqual([4]);
  });

  it("measures the error of a pair in the unit of the dataset, also for anisotropic voxels", () => {
    // A transform that shifts by one voxel along x and z.
    const shiftedMovingPositions = FIXED_POSITIONS.map(([x, y, z]): Vector3 => [x - 1, y, z - 1]);
    const transform = createAffineTransform(shiftedMovingPositions, FIXED_POSITIONS);
    const landmarks = {
      fixed: toLandmarks([[0, 0, 0]]),
      // Before the transform, this landmark is at the same position as the fixed one.
      moving: toLandmarks([[0, 0, 0]]),
    };
    const [pair] = getLandmarkPairs(landmarks, transform, [4, 4, 40]);
    expect(pair.residual).toBeCloseTo(Math.hypot(4, 40), 5);
  });

  it("lets a new landmark complete the lowest open pair, or start a new pair", () => {
    const landmarks = {
      fixed: toLandmarks(FIXED_POSITIONS, [7, 2, 5, 1]),
      moving: toLandmarks(MOVING_POSITIONS.slice(0, 2), [5, 3]),
    };
    const fixedPairInfo = getLandmarkPairInfo(landmarks, "fixed");
    const movingPairInfo = getLandmarkPairInfo(landmarks, "moving");
    expect(fixedPairInfo).toEqual({ openPairIds: [3], otherMaxPairId: 5 });
    expect(movingPairInfo).toEqual({ openPairIds: [1, 2, 7], otherMaxPairId: 7 });

    expect(getNextLandmarkPairId(new Set([5, 3]), movingPairInfo)).toBe(1);
    // The pair info can be one sync old: pair 1 was completed since it was sent.
    expect(getNextLandmarkPairId(new Set([5, 3, 1]), movingPairInfo)).toBe(2);
    expect(getNextLandmarkPairId(new Set([5, 3, 1, 2, 7]), movingPairInfo)).toBe(8);
    // This side has the highest pair id.
    expect(getNextLandmarkPairId(new Set([9]), { openPairIds: [], otherMaxPairId: 6 })).toBe(10);
    expect(getNextLandmarkPairId(new Set(), { openPairIds: [], otherMaxPairId: 0 })).toBe(1);
  });
});
