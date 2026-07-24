import type { Mapping, NumberLike } from "viewer/store";
import { getAdaptToTypeFunction } from "./utils";

export class NumberLikeMapWrapper<T extends number | bigint> {
  private readonly map: Map<T, T>;
  private readonly adaptKey: (key: NumberLike) => T;

  constructor(mapping: Mapping) {
    this.map = mapping as Map<T, T>;
    this.adaptKey = getAdaptToTypeFunction(mapping) as (key: NumberLike) => T;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  delete(key: NumberLike): boolean {
    return this.map.delete(this.adaptKey(key));
  }

  get(key: NumberLike): T | undefined {
    return this.map.get(this.adaptKey(key));
  }

  has(key: NumberLike): boolean {
    return this.map.has(this.adaptKey(key));
  }

  set(key: NumberLike, value: T): this {
    this.map.set(this.adaptKey(key), value);
    return this;
  }
}
