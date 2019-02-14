/*
 * resizable_buffer.js
 * @flow
 */

const GROW_MULTIPLIER = 1.3;

class ResizableBuffer<T: $TypedArray> {
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
    return this.buffer.subarray(0, this.length);
  }

  get(i: number): number {
    return this.buffer[i];
  }

  set(element: Array<number> | $TypedArray, i: number): void {
    this.buffer.set(element, i * this.elementLength);
  }

  push(element: Array<number> | $TypedArray): void {
    this.ensureCapacity();
    const { buffer, elementLength, length } = this;
    buffer.set(element, length);
    this.length += elementLength;
  }

  pushMany(elements: Array<Array<number>> | Array<$TypedArray>): void {
    this.ensureCapacity(this.length + elements.length * this.elementLength);

    // eslint-disable-next-line prefer-const
    let { buffer, elementLength, length } = this;

    for (const element of elements) {
      buffer.set(element, length);
      length += elementLength;
    }
    this.length += elements.length * elementLength;
  }

  pushSubarray(subarray: Array<number>): void {
    this.ensureCapacity(this.length + subarray.length);

    // eslint-disable-next-line no-unused-vars
    const { buffer, elementLength, length } = this;

    buffer.set(subarray, length);

    this.length += subarray.length;
  }

  pop(r: ?Array<number>): ?Array<number> {
    if (r == null) {
      r = new Array(this.elementLength);
    }
    if (!this.length) {
      return null;
    }

    // eslint-disable-next-line prefer-const
    let { buffer, elementLength, length } = this;

    for (let i = elementLength - 1; i >= 0; i--) {
      r[i] = buffer[--length];
    }

    this.length -= elementLength;

    return r;
  }

  top(r: ?Array<number>): ?Array<number> {
    if (r == null) {
      r = new Array(this.elementLength);
    }
    if (!this.length) {
      return null;
    }

    // eslint-disable-next-line no-unused-vars, prefer-const
    let { buffer, elementLength, length } = this;

    for (let i = elementLength - 1; i >= 0; i--) {
      r[i] = buffer[--length];
    }

    return r;
  }

  ensureCapacity(newCapacity: ?number): void {
    if (newCapacity == null) {
      newCapacity = this.length + this.elementLength;
    }
    if (this.capacity < newCapacity) {
      const { buffer } = this;

      while (this.capacity < newCapacity) {
        this.capacity = Math.floor(this.capacity * GROW_MULTIPLIER);
        this.capacity -= this.capacity % this.elementLength;
      }

      const newBuffer = new this.BufferType(this.capacity);

      newBuffer.set(buffer);

      this.buffer = newBuffer;
    }
  }
}

export default ResizableBuffer;
