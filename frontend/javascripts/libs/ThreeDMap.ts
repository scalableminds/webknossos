import type { Vector3 } from "viewer/constants";

// This is a Map data structure for which the key
// is a Vector3.

export default class ThreeDMap<T> {
  map: Map<number, Map<number, Map<number, T> | null | undefined> | null | undefined>;

  constructor() {
    this.map = new Map();
  }

  get(vec: Vector3): T | null | undefined {
    const [x, y, z] = vec;
    const atX = this.map.get(x);

    if (atX == null) {
      return null;
    }

    const atY = atX.get(y);

    if (atY == null) {
      return null;
    }

    return atY.get(z);
  }

  set(vec: Vector3, value: T): void {
    const [x, y, z] = vec;

    if (this.map.get(x) == null) {
      this.map.set(x, new Map());
    }

    // TS doesn't understand that the access to X
    // is guaranteed to be not null due to the above code.
    // @ts-ignore
    if (this.map.get(x).get(y) == null) {
      // @ts-ignore
      this.map.get(x).set(y, new Map());
    }

    // @ts-ignore
    this.map.get(x).get(y).set(z, value);
  }

  entries(): Array<[T, Vector3]> {
    const entries: Array<[T, Vector3]> = [];
    this.map.forEach((atX, x) => {
      if (!atX) {
        return;
      }

      atX.forEach((atY, y) => {
        if (!atY) {
          return;
        }

        atY.forEach((value, z) => {
          entries.push([value, [x, y, z]]);
        });
      });
    });
    return entries;
  }

  *values(): Generator<T, void, void> {
    for (const atX of this.map.values()) {
      if (!atX) {
        continue;
      }

      for (const atY of atX.values()) {
        if (!atY) {
          continue;
        }

        for (const value of atY.values()) {
          yield value;
        }
      }
    }
  }

  // This could be extended so the key is a Vector1 | Vector2
  // if needed in the future
  delete(key: number): boolean {
    return this.map.delete(key);
  }
}
