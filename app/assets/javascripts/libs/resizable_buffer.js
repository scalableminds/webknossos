import Utils from "libs/utils";

class ResizableBuffer {
  static initClass() {
    this.prototype.GROW_MULTIPLIER = 1.3;
  }

  constructor(elementLength, initialCapacity = 100, BufferType = Float32Array) {
    this.elementLength = elementLength;
    this.BufferType = BufferType;
    this.capacity = initialCapacity * this.elementLength;
    this.buffer = new this.BufferType(this.capacity);

    this.length = 0;
  }


  clear() {
    this.length = 0;
  }


  isEmpty() { return this.length === 0; }

  isFull() { return this.length === this.capacity; }

  getLength() { return this.length / this.elementLength; }

  getBufferLength() { return this.length; }

  getBuffer() { return this.buffer; }

  getAllElements() { return this.buffer.subarray(0, this.length); }

  get(i) { return this.buffer[i]; }

  set(element, i) {
    return this.buffer.set(element, i * this.elementLength);
  }


  push(element) {
    this.ensureCapacity();

    const { buffer, elementLength, length } = this;

    buffer.set(element, length);

    this.length += elementLength;
  }


  pushMany(elements) {
    this.ensureCapacity(this.length + (elements.length * this.elementLength));

    // eslint-disable-next-line prefer-const
    let { buffer, elementLength, length } = this;

    for (const element of elements) {
      buffer.set(element, length);
      length += elementLength;
    }

    this.length += elements.length * elementLength;
  }

  pushSubarray(subarray) {
    this.ensureCapacity(this.length + subarray.length);

    // eslint-disable-next-line no-unused-vars
    const { buffer, elementLength, length } = this;

    buffer.set(subarray, length);

    this.length += subarray.length;
  }


  pop(r) {
    if (r == null) { r = new Array(this.elementLength); }
    if (!this.length) { return; }

    // eslint-disable-next-line prefer-const
    let { buffer, elementLength, length } = this;

    for (let i = elementLength - 1; i >= 0; i--) {
      r[i] = buffer[--length];
    }

    this.length -= elementLength;

    return r;
  }


  top(r) {
    if (r == null) { r = new Array(this.elementLength); }
    if (!this.length) { return; }

    // eslint-disable-next-line no-unused-vars, prefer-const
    let { buffer, elementLength, length } = this;

    for (let i = elementLength - 1; i >= 0; i--) {
      r[i] = buffer[--length];
    }

    return r;
  }


  ensureCapacity(newCapacity) {
    if (newCapacity == null) { newCapacity = this.length + this.elementLength; }
    if (this.capacity < newCapacity) {
      const { buffer } = this;

      while (this.capacity < newCapacity) {
        this.capacity = Math.floor(this.capacity * this.GROW_MULTIPLIER);
        this.capacity -= this.capacity % this.elementLength;
      }

      const newBuffer = new this.BufferType(this.capacity);

      newBuffer.set(buffer);

      this.buffer = newBuffer;
    }
  }


  toString() {
    const length = this.getLength();
    const result = [];

    for (const i of Utils.__range__(0, length, false)) {
      const element = [];
      for (const j of Utils.__range__(0, this.elementLength, false)) {
        element.push(this.buffer[(i * this.elementLength) + j]);
      }
      result.push(`[ ${element.join(", ")} ]`);
    }

    return `(${length}) { ${result.join(", ")} }`;
  }
}
ResizableBuffer.initClass();


export default ResizableBuffer;
