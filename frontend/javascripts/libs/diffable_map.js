// @flow

const defaultItemsPerBatch = 1000;
let idCounter = 0;
const idSymbol = Symbol("id");

// DiffableMap is an immutable key-value data structure which supports fast diffing.
// Updating a DiffableMap returns a new DiffableMap, in which case the Maps are
// derived from each other ("dependent").
// Diffing is very fast when the given Maps are dependent, since the separate chunks
// can be compared shallowly.
// The insertion order of the DiffableMap is not guaranteed.
// Stored values may be null. However, `undefined` is equal to "does not exist".

class DiffableMap<K: number, V> {
  chunks: Array<Map<K, V>>;
  entryCount: number;
  itemsPerBatch: number;

  constructor(optKeyValueArray?: ?Array<[K, V]>, itemsPerBatch?: ?number) {
    // Make the id property not enumerable so that it does not interfere with tests
    // Ava's deepEquals uses Object.getOwnProperties() to obtain all Object keys
    // Luckily "Symbols" don't count as properties
    Object.defineProperty(this, idSymbol, {
      value: idCounter++,
      writable: true,
    });
    this.chunks = [];
    this.entryCount = 0;
    this.itemsPerBatch = itemsPerBatch != null ? itemsPerBatch : defaultItemsPerBatch;

    if (optKeyValueArray != null) {
      for (const [key, value] of optKeyValueArray) {
        this.mutableSet(key, value);
      }
    }
  }

  getId() {
    // $FlowFixMe[prop-missing]
    return this[idSymbol];
  }

  setId(id: number) {
    // $FlowFixMe[prop-missing]
    this[idSymbol] = id;
  }

  get(key: K): V {
    const value = this.getNullable(key);
    if (value !== undefined) {
      return value;
    } else {
      throw new Error("Get empty");
    }
  }

  // The return type cannot be ?V since this would also include null.
  // In order to allow storing null values in this data structure,
  // the typing makes it explicit by just using undefined as a place holder for
  // "not existing".
  getNullable(key: K): V | typeof undefined {
    let idx = 0;
    while (this.chunks[idx] != null) {
      if (this.chunks[idx].has(key)) {
        return this.chunks[idx].get(key);
      }
      idx++;
    }
    return undefined;
  }

  has(key: K): boolean {
    return this.getNullable(key) !== undefined;
  }

  set(key: K, value: V): DiffableMap<K, V> {
    let idx = 0;
    while (this.chunks[idx] != null) {
      if (this.chunks[idx].has(key)) {
        const newMap = shallowCopy(this);
        newMap.chunks[idx] = new Map(this.chunks[idx]);
        newMap.chunks[idx].set(key, value);
        return newMap;
      }
      idx++;
    }

    // The key was not found in the existing chunks
    const isTooFull = this.entryCount / this.chunks.length > this.itemsPerBatch;
    const nonFullMapIdx =
      isTooFull || this.chunks.length === 0 ? -1 : Math.floor(Math.random() * this.chunks.length);

    // Key didn't exist. Add it.
    const newDiffableMap = shallowCopy(this);
    newDiffableMap.entryCount = this.entryCount + 1;
    if (nonFullMapIdx > -1) {
      newDiffableMap.chunks[nonFullMapIdx] = new Map(this.chunks[nonFullMapIdx]);
      newDiffableMap.chunks[nonFullMapIdx].set(key, value);
      return newDiffableMap;
    } else {
      const freshMap = new Map();
      freshMap.set(key, value);
      newDiffableMap.chunks.push(freshMap);
      return newDiffableMap;
    }
  }

  mutableSet(key: K, value: V): void {
    let idx = 0;
    while (this.chunks[idx] != null) {
      if (this.chunks[idx].has(key)) {
        this.chunks[idx].set(key, value);
        return;
      }
      idx++;
    }

    // The key was not found in the existing chunks
    const isTooFull = this.entryCount / this.chunks.length > this.itemsPerBatch;
    const nonFullMapIdx =
      isTooFull || this.chunks.length === 0 ? -1 : Math.floor(Math.random() * this.chunks.length);

    // Key didn't exist. Add it.
    this.entryCount++;
    if (nonFullMapIdx > -1) {
      this.chunks[nonFullMapIdx].set(key, value);
    } else {
      const freshMap = new Map();
      freshMap.set(key, value);
      this.chunks.push(freshMap);
    }
  }

  clone(): DiffableMap<K, V> {
    const newDiffableMap = new DiffableMap();
    // Clone all chunks
    this.chunks.forEach(map => {
      newDiffableMap.chunks.push(new Map(map));
    });

    // Clone other attributes
    newDiffableMap.setId(this.getId());
    newDiffableMap.entryCount = this.entryCount;
    newDiffableMap.itemsPerBatch = this.itemsPerBatch;

    return newDiffableMap;
  }

