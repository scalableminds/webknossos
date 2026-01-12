import Base64 from "base64-js";
import * as Comlink from "comlink";
import "./init_comlink";
import * as lz4 from "lz4-wasm";

function compressLz4Block(data: Uint8Array): Uint8Array {
  // The backend expects the block (frame-less) version of lz4.
  // lz4-wasm uses the block version, but prepends the size of the
  // compressed data. Therefore, we strip the first 4 bytes.
  const newCompressed = lz4.compress(data);
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
export default Comlink.expose(byteArraysToLz4Base64);
