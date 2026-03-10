import type { Mapping } from "viewer/store";
import { getAdaptToTypeFunction } from "./utils";

export class NumberLikeMapWrapper<T extends number | bigint> {
  private readonly map: Map<T, T>;
  private readonly adaptKey: (key: number) => T;

  constructor(mapping: Mapping) {
    this.map = mapping as Map<T, T>;
    this.adaptKey = getAdaptToTypeFunction(mapping) as (key: number) => T;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  delete(key: number): boolean {
    return this.map.delete(this.adaptKey(key));
  }

  get(key: number): T | undefined {
    return this.map.get(this.adaptKey(key));
  }

  getAsNumber(key: number): number {
    return Number(this.get(key));
  }

  has(key: number): boolean {
    return this.map.has(this.adaptKey(key));
  }

  set(key: number, value: T): this {
    this.map.set(this.adaptKey(key), value);
    return this;
  }
}
