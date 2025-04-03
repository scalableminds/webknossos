import _ from "lodash";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import { describe, it, expect } from "vitest";

function sort(arr: Array<number>) {
  return arr.sort((a, b) => a - b);
}

describe("DiffableMap", () => {
  it("should be empty", () => {
    const emptyMap = new DiffableMap<number, number>();
    expect(emptyMap.size()).toBe(0);
    expect(emptyMap.has(1)).toBe(false);
    expect(() => emptyMap.getOrThrow(1)).toThrow();
  });

  it("should behave immutable on set/delete operations", () => {
    const emptyMap = new DiffableMap();
    const map1 = emptyMap.set(1, 1);
    expect(emptyMap.size()).toBe(0);
    expect(emptyMap.has(1)).toBe(false);
    expect(map1.size()).toBe(1);
    expect(map1.has(1)).toBe(true);
    expect(map1.getOrThrow(1)).toBe(1);
    const map2 = map1.set(1, 2);
    expect(map1.getOrThrow(1)).toBe(1);
    expect(map2.getOrThrow(1)).toBe(2);
    const map3 = map2.delete(1);
    expect(map2.getOrThrow(1)).toBe(2);
    expect(map3.has(1)).toBe(false);
  });

  it("should be clonable and mutable on clone/mutableSet", () => {
    const map1 = new DiffableMap().set(1, 1);
    const map2 = map1.clone();
    map2.mutableSet(1, 2);
    map2.mutableSet(2, 2);
    expect(map2.getOrThrow(1)).toBe(2);
    expect(map2.getOrThrow(2)).toBe(2);
    expect(map1.getOrThrow(1)).toBe(1);
    expect(map1.has(2)).toBe(false);
    // Id should be the same since the internal structures look the same
    expect(map1.getId()).toBe(map2.getId());
    expect(map1.entryCount + 1).toBe(map2.entryCount);
    expect(map1.itemsPerBatch).toBe(map2.itemsPerBatch);
  });

  it("should be instantiable with Array<[key, value]>", () => {
    const map = new DiffableMap([
      [1, 2],
      [3, 4],
    ]);
    expect(map.getOrThrow(1)).toBe(2);
    expect(map.getOrThrow(3)).toBe(4);
    expect(map.size()).toBe(2);
  });

  it("should work properly when it handles more items than the batch size", () => {
    const emptyMap = new DiffableMap([], 10);
    let currentMap = emptyMap;

    // Fill with [i, 2*i] values
    for (let i = 0; i < 100; i++) {
      currentMap = currentMap.set(i, 2 * i);
    }

    // Check for [i, 2*i] values
    for (let i = 0; i < 100; i++) {
      expect(currentMap.getOrThrow(i)).toBe(2 * i);
    }

    expect(emptyMap.size()).toBe(0);

    // Remove each 10th key
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        currentMap = currentMap.delete(i);
      }
    }

    // Check that each 10th key was removed
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        expect(currentMap.has(i)).toBe(false);
      } else {
        expect(currentMap.getOrThrow(i)).toBe(2 * i);
      }
    }
  });

  it("diffDiffableMaps should return an empty diff for equal DiffableMaps", () => {
    const emptyDiff = {
      changed: [],
      onlyA: [],
      onlyB: [],
    };
    const emptyMap1 = new DiffableMap();
    const emptyMap2 = new DiffableMap();
    const emptyMap3 = emptyMap1.clone();
    expect(diffDiffableMaps(emptyMap1, emptyMap2)).toEqual(emptyDiff);
    expect(diffDiffableMaps(emptyMap2, emptyMap1)).toEqual(emptyDiff);
    expect(diffDiffableMaps(emptyMap1, emptyMap3)).toEqual(emptyDiff);
    expect(diffDiffableMaps(emptyMap2, emptyMap3)).toEqual(emptyDiff);
  });

  it("diffDiffableMaps should diff DiffableMaps which are based on each other", () => {
    const peter = {};
    const bob = {};
    const andrew = {};
    const map1 = new DiffableMap<number, any>([
      [1, peter],
      [2, bob],
    ]);
    const map2 = map1.set(3, andrew);
    expect(diffDiffableMaps(map1, map2)).toEqual({
      changed: [],
      onlyA: [],
      onlyB: [3],
    });
  });

  it("diffDiffableMaps should diff large DiffableMaps which are based on each other", () => {
    const objects = [];

    for (let i = 0; i < 105; i++) {
      objects.push({});
    }

    // Load the first 100 objects into map1
    const map1 = new DiffableMap<number, any>(
      objects.slice(0, 100).map((obj, index) => [index, obj]),
      10,
    );
    let map2 = map1;

    // Delete even keys from map2
    for (const key of map1.keys()) {
      if (key % 2 === 0) {
        map2 = map2.delete(key);
      }
    }

    // Add the last five objects to map2
    objects.slice(-5).forEach((obj, idx) => {
      map2 = map2.set(idx + 100, obj);
    });
    // Overwrite the 50th key
    map2 = map2.set(51, null);
    const diff = diffDiffableMaps(map1, map2);
    const expectedDiff = {
      changed: [51],
      onlyA: _.range(100).filter((idx) => idx % 2 === 0),
      onlyB: _.range(100, 105),
    };
    expect(sort(diff.changed)).toEqual(expectedDiff.changed);
    expect(sort(diff.onlyA)).toEqual(expectedDiff.onlyA);
    expect(sort(diff.onlyB)).toEqual(expectedDiff.onlyB);
  });

  it("diffDiffableMaps should diff large DiffableMaps which are not based on each other (independent)", () => {
    const objects = [];

    for (let i = 0; i < 105; i++) {
      objects.push({});
    }

    // Load the first, uneven 100 objects into map1 and add a 111th key
    const map1 = new DiffableMap<number, any>(
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{}[][]' is not assignable to par... Remove this comment to see the full error message
      objects
        .slice(0, 100)
        .map((obj, index) => [index, obj])
        // @ts-expect-error ts-migrate(2362) FIXME: The left-hand side of an arithmetic operation must... Remove this comment to see the full error message
        .filter(([idx]) => idx % 2 === 1),
      10,
    ).set(110, {});
    // Load the first 105 objects into map2 and overwrite the 52th key
    const map2 = new DiffableMap<number, any>(
      objects.slice(0, 105).map((obj, index) => [index, obj]),
      10,
    ).set(51, null);
    const diff = diffDiffableMaps(map1, map2);
    const expectedDiff = {
      changed: [51],
      onlyA: [110],
      onlyB: _.range(0, 105).filter((idx) => idx % 2 === 0 || idx > 100),
    };
    expect(sort(diff.changed)).toEqual(expectedDiff.changed);
    expect(sort(diff.onlyA)).toEqual(expectedDiff.onlyA);
    expect(sort(diff.onlyB)).toEqual(expectedDiff.onlyB);
  });
});
