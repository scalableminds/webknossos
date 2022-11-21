import Base64 from "base64-js";
import * as lz4wasm from "lz4-wasm";
import { expose } from "./comlink_wrapper";

function compressLz4Block(data: Uint8Array): Uint8Array {
  // The backend expects the block (frame-less) version of lz4.
  // lz4-wasm uses the block version, but prepends the size of the
  // compressed data. Therefore, we strip the first 4 bytes.
  const newCompressed = lz4wasm.compress(data);
  return newCompressed.slice(4);
}

export function byteArrayToLz4Base64(byteArray: Uint8Array): string {
  const compressed = compressLz4Block(byteArray);
  return Base64.fromByteArray(compressed);
}
export default expose(byteArrayToLz4Base64);
