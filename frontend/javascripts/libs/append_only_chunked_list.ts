const DEFAULT_CHUNK_SIZE = 256;

/*
 * AppendOnlyChunkedList is an immutable, persistent list which is optimized
 * for appending single items. In contrast to `[...items, newItem]` (which
 * copies the entire array on every append), appending copies only the last
 * chunk plus the (small) array of chunk references. This turns building a
 * list of n items from O(n²) into roughly O(n²/chunkSize + n) total work,
 * while keeping structural sharing between versions (older versions of the
 * list stay valid, which is required for usage within the Redux store).
 *
 * All chunks except for the last one are guaranteed to be full which allows
 * for O(1) random access.
 */
export default class AppendOnlyChunkedList<T> implements NotEnumerableByObject {
  private readonly chunks: T[][];
  private readonly chunkSize: number;
  readonly length: number;

  __notEnumerableByObject: true = true;

  constructor(items: T[] = [], chunkSize: number = DEFAULT_CHUNK_SIZE) {
    this.chunkSize = chunkSize;
    this.length = items.length;
    this.chunks = [];

    for (let i = 0; i < items.length; i += chunkSize) {
      this.chunks.push(items.slice(i, i + chunkSize));
    }
  }

  private static fromChunks<T>(
    chunks: T[][],
    chunkSize: number,
    length: number,
  ): AppendOnlyChunkedList<T> {
    const newList = new AppendOnlyChunkedList<T>([], chunkSize);
    // @ts-expect-error chunks and length are readonly to the outside, but need to be initialized here.
    newList.chunks = chunks;
    // @ts-expect-error See above.
    newList.length = length;
    return newList;
  }

  append(item: T): AppendOnlyChunkedList<T> {
    const lastChunk = this.chunks[this.chunks.length - 1];

    if (lastChunk == null || lastChunk.length >= this.chunkSize) {
      return AppendOnlyChunkedList.fromChunks(
        [...this.chunks, [item]],
        this.chunkSize,
        this.length + 1,
      );
    }

    const newChunks = this.chunks.slice();
    newChunks[newChunks.length - 1] = [...lastChunk, item];
    return AppendOnlyChunkedList.fromChunks(newChunks, this.chunkSize, this.length + 1);
  }

  get(index: number): T {
    // All chunks except for the last one are always full.
    return this.chunks[Math.floor(index / this.chunkSize)][index % this.chunkSize];
  }

  *values(): Generator<T, void, void> {
    for (const chunk of this.chunks) {
      yield* chunk;
    }
  }

  [Symbol.iterator](): Generator<T, void, void> {
    return this.values();
  }

  forEach(fn: (item: T) => void): void {
    for (const item of this.values()) {
      fn(item);
    }
  }

  map<U>(fn: (item: T) => U): U[] {
    const result: U[] = new Array(this.length);
    let index = 0;

    for (const item of this.values()) {
      result[index++] = fn(item);
    }

    return result;
  }

  toArray(): T[] {
    return this.map((item) => item);
  }
}
