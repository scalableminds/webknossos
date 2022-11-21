import Base64 from "base64-js";
// // @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'lz4j... Remove this comment to see the full error message
// import lz4 from "lz4js";
import * as lz4wasm from "lz4-wasm";
import { expose } from "./comlink_wrapper";

function compressLz4Block(data: Uint8Array): Uint8Array {
  // Backend expects the frame-less version of lz4,
  // so we need to call lz4.compressBlock rather than compress
  const newCompressed = lz4wasm.compress(data);
  return newCompressed.slice(4);
  // const hashSize = 1 << 16;
  // const hashTable = new Uint32Array(hashSize);
  // const compressedBuffer = new Uint8Array(data.length);
  // const compressedSize = lz4.compressBlock(data, compressedBuffer, 0, data.length, hashTable);
  // return compressedBuffer.slice(0, compressedSize);
}

export function byteArrayToLz4Base64(byteArray: Uint8Array): string {
  const compressed = compressLz4Block(byteArray);
  return Base64.fromByteArray(compressed);
}
export default expose(byteArrayToLz4Base64);
