import Base64 from "base64-js";
import { expose } from "./comlink_wrapper";
import { default as lz4wasm } from "./lz4_wasm_wrapper";

function compressLz4Block(data: Uint8Array): Uint8Array {
  // The backend expects the block (frame-less) version of lz4.
  // lz4-wasm uses the block version, but prepends the size of the
  // compressed data. Therefore, we strip the first 4 bytes.
  const newCompressed = lz4wasm.compress(data);
  return newCompressed.slice(4);
}

export function byteArraysToLz4Base64(byteArrays: Uint8Array[]): string[] {
  const base64Strings: string[] = [];
  for (const byteArray of byteArrays) {
    const compressed = compressLz4Block(byteArray);
    base64Strings.push(Base64.fromByteArray(compressed));
  }

  return base64Strings;
}
export default expose(byteArraysToLz4Base64);
