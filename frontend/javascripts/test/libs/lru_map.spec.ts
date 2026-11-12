import { LruMap, LruMapWithSize } from "libs/lru_map";
import { describe, expect, it } from "vitest";

function keysInOrder<V>(map: LruMap<string, V>, valueToKey: (value: V) => string): string[] {
  return [...map.values()].map(valueToKey);
}

describe("LruMap", () => {
  it("orders the entries from least to most recently used", () => {
    const map = new LruMap<string, string>();
    map.set("a", "a");
    map.set("b", "b");
    map.set("c", "c");

    map.get("a");
    map.set("b", "b");
    map.has("c");

    expect(keysInOrder(map, (value) => value)).toEqual(["c", "a", "b"]);
  });

  it("evicts the least recently used entries if there are more than maxCount", () => {
    const map = new LruMap<string, string>(2);
    map.set("a", "a");
    map.set("b", "b");
    map.get("a");
    map.set("c", "c");

    expect(map.count).toBe(2);
    expect(map.has("b")).toBe(false);
    expect(keysInOrder(map, (value) => value)).toEqual(["a", "c"]);
  });

  it("returns undefined for unknown keys", () => {
    const map = new LruMap<string, string>();
    expect(map.get("a")).toBeUndefined();
    expect(map.delete("a")).toBe(false);
  });
});

describe("LruMapWithSize", () => {
  const createMap = (maxCount?: number) =>
    new LruMapWithSize<string, number[]>((value) => value.length, maxCount);

  it("keeps the total size of the values up to date", () => {
    const map = createMap();
    map.set("a", [1, 2, 3]);
    map.set("b", [1]);
    // Overwriting replaces the size of the old value.
    map.set("a", [1, 2]);
    expect(map.totalSize).toBe(3);

    map.delete("b");
    expect(map.totalSize).toBe(2);
    map.clear();
    expect(map.totalSize).toBe(0);
    expect(map.count).toBe(0);
  });

  it("evicts the least recently used entries until the total size is small enough", () => {
    const map = createMap();
    map.set("a", [1, 2]);
    map.set("b", [1, 2]);
    map.set("c", [1, 2]);
    map.get("a");

    expect(map.evictDownTo(3)).toBe(4);
    expect(map.totalSize).toBe(2);
    expect(map.has("a")).toBe(true);
  });

  it("subtracts the size of entries evicted because of maxCount", () => {
    const map = createMap(1);
    map.set("a", [1, 2]);
    map.set("b", [1, 2, 3]);

    expect(map.has("a")).toBe(false);
    expect(map.totalSize).toBe(3);
  });
});
