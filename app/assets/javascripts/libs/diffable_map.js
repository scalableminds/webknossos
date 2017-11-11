// @flow
// import Utils from "libs/utils";

const defaultItemsPerBatch = 10000;
let idCounter = 0;

// Some properties:
// Insertion order is not guaranteed

class DiffableMap<K: number, V> {
  id: number;
  chunks: Array<Map<K, V>>;
  entryCount: number;
  existsCache: Map<K, boolean>;
  itemsPerBatch: number;

  constructor(optKeyValueArray?: ?Array<[K, V]>, itemsPerBatch: number = defaultItemsPerBatch) {
    // Make the id property not enumerable so that it does not interfere with tests
    Object.defineProperty(this, "id", { value: idCounter++, writable: true });
    // this.id = idCounter++;
    this.chunks = [];
    this.existsCache = new Map();
    this.entryCount = 0;
    this.itemsPerBatch = itemsPerBatch;

    if (optKeyValueArray != null) {
      for (const [key, value] of optKeyValueArray) {
        this.mutableSet(key, value);
      }
    }
  }

  get(key: K): V {
    let idx = 0;
    while (this.chunks[idx] != null) {
      if (this.chunks[idx].has(key)) {
        // $FlowFixMe
        return this.chunks[idx].get(key);
      }
      idx++;
    }
    throw new Error("Get empty");
  }

  has(key: K): boolean {
    try {
      this.get(key);
      return true;
    } catch (exception) {
      return false;
    }
  }

  set(key: K, value: V): DiffableMap<K, V> {
    if (this.existsCache.has(key)) {
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
      throw new Error("should not happen");
    } else {
      const isTooFull = this.entryCount / this.chunks.length > this.itemsPerBatch;
      const nonFullMapIdx =
        isTooFull || this.chunks.length === 0 ? -1 : Math.floor(Math.random() * this.chunks.length);

      // todo:
      // we could save which map chunks were least recently changed and favour
      // such chunks for adding new keys.

      // let idx = 0;
      // while (this.chunks[idx] != null) {
      //  if (this.chunks[idx].size < this.itemsPerBatch) {
      //    nonFullMapIdx = idx;
      //    break;
      //  }
      //  idx++;
      // }

      // Key didn't exist. Add it.
      const newDiffableMap = shallowCopy(this);
      newDiffableMap.existsCache.set(key, true);
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
  }

  mutableSet(key: K, value: V): void {
    if (this.existsCache.has(key)) {
      let idx = 0;
      while (this.chunks[idx] != null) {
        if (this.chunks[idx].has(key)) {
          this.chunks[idx].set(key, value);
          return;
        }
        idx++;
      }
    } else {
      // let idx = 0;
      const isTooFull = this.entryCount / this.chunks.length > this.itemsPerBatch;
      const nonFullMapIdx =
        isTooFull || this.chunks.length === 0 ? -1 : Math.floor(Math.random() * this.chunks.length);
      // let nonFullMapIdx = this.chunks.length === 0 ? -1 : 0;
      // while (this.chunks[idx] != null) {
      //  if (
      //    this.chunks[idx].size < this.itemsPerBatch
      //  ) {
      //    nonFullMapIdx = idx;
      //    break;
      //  }
      //  idx++;
      // }
      // Key didn't exist. Add it.
      this.existsCache.set(key, true);
      this.entryCount++;
      if (nonFullMapIdx > -1) {
        this.chunks[nonFullMapIdx].set(key, value);
      } else {
        const freshMap = new Map();
        freshMap.set(key, value);
        this.chunks.push(freshMap);
      }
    }
  }

  clone(): DiffableMap<K, V> {
    const newDiffableMap = new DiffableMap();
    this.chunks.forEach(map => {
      newDiffableMap.chunks.push(new Map(map));
    });
    return newDiffableMap;
  }

  delete(key: K): DiffableMap<K, V> {
    if (!this.existsCache.has(key)) {
      return this;
    }
    let idx = 0;
    while (this.chunks[idx] != null) {
      if (this.chunks[idx].has(key)) {
        const newMap = shallowCopy(this);
        newMap.existsCache.delete(key);
        newMap.entryCount--;
        newMap.chunks[idx] = new Map(this.chunks[idx]);
        newMap.chunks[idx].delete(key);
        return newMap;
      }
      idx++;
    }
    throw new Error("Should not happen");
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
// When modifying the chunks, each chunk should be manually cloned.
// The existsCache is safely cloned.
function shallowCopy<K: number, V>(template: DiffableMap<K, V>): DiffableMap<K, V> {
  const newMap = new DiffableMap();
  newMap.id = template.id;
  newMap.chunks = template.chunks.slice();
  newMap.existsCache = new Map(template.existsCache);
  newMap.entryCount = template.entryCount;
  newMap.itemsPerBatch = template.itemsPerBatch;
  return newMap;
}

// Given two Diffablechunks, this function returns an object holding:
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
  const areDiffsDependent = mapA.id === mapB.id || mapA.size() === 0 || mapB.size() === 0;
  if (!areDiffsDependent) {
    console.warn("Two independent DiffableMaps are diffed. This should normally not happen");
  }
  let idx = 0;

  const changed = [];
  const onlyA = [];
  const onlyB = [];

  // TODO: this approach will break if the maps entries of the two DiffableMaps are not
  // in "sync". E.g., if one map array is shifted, it will break.

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

    // Ensure that these elements are not equal before addng them to "changed"
    const newChanged = changed.concat(
      missingChangedIds.filter(id => mapA.get(id) !== mapB.get(id)),
    );

    return { changed: newChanged, onlyA: newOnlyA, onlyB: newOnlyB };
  }

  return { changed, onlyA, onlyB };
}

export default DiffableMap;
