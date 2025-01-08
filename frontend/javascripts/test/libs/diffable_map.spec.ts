import test from "ava";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import _ from "lodash";

function sort(arr: Array<number>) {
  return arr.sort((a, b) => a - b);
}

test("DiffableMap should be empty", (t) => {
  const emptyMap = new DiffableMap<number, number>();
  t.is(emptyMap.size(), 0);
  t.false(emptyMap.has(1));
  t.throws(() => emptyMap.getOrThrow(1));
});
test("DiffableMap should behave immutable on set/delete operations", (t) => {
  const emptyMap = new DiffableMap();
  const map1 = emptyMap.set(1, 1);
  t.is(emptyMap.size(), 0);
  t.false(emptyMap.has(1));
  t.is(map1.size(), 1);
  t.true(map1.has(1));
  t.is(map1.getOrThrow(1), 1);
  const map2 = map1.set(1, 2);
  t.is(map1.getOrThrow(1), 1);
  t.is(map2.getOrThrow(1), 2);
  const map3 = map2.delete(1);
  t.is(map2.getOrThrow(1), 2);
  t.false(map3.has(1));
});
test("DiffableMap should be clonable and mutable on clone/mutableSet", (t) => {
  const map1 = new DiffableMap().set(1, 1);
  const map2 = map1.clone();
  map2.mutableSet(1, 2);
  map2.mutableSet(2, 2);
  t.is(map2.getOrThrow(1), 2);
  t.is(map2.getOrThrow(2), 2);
  t.is(map1.getOrThrow(1), 1);
  t.false(map1.has(2));
  // Id should be the same since the internal structures look the same
  t.is(map1.getId(), map2.getId());
  t.is(map1.entryCount + 1, map2.entryCount);
  t.is(map1.itemsPerBatch, map2.itemsPerBatch);
});
test("DiffableMap should be instantiable with Array<[key, value]>", (t) => {
  const map = new DiffableMap([
    [1, 2],
    [3, 4],
  ]);
  t.is(map.getOrThrow(1), 2);
  t.is(map.getOrThrow(3), 4);
  t.is(map.size(), 2);
});
test("DiffableMap should work properly when it handles more items than the batch size", (t) => {
  const emptyMap = new DiffableMap([], 10);
  let currentMap = emptyMap;

  // Fill with [i, 2*i] values
  for (let i = 0; i < 100; i++) {
    currentMap = currentMap.set(i, 2 * i);
  }

  // Check for [i, 2*i] values
  for (let i = 0; i < 100; i++) {
    t.is(currentMap.getOrThrow(i), 2 * i);
  }

  t.is(emptyMap.size(), 0);

  // Remove each 10th key
  for (let i = 0; i < 100; i++) {
    if (i % 10 === 0) {
      currentMap = currentMap.delete(i);
    }
  }

  // Check that each 10th key was removed
  for (let i = 0; i < 100; i++) {
    if (i % 10 === 0) {
      t.false(currentMap.has(i));
    } else {
      t.is(currentMap.getOrThrow(i), 2 * i);
    }
  }
});
test("diffDiffableMaps should return an empty diff for equal DiffableMaps", (t) => {
  const emptyDiff = {
    changed: [],
    onlyA: [],
    onlyB: [],
  };
  const emptyMap1 = new DiffableMap();
  const emptyMap2 = new DiffableMap();
  const emptyMap3 = emptyMap1.clone();
  t.deepEqual(diffDiffableMaps(emptyMap1, emptyMap2), emptyDiff);
  t.deepEqual(diffDiffableMaps(emptyMap2, emptyMap1), emptyDiff);
  t.deepEqual(diffDiffableMaps(emptyMap1, emptyMap3), emptyDiff);
  t.deepEqual(diffDiffableMaps(emptyMap2, emptyMap3), emptyDiff);
});
test("diffDiffableMaps should diff DiffableMaps which are based on each other", (t) => {
  const peter = {};
  const bob = {};
  const andrew = {};
  const map1 = new DiffableMap<number, any>([
    [1, peter],
    [2, bob],
  ]);
  const map2 = map1.set(3, andrew);
  t.deepEqual(diffDiffableMaps(map1, map2), {
    changed: [],
    onlyA: [],
    onlyB: [3],
  });
});
test("diffDiffableMaps should diff large DiffableMaps which are based on each other", (t) => {
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
  t.deepEqual(sort(diff.changed), expectedDiff.changed);
  t.deepEqual(sort(diff.onlyA), expectedDiff.onlyA);
  t.deepEqual(sort(diff.onlyB), expectedDiff.onlyB);
});
test("diffDiffableMaps should diff large DiffableMaps which are not based on each other (independent)", (t) => {
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
  t.deepEqual(sort(diff.changed), expectedDiff.changed);
  t.deepEqual(sort(diff.onlyA), expectedDiff.onlyA);
  t.deepEqual(sort(diff.onlyB), expectedDiff.onlyB);
});
