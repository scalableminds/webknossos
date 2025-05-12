const defaultItemsPerBatch = 1000;
let idCounter = 0;
const idSymbol = Symbol("id");

/**
 * DiffableMap is an immutable key-value data structure which supports fast diffing.
 *
 * Key features:
 * - Updating a DiffableMap returns a new DiffableMap, in which Maps are derived from each other ("dependent")
 * - Diffing is very fast when Maps are dependent, since chunks can be compared shallowly
 * - The insertion order is not guaranteed
 * - Stored values may be null
 * - Be careful with `undefined` - it's interpreted as "does not exist" but can still appear during enumeration
 * - Internally uses multiple Map chunks for efficient storage and comparison
 *
 * @template K The key type (must extend number)
 * @template V The value type for each map entry
 */
class DiffableMap<K extends number, V> {
  /** Internal array of Map chunks for storing data */
  chunks: Array<Map<K, V>>;
  /** Total number of entries across all chunks */
  entryCount: number;
  /** Maximum number of items per chunk before creating a new chunk */
  itemsPerBatch: number;

  // @ts-expect-error: Property '[idSymbol]' has no initializer and is not definitely assigned in the constructor.ts(2564)
  private [idSymbol]: number;

  /**
   * Creates a new DiffableMap instance
   *
   * @param optKeyValueArray Optional array of key-value pairs to initialize the map
   * @param itemsPerBatch Optional number of items per chunk (defaults to 1000)
   */
  constructor(
    optKeyValueArray?: Array<[K, V]> | null | undefined,
    itemsPerBatch: number = defaultItemsPerBatch,
  ) {
    // Make the id property not enumerable so that it does not interfere with tests
    // Ava's deepEquals uses Object.getOwnProperties() to obtain all Object keys
    // Luckily "Symbols" don't count as properties
    Object.defineProperty(this, idSymbol, {
      value: idCounter++,
      writable: true,
    });
    this.chunks = [];
    this.entryCount = 0;
    this.itemsPerBatch = itemsPerBatch;

    if (optKeyValueArray != null) {
      for (const [key, value] of optKeyValueArray) {
        this.mutableSet(key, value);
      }
    }
  }

  /**
   * Returns the unique identifier of this DiffableMap instance
   * Used internally for diffing to determine if two maps are derived from each other
   *
   * @returns The map's unique ID
   */
  getId(): number {
    return this[idSymbol];
  }

  /**
   * Sets the unique identifier of this DiffableMap instance
   * Used internally when creating derived maps
   *
   * @param id The ID to set
   */
  setId(id: number): void {
    this[idSymbol] = id;
  }

  /**
   * Gets a value by key, throwing an error if the key doesn't exist
   *
   * @param key The key to look up
   * @returns The value associated with the key
   * @throws Error if the key doesn't exist in the map
   */
  getOrThrow(key: K): V {
    const value = this.getNullable(key);

    if (value !== undefined) {
      return value;
    } else {
      throw new Error(`Key '${key}' does not exist in diffable map.`);
    }
  }

  /**
   * Gets a value by key, returning undefined if the key doesn't exist
   * Note: This allows storing null values in the map, which are distinct from "not existing"
   *
   * @param key The key to look up
   * @returns The value associated with the key, or undefined if the key doesn't exist
   */
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

  /**
   * Checks if a key exists in the map
   *
   * @param key The key to check
   * @returns True if the key exists, false otherwise
   */
  has(key: K): boolean {
    return this.getNullable(key) !== undefined;
  }

  /**
   * Creates a new DiffableMap with the specified key-value pair added or updated
   * Does not modify the original map (immutable operation)
   *
   * @param key The key to set
   * @param value The value to associate with the key
   * @returns A new DiffableMap instance with the updated key-value pair
   */
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

  /**
   * Adds or updates a key-value pair in the current map instance
   * Modifies the original map (mutable operation)
   *
   * @param key The key to set
   * @param value The value to associate with the key
   */
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

  /**
   * Creates a deep copy of this DiffableMap
   * The returned map has the same ID as the original, enabling fast diffing
   *
   * @returns A new DiffableMap instance with the same contents and ID
   */
  clone(): DiffableMap<K, V> {
    const newDiffableMap = new DiffableMap<K, V>();
    // Clone all chunks
    this.chunks.forEach((map) => {
      newDiffableMap.chunks.push(new Map(map));
    });
    // Clone other attributes
    newDiffableMap.setId(this.getId());
    newDiffableMap.entryCount = this.entryCount;
    newDiffableMap.itemsPerBatch = this.itemsPerBatch;
    return newDiffableMap;
  }

