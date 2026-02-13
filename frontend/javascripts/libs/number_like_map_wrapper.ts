import type { Mapping } from "viewer/store";
import { getAdaptToTypeFunction } from "./utils";

export class NumberLikeMapWrapper<T extends number | bigint> {
  private readonly map: Map<T, T>;
  private readonly adapt: (key: number) => T;

  constructor(mapping: Mapping) {
    this.map = mapping as Map<T, T>;
    this.adapt = getAdaptToTypeFunction(mapping) as (key: number) => T;
  }

  // ---- core adaptation ----

  private k(key: number): T {
    // Adapt numeric keys (or values) to number or bigint depending
    // on the current mapping type.
    return this.adapt(key);
  }

  // ---- Map API ----

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  delete(key: number): boolean {
    return this.map.delete(this.k(key));
  }

  get(key: number): T | undefined {
    return this.map.get(this.k(key));
  }

  has(key: number): boolean {
    return this.map.has(this.k(key));
  }

  set(key: number, value: T): this {
    this.map.set(this.k(key), value);
    return this;
  }
}
