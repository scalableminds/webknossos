// @flow
import lz4 from "lz4js";

import { expose } from "./comlink_wrapper";

function compressLz4Block(data: Uint8Array, compress: boolean): Uint8Array {
  if (compress) {
    return lz4.compress(data);
  }
  return lz4.decompress(data);
}

// This function is only exposed for slow_byte_array_lz4_compression.worker.js
// which is only used for some automated tests.
export function __compressLz4BlockHelper(data: Uint8Array, compress: boolean): Uint8Array {
  return compressLz4Block(data, compress);
}

export default expose<typeof compressLz4Block>(compressLz4Block);
