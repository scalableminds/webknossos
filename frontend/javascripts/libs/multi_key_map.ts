type RecursiveMap<K, V> = Map<K, V | RecursiveMap<K, V>>;

export default class MultiKeyMap<E, V, K extends E[]> {
  map: RecursiveMap<E, V> = new Map<E, RecursiveMap<E, V>>();
  set(keys: K, value: V) {
    let currentMap = this.map;
    for (const [index, key] of keys.entries()) {
      if (index < keys.length - 1) {
        let foundMap = currentMap.get(key) as RecursiveMap<E, V> | undefined;
        if (foundMap == null) {
          foundMap = new Map<E, RecursiveMap<E, V>>();
          currentMap.set(key, foundMap);
        }
        currentMap = foundMap;
      } else {
        currentMap.set(key, value);
      }
    }
  }
  get(keys: K): V | undefined {
    let currentMap = this.map;
    for (const [index, key] of keys.entries()) {
      if (index < keys.length - 1) {
        const foundMap = currentMap.get(key);
        if (foundMap === undefined) {
          return undefined;
        }
        currentMap = foundMap as RecursiveMap<E, V>;
      } else {
        return currentMap.get(key) as V | undefined;
      }
    }
    throw new Error("MultiKeyMap.get called with empty key.");
  }
}