  /**
   * Creates a new DiffableMap with the specified key removed
   * Does not modify the original map (immutable operation)
   * If the key doesn't exist, returns the original map
   *
   * @param key The key to delete
   * @returns A new DiffableMap instance with the key removed
   */
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

  /**
   * Maps over all values in the DiffableMap and applies a transformation function
   *
   * @param fn The transformation function to apply to each value
   * @returns An array of transformed values
   */
  map<T>(fn: (value: V) => T): Array<T> {
    const returnValue = [];

    for (const map of this.chunks) {
      for (const item of map.values()) {
        returnValue.push(fn(item));
      }
    }

    return returnValue;
  }

  /**
   * Returns an iterator over all key-value pairs in the DiffableMap
   *
   * @returns A generator yielding key-value pairs as [key, value] tuples
   */
  *entries(): Generator<[K, V], void, undefined> {
    for (const map of this.chunks) {
      yield* map;
    }
  }

  /**
   * Returns an iterator over all values in the DiffableMap
   *
   * @returns A generator yielding all values
   */
  *values(): Generator<V, void, undefined> {
    for (const map of this.chunks) {
      yield* map.values();
    }
  }

  /**
   * Returns an iterator over all keys in the DiffableMap
   *
   * @returns A generator yielding all keys
   */
  *keys(): Generator<K, void, undefined> {
    for (const map of this.chunks) {
      yield* map.keys();
    }
  }

  /**
   * Returns the total number of key-value pairs in the DiffableMap
   *
   * @returns The number of entries
   */
  size(): number {
    let size = 0;

    for (const map of this.chunks) {
      size += map.size;
    }

    return size;
  }

  /**
   * Converts the DiffableMap to a plain JavaScript object
   *
   * @returns A record object with the same key-value pairs
   */
  toObject(): Record<K, V> {
    const result = {} as Record<K, V>;

    for (const [k, v] of this.entries()) {
      result[k] = v;
    }

    return result;
  }
}

/**
 * Internal helper function to create a shallow copy of a DiffableMap
 * Creates a new DiffableMap that shares the same ID and references the same chunks
 * Used by immutable operations when creating a new derived map
 *
 * @param template The source DiffableMap to copy
 * @returns A new DiffableMap with references to the same chunks
 * @private
 */
function shallowCopy<K extends number, V>(template: DiffableMap<K, V>): DiffableMap<K, V> {
  const newMap = new DiffableMap();
  newMap.setId(template.getId());
  newMap.chunks = template.chunks.slice();
  newMap.entryCount = template.entryCount;
  newMap.itemsPerBatch = template.itemsPerBatch;
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'DiffableMap<number, unknown>' is not assigna... Remove this comment to see the full error message
  return newMap;
}

/**
 * Calculates the difference between two DiffableMap instances
 * Performance is optimized when maps are derived from each other ("dependent")
 *
 * @param mapA First DiffableMap to compare
 * @param mapB Second DiffableMap to compare
 * @returns An object with three arrays:
 *   - changed: Keys present in both maps with different values
 *   - onlyA: Keys present only in mapA
 *   - onlyB: Keys present only in mapB
 *
 * Note: Unlike the Utils.diffArrays function, this function will return
 * { changed: [], onlyA: [], onlyB: []}
 * if mapA === mapB
 */
export function diffDiffableMaps<K extends number, V>(
  mapA: DiffableMap<K, V>,
  mapB: DiffableMap<K, V>,
): {
  changed: Array<K>;
  onlyA: Array<K>;
  onlyB: Array<K>;
} {
  // For the edge case that one of the maps is empty, we will consider them dependent, anyway
  const areDiffsDependent = mapA.getId() === mapB.getId() || mapA.size() === 0 || mapB.size() === 0;
  let idx = 0;
  const changed = [];
  const onlyA = [];
  const onlyB = [];

  // Compare the chunks of mapA and mapB by identity. For independent
  // maps, all chunks will be identified as "different". This will
  // be fixed later (below this while loop).
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
    const missingChangedIds = onlyB.filter((id) => setA.has(id));
    const missingChangedIdSet = new Set(missingChangedIds);
    const newOnlyA = onlyA.filter((id) => !missingChangedIdSet.has(id));
    const newOnlyB = onlyB.filter((id) => !missingChangedIdSet.has(id));
    // Ensure that these elements are not equal before adding them to "changed"
    const newChanged = changed.concat(
      missingChangedIds.filter((id) => mapA.getOrThrow(id) !== mapB.getOrThrow(id)),
    );
    return {
      changed: newChanged,
      onlyA: newOnlyA,
      onlyB: newOnlyB,
    };
  }

  return {
    changed,
    onlyA,
    onlyB,
  };
}
export default DiffableMap;
