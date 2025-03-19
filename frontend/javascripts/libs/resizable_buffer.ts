const GROW_MULTIPLIER = 1.3;
type Class<T> = new (..._args: any[]) => T;

class ResizableBuffer<T extends Float32Array> {
  elementLength: number;
  capacity: number;
  length: number;
  buffer: T;
  BufferType: Class<T>;

  static Float32Array(elementLength: number): ResizableBuffer<Float32Array> {
    return new ResizableBuffer(elementLength, Float32Array);
  }

  constructor(elementLength: number, BufferType: Class<T>, initialCapacity: number = 100) {
    this.elementLength = elementLength;
    this.capacity = initialCapacity * this.elementLength;
    this.BufferType = BufferType;
    this.buffer = new BufferType(this.capacity);
    this.length = 0;
  }

  clear(): void {
    this.length = 0;
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  isFull(): boolean {
    return this.length === this.capacity;
  }

  getLength(): number {
    return this.length / this.elementLength;
  }

  getBufferLength(): number {
    return this.length;
  }

  getBuffer(): T {
    return this.buffer;
  }

  getAllElements(): T {
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'Int8Array | Uint8Array | Uint8ClampedArray |... Remove this comment to see the full error message
    return this.buffer.subarray(0, this.length);
  }

  get(i: number): number {
    return this.buffer[i];
  }

  set(element: Array<number> | T, i: number): void {
    this.ensureCapacity((i + 1) * this.elementLength);
    this.buffer.set(element, i * this.elementLength);
    this.length = Math.max(this.length, (i + 1) * this.elementLength);
  }

  push(element: Array<number> | T): void {
    this.ensureCapacity();
    const { buffer, elementLength, length } = this;
    buffer.set(element, length);
    this.length += elementLength;
  }

  pushMany(elements: Array<Array<number>> | Array<T>): void {
    this.ensureCapacity(this.length + elements.length * this.elementLength);

    let { buffer, elementLength, length } = this;

    for (const element of elements) {
      buffer.set(element, length);
      length += elementLength;
    }

    this.length += elements.length * elementLength;
  }

  pushSubarray(subarray: Array<number>): void {
    this.ensureCapacity(this.length + subarray.length);
    const { buffer, length } = this;
    buffer.set(subarray, length);
    this.length += subarray.length;
  }

  pop(r: Array<number> | null | undefined): Array<number> | null | undefined {
    if (r == null) {
      r = new Array(this.elementLength);
    }

    if (!this.length) {
      return null;
    }

    let { buffer, elementLength, length } = this;

    for (let i = elementLength - 1; i >= 0; i--) {
      r[i] = buffer[--length];
    }

    this.length -= elementLength;
    return r;
  }

  top(r: Array<number> | null | undefined): Array<number> | null | undefined {
    if (r == null) {
      r = new Array(this.elementLength);
    }

    if (!this.length) {
      return null;
    }

    let { buffer, elementLength, length } = this;

    for (let i = elementLength - 1; i >= 0; i--) {
      r[i] = buffer[--length];
    }

    return r;
  }

  ensureCapacity(newCapacity: number | null | undefined = null): void {
    if (newCapacity == null) {
      newCapacity = this.length + this.elementLength;
    }

    if (this.capacity < newCapacity) {
      const { buffer } = this;

      while (this.capacity < newCapacity) {
        this.capacity = Math.max(
          this.capacity + this.elementLength,
          Math.floor(this.capacity * GROW_MULTIPLIER),
        );
        this.capacity -= this.capacity % this.elementLength;
      }

      const newBuffer = new this.BufferType(this.capacity);
      newBuffer.set(buffer);
      this.buffer = newBuffer;
    }
  }
}

export default ResizableBuffer;
