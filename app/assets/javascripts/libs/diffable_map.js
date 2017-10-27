// @flow
import _ from "lodash";

const itemsPerBatch = 10000;

class DiffableMap<K: number, V> {
  maps: Array<Map<K, V>>;
  entryCount: number;
  existsCache: Map<K, boolean>;

  constructor(optDiffableMap?: DiffableMap<K, V> | Array<[K, V]>) {
    if (optDiffableMap && optDiffableMap instanceof DiffableMap) {
      this.maps = optDiffableMap.maps.slice();
      this.existsCache = new Map(optDiffableMap.existsCache);
      this.entryCount = optDiffableMap.entryCount;
    } else {
      this.maps = [];
      this.existsCache = new Map();
      this.entryCount = 0;

      if (optDiffableMap != null) {
        for (const [key, value] of optDiffableMap) {
          this.mutableSet(key, value);
        }
      }
    }
  }

  get(key: K): V {
    let idx = 0;
    while (this.maps[idx] != null) {
      if (this.maps[idx].has(key)) {
        // $FlowFixMe
        return this.maps[idx].get(key);
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
      while (this.maps[idx] != null) {
        if (this.maps[idx].has(key)) {
          const newMap = new DiffableMap(this);
          newMap.maps[idx] = new Map(this.maps[idx]);
          newMap.maps[idx].set(key, value);
          return newMap;
        }
        idx++;
      }
      throw new Error("should not happen");
    } else {
      const isTooFull = this.entryCount / this.maps.length > itemsPerBatch;
      const nonFullMapIdx =
        isTooFull || this.maps.length === 0 ? -1 : Math.floor(Math.random() * this.maps.length);

      // todo:
      // we could save which map chunks were least recently changed and favour
      // such chunks for adding new keys.

      // let idx = 0;
      // while (this.maps[idx] != null) {
      //  if (this.maps[idx].size < itemsPerBatch) {
      //    nonFullMapIdx = idx;
      //    break;
      //  }
      //  idx++;
      // }

      // Key didn't exist. Add it.
      const newDiffableMap = new DiffableMap(this);
      newDiffableMap.existsCache.set(key, true);
      newDiffableMap.entryCount = this.entryCount + 1;
      if (nonFullMapIdx > -1) {
        newDiffableMap.maps[nonFullMapIdx] = new Map(this.maps[nonFullMapIdx]);
        newDiffableMap.maps[nonFullMapIdx].set(key, value);
        return newDiffableMap;
      } else {
        const freshMap = new Map();
        freshMap.set(key, value);
        newDiffableMap.maps.push(freshMap);
        return newDiffableMap;
      }
    }
  }

  mutableSet(key: K, value: V): void {
    if (this.existsCache.has(key)) {
      let idx = 0;
      while (this.maps[idx] != null) {
        if (this.maps[idx].has(key)) {
          this.maps[idx].set(key, value);
          return;
        }
        idx++;
      }
    } else {
      // let idx = 0;
      const isTooFull = this.entryCount / this.maps.length > itemsPerBatch;
      const nonFullMapIdx =
        isTooFull || this.maps.length === 0 ? -1 : Math.floor(Math.random() * this.maps.length);
      // let nonFullMapIdx = this.maps.length === 0 ? -1 : 0;
      // while (this.maps[idx] != null) {
      //  if (
      //    this.maps[idx].size < itemsPerBatch
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
        this.maps[nonFullMapIdx].set(key, value);
      } else {
        const freshMap = new Map();
        freshMap.set(key, value);
        this.maps.push(freshMap);
      }
    }
  }

  clone(): DiffableMap<K, V> {
    const newDiffableMap = new DiffableMap();
    newDiffableMap.maps.forEach(map => {
      newDiffableMap.maps.push(new Map(map));
    });
    return newDiffableMap;
  }

  delete(key: K): DiffableMap<K, V> {
    if (!this.existsCache.has(key)) {
      return this;
    }
    let idx = 0;
    while (this.maps[idx] != null) {
      if (this.maps[idx].has(key)) {
        const newMap = new DiffableMap(this);
        newMap.existsCache.delete(key);
        newMap.entryCount--;
        newMap.maps[idx] = new Map(this.maps[idx]);
        newMap.maps[idx].delete(key);
        return newMap;
      }
      idx++;
    }
    throw new Error("Should not happen");
  }

  map<T>(fn: (value: V) => T): Array<T> {
    const returnValue = [];
    for (const map of this.maps) {
      for (const item of map.values()) {
        returnValue.push(fn(item));
      }
    }
    return returnValue;
  }

  *entries() {
    for (const map of this.maps) {
      yield* map;
    }
  }

  *values(): Generator<V, void, void> {
    for (const map of this.maps) {
      yield* map.values();
    }
  }

  *keys(): Generator<K, void, void> {
    for (const map of this.maps) {
      yield* map.keys();
    }
  }

  size(): number {
    let size = 0;
    for (const map of this.maps) {
      size += map.size;
    }
    return size;
  }
}

export function diffDiffableMaps<K: number, V>(
  mapA: DiffableMap<K, V>,
  mapB: DiffableMap<K, V>,
): { both: Array<K>, onlyA: Array<K>, onlyB: Array<K> } {
  let idx = 0;
  const both = [];
  const onlyA = [];
  const onlyB = [];
  while (mapA.maps[idx] != null) {
    if (mapA.maps[idx] !== mapB.maps[idx]) {
      const setA = new Set(mapA.maps[idx].keys());
      const setB = new Set(mapB.maps[idx].keys());

      for (const key of setA.values()) {
        if (setB.has(key)) {
          both.push(key);
        } else {
          onlyA.push(key);
        }
      }

      for (const key of setB.values()) {
        if (!setA.has(key)) {
          onlyB.push(key);
        }
      }
      // todo: it might exist other differing maps! do not return yet
      return { both, onlyA, onlyB };
    }
    idx++;
  }
  return { both, onlyA, onlyB };
}

export default DiffableMap;