  delete(key: K): DiffableMap<K, V> {
    let idx = 0;
    while (this.chunks[idx] != null) {
      if (this.chunks[idx].has(key)) {
        const newMap = shallowCopy(this);
        newMap.entryCount--;
        newMap.chunks[idx] = new Map(this.chunks[idx]);
        newMap.chunks[idx].delete(key);
        return newMap;
      }
      idx++;
    }
    // The key was not found in the existing chunks
    return this;
  }

  map<T>(fn: (value: V) => T): Array<T> {
    const returnValue = [];
    for (const map of this.chunks) {
      for (const item of map.values()) {
        returnValue.push(fn(item));
      }
    }
    return returnValue;
  }

  *entries(): Generator<[K, V], void, void> {
    for (const map of this.chunks) {
      yield* map;
    }
  }

  *values(): Generator<V, void, void> {
    for (const map of this.chunks) {
      yield* map.values();
    }
  }

  *keys(): Generator<K, void, void> {
    for (const map of this.chunks) {
      yield* map.keys();
    }
  }

  size(): number {
    let size = 0;
    for (const map of this.chunks) {
      size += map.size;
    }
    return size;
  }

  toObject(): { [key: K]: V } {
    const result = {};
    for (const [k, v] of this.entries()) {
      result[k] = v;
    }
    return result;
  }
}

// This function should only be used internally by this module.
// It creates a new DiffableMap on the basis of another one, while
// shallowly copying the internal chunks.
// When modifying a chunk, that chunk should be manually cloned.
function shallowCopy<K: number, V>(template: DiffableMap<K, V>): DiffableMap<K, V> {
  const newMap = new DiffableMap();
  newMap.setId(template.getId());
  newMap.chunks = template.chunks.slice();
  newMap.entryCount = template.entryCount;
  newMap.itemsPerBatch = template.itemsPerBatch;
  return newMap;
}

// Given two DiffableMaps, this function returns an object holding:
// changed: An array of keys, which both Maps hold, but **which do not have the same value**
// onlyA: An array of keys, which only exists in mapA
// onlyB: An array of keys, which only exists in mapB
// Note: Unlike the Utils.diffArrays function, this function will return
// { changed: [], onlyA: [], onlyB: []}
// if mapA === mapB
export function diffDiffableMaps<K: number, V>(
  mapA: DiffableMap<K, V>,
  mapB: DiffableMap<K, V>,
): { changed: Array<K>, onlyA: Array<K>, onlyB: Array<K> } {
  // For the edge case that one of the maps is empty, we will consider them dependent, anyway
  const areDiffsDependent = mapA.getId() === mapB.getId() || mapA.size() === 0 || mapB.size() === 0;
  let idx = 0;

  const changed = [];
  const onlyA = [];
  const onlyB = [];

  while (mapA.chunks[idx] != null || mapB.chunks[idx] != null) {
    if (mapB.chunks[idx] == null) {
      // mapA has more internal chunks than mapB. Add all to onlyA.
      const map = mapA.chunks[idx];
      for (const key of map.keys()) {
        onlyA.push(key);
      }
    } else if (mapA.chunks[idx] == null) {
      // mapB has more internal chunks than mapB. Add all to onlyB.
      const map = mapB.chunks[idx];
      for (const key of map.keys()) {
        onlyB.push(key);
      }
    } else if (mapA.chunks[idx] !== mapB.chunks[idx]) {
      const currentMapA = mapA.chunks[idx];
      const currentMapB = mapB.chunks[idx];
      const setA = new Set(currentMapA.keys());
      const setB = new Set(currentMapB.keys());

      for (const key of setA.values()) {
        if (setB.has(key)) {
          if (currentMapA.get(key) !== currentMapB.get(key)) {
            changed.push(key);
          } else {
            // The key exists in both chunks, do not emit this key.
            // If we were interested in unchanged values, we could
            // aggregate these values here
          }
        } else {
          onlyA.push(key);
        }
      }

      for (const key of setB.values()) {
        if (!setA.has(key)) {
          onlyB.push(key);
        }
      }
    } else {
      // The current chunks of mapA and mapB are equal ==> empty diff
    }

    idx++;
  }

  if (!areDiffsDependent) {
    // Since, the DiffableMaps don't share the same structure, we might have
    // aggregated false-positives, meaning onlyA and onlyB can include the same
    // keys, which might or might not belong to the changed set.

    // Construct a set for fast lookup
    const setA = new Set(onlyA);
    // Intersection of onlyA and onlyB:
    const missingChangedIds = onlyB.filter(id => setA.has(id));
    const missingChangedIdSet = new Set(missingChangedIds);

    const newOnlyA = onlyA.filter(id => !missingChangedIdSet.has(id));
    const newOnlyB = onlyB.filter(id => !missingChangedIdSet.has(id));

    // Ensure that these elements are not equal before adding them to "changed"
    const newChanged = changed.concat(
      missingChangedIds.filter(id => mapA.get(id) !== mapB.get(id)),
    );

    return { changed: newChanged, onlyA: newOnlyA, onlyB: newOnlyB };
  }

  return { changed, onlyA, onlyB };
}

export default DiffableMap;
