/*
 * A map that keeps its entries ordered from least to most recently used (LRU), so that the least
 * recently used entries can be evicted. get and set mark an entry as most recently used. If
 * maxCount is given, set evicts the least recently used entries so that at most maxCount remain.
 */
export class LruMap<K, V> {
  // A JavaScript Map iterates in insertion order. Deleting and re-inserting an entry on every use
  // therefore keeps the least recently used entry first.
  private readonly entries = new Map<K, V>();
  private readonly maxCount: number;

  constructor(maxCount: number = Number.POSITIVE_INFINITY) {
    this.maxCount = maxCount;
  }

  get count(): number {
    return this.entries.size;
  }

  // Doesn't change the order.
  has(key: K): boolean {
    return this.entries.has(key);
  }

  // Returns undefined for unknown keys.
  get(key: K): V | undefined {
    if (!this.entries.has(key)) {
      return undefined;
    }
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.delete(key);
    this.entries.set(key, value);
    this.onAdd(value);
    this.evictWhile(() => this.count > this.maxCount);
  }

  delete(key: K): boolean {
    if (!this.entries.has(key)) {
      return false;
    }
    this.onRemove(this.entries.get(key) as V);
    return this.entries.delete(key);
  }

  clear(): void {
    for (const key of this.entries.keys()) {
      this.delete(key);
    }
  }

  // From least to most recently used. Doesn't change the order.
  values(): IterableIterator<V> {
    return this.entries.values();
  }

  // Deletes the least recently used entries as long as shouldEvict returns true.
  protected evictWhile(shouldEvict: () => boolean): void {
    for (const key of this.entries.keys()) {
      if (!shouldEvict()) {
        return;
      }
      this.delete(key);
    }
  }

  // Called for every value that is added or removed, so that subclasses can keep track of them.
  protected onAdd(_value: V): void {}
  protected onRemove(_value: V): void {}
}

/*
 * An LruMap that also sums up a size per value, e.g., its byte count, so that the least recently
 * used entries can be evicted until the total size is small enough.
 */
export class LruMapWithSize<K, V> extends LruMap<K, V> {
  private size = 0;
  private readonly getSize: (value: V) => number;

  constructor(getSize: (value: V) => number, maxCount?: number) {
    super(maxCount);
    this.getSize = getSize;
  }

  get totalSize(): number {
    return this.size;
  }

  // Removes the least recently used entries until the total size is at most maxSize. Returns the
  // freed size.
  evictDownTo(maxSize: number): number {
    const sizeBefore = this.size;
    this.evictWhile(() => this.size > maxSize);
    return sizeBefore - this.size;
  }

  protected onAdd(value: V): void {
    this.size += this.getSize(value);
  }

  protected onRemove(value: V): void {
    this.size -= this.getSize(value);
  }
}
