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

  it("should handle mutable deletion correctly", () => {
    const map = new DiffableMap<number, string>([
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ]);

    // Delete an existing key
    map.mutableDelete(2);
    expect(map.has(2)).toBe(false);
    expect(map.size()).toBe(2);
    expect(map.getOrThrow(1)).toBe("one");
    expect(map.getOrThrow(3)).toBe("three");

    // Try to delete a non-existent key
    map.mutableDelete(4);
    expect(map.size()).toBe(2);
    expect(map.has(1)).toBe(true);
    expect(map.has(3)).toBe(true);
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
      objects
        .slice(0, 100)
        .map((obj, index) => [index, obj] as [number, any])
        .filter((_entry, idx) => idx % 2 === 1),
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

  it("should handle null values correctly", () => {
    const map = new DiffableMap<number, any>([
      [1, null],
      [2, "value"],
    ]);

    expect(map.has(1)).toBe(true);
    expect(map.getOrThrow(1)).toBe(null);
    expect(map.getNullable(1)).toBe(null);
    expect(map.has(3)).toBe(false);
    expect(map.getNullable(3)).toBe(undefined);
  });

  it("should correctly iterate over entries, keys and values", () => {
    const map = new DiffableMap<number, string>([
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ]);

    // Test entries
    const entries = Array.from(map.entries());
    expect(entries.length).toBe(3);
    expect(entries).toContainEqual([1, "one"]);
    expect(entries).toContainEqual([2, "two"]);
    expect(entries).toContainEqual([3, "three"]);

    // Test keys
    const keys = Array.from(map.keys());
    expect(keys.length).toBe(3);
    expect(keys).toContain(1);
    expect(keys).toContain(2);
    expect(keys).toContain(3);

    // Test values
    const values = Array.from(map.values());
    expect(values.length).toBe(3);
    expect(values).toContain("one");
    expect(values).toContain("two");
    expect(values).toContain("three");
  });

  it("should map values correctly", () => {
    const map = new DiffableMap<number, number>([
      [1, 10],
      [2, 20],
      [3, 30],
    ]);

    const doubled = map.map((v) => v * 2);
    expect(doubled).toEqual([20, 40, 60]);

    const strings = map.map((v) => `Value: ${v}`);
    expect(strings).toEqual(["Value: 10", "Value: 20", "Value: 30"]);
  });

  it("should convert to object correctly", () => {
    const map = new DiffableMap<number, string>([
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ]);

    const obj = map.toObject();
    expect(obj).toEqual({
      1: "one",
      2: "two",
      3: "three",
    });
  });

  it("should handle deletions of non-existent keys", () => {
    const map1 = new DiffableMap<number, string>([
      [1, "one"],
      [2, "two"],
    ]);

    const map2 = map1.delete(3); // Non-existent key
    expect(map2).toBe(map1); // Should return the same map instance

    expect(map2.size()).toBe(2);
    expect(map2.has(1)).toBe(true);
    expect(map2.has(2)).toBe(true);
  });

  it("should handle very large batch sizes efficiently", () => {
    const largeMap = new DiffableMap<number, number>([], 50000);

    // Add 1000 entries
    let currentMap = largeMap;
    for (let i = 0; i < 1000; i++) {
      currentMap = currentMap.set(i, i * i);
    }

    // All entries should be in a single chunk due to large batch size
    expect(currentMap.chunks.length).toBe(1);
    expect(currentMap.size()).toBe(1000);

    // Verify all entries
    for (let i = 0; i < 1000; i++) {
      expect(currentMap.getOrThrow(i)).toBe(i * i);
    }
  });

  it("should maintain separate chunks when batch size is very small", () => {
    const smallBatchMap = new DiffableMap<number, number>([], 2);

    // Add 10 entries
    let currentMap = smallBatchMap;
    for (let i = 0; i < 10; i++) {
      currentMap = currentMap.set(i, i);
    }

    // Should have multiple chunks due to small batch size
    expect(currentMap.chunks.length).toBeGreaterThan(1);
    expect(currentMap.size()).toBe(10);
  });

  it("should handle diffing when one map is empty", () => {
    const emptyMap = new DiffableMap<number, string>();
    const nonEmptyMap = new DiffableMap<number, string>([
      [1, "one"],
      [2, "two"],
    ]);

    const diffResult1 = diffDiffableMaps(emptyMap, nonEmptyMap);
    expect(diffResult1).toEqual({
      changed: [],
      onlyA: [],
      onlyB: [1, 2],
    });

    const diffResult2 = diffDiffableMaps(nonEmptyMap, emptyMap);
    expect(diffResult2).toEqual({
      changed: [],
      onlyA: [1, 2],
      onlyB: [],
    });
  });

  it("should correctly merge two DiffableMaps", () => {
    const mapA = new DiffableMap<number, string>([
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ]);

    const mapB = new DiffableMap<number, string>([
      [2, "TWO"], // Overlapping key with different value
      [3, "three"], // Overlapping key with same value
      [4, "four"], // New key
    ]);

    const merged = DiffableMap.merge(mapA, mapB);

    // Check size
    expect(merged.size()).toBe(4);

    // Check values
    expect(merged.getOrThrow(1)).toBe("one");
    expect(merged.getOrThrow(2)).toBe("TWO"); // Value from mapB should take precedence
    expect(merged.getOrThrow(3)).toBe("three");
    expect(merged.getOrThrow(4)).toBe("four");

    // The merged map should be a new instance
    expect(merged).not.toBe(mapA);
    expect(merged).not.toBe(mapB);
  });
});
