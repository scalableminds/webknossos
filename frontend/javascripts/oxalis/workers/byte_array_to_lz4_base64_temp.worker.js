// @flow
import lz4 from "lz4js";

import { expose } from "./comlink_wrapper";

export function compressLz4Block(data: Uint8Array): Uint8Array {
  // Backend expects the frame-less version of lz4,
  // so we need to call lz4.compressBlock rather than compress
  const hashSize = 1 << 16;
  const hashTable = new Uint32Array(hashSize);
  const compressedBuffer = new Uint8Array(data.length);
  const compressedSize = lz4.compressBlock(data, compressedBuffer, 0, data.length, hashTable);
  return compressedBuffer.slice(0, compressedSize);
}

export default expose<typeof compressLz4Block>(compressLz4Block);
