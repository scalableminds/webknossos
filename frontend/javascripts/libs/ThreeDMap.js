// @flow

import type { Vector3 } from "oxalis/constants";

// This is a Map datastructure for which the key
// is a Vector3.
export default class ThreeDMap<T> {
  map: Map<number, ?Map<number, ?Map<number, T>>>;

  constructor() {
    this.map = new Map();
  }

  get(vec: Vector3): ?T {
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
    // Flow doesn't understand that the access to X
    // is guaranteed to be not null due to the above code.
    // $FlowIssue[incompatible-use]
    if (this.map.get(x).get(y) == null) {
      // $FlowIssue[incompatible-use]
      this.map.get(x).set(y, new Map());
    }

    this.map
      .get(x)
      // $FlowIssue[incompatible-use]
      .get(y)
      // $FlowIssue[incompatible-use]
      .set(z, value);
  }

  // This could be extended so the key is a Vector1 | Vector2
  // if needed in the future
  delete(key: number): boolean {
    return this.map.delete(key);
  }
}
