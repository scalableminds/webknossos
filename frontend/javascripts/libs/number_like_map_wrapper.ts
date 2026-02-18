import type { Mapping } from "viewer/store";
import { getAdaptToTypeFunction } from "./utils";

export class NumberLikeMapWrapper<T extends number | bigint> {
  private readonly map: Map<T, T>;
  private readonly adapt: (key: number) => T;

  constructor(mapping: Mapping) {
    this.map = mapping as Map<T, T>;
    this.adapt = getAdaptToTypeFunction(mapping) as (key: number) => T;
  }

  private convertKey(key: number): T {
    // Adapt numeric keys (or values) to number or bigint depending
    // on the current mapping type.
    return this.adapt(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  delete(key: number): boolean {
    return this.map.delete(this.convertKey(key));
  }

  get(key: number): T | undefined {
    return this.map.get(this.convertKey(key));
  }

  has(key: number): boolean {
    return this.map.has(this.convertKey(key));
  }

  set(key: number, value: T): this {
    this.map.set(this.convertKey(key), value);
    return this;
  }
}
