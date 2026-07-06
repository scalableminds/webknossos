import Base64 from "base64-js";
import { expose } from "./comlink_core";

// Load lz4-wasm lazily instead of via a static top-level import. Since Vite 8, the
// native `.wasm` import uses top-level await, which would turn this worker into an
// async module. That delays Comlink's `expose()` (called at the bottom of this module)
// until the wasm has instantiated, so the first message from the main thread arrives
// before the listener is registered and is lost forever. Kicking off the dynamic import
// here (without awaiting) keeps module evaluation synchronous so `expose()` registers
// the handler immediately, while the wasm still starts loading eagerly in the background.
const lz4Import = import("lz4-wasm");

async function compressLz4Block(data: Uint8Array): Promise<Uint8Array> {
  const { compress } = await lz4Import;
  // The backend expects the block (frame-less) version of lz4.
  // lz4-wasm uses the block version, but prepends the size of the
  // compressed data. Therefore, we strip the first 4 bytes.
  const newCompressed = compress(data);
  return newCompressed.slice(4);
}

export async function byteArraysToLz4Base64(byteArrays: Uint8Array[]): Promise<string[]> {
  const base64Strings: string[] = [];
  for (const byteArray of byteArrays) {
    const compressed = await compressLz4Block(byteArray);
    base64Strings.push(Base64.fromByteArray(compressed));
  }

  return base64Strings;
}
export default expose(byteArraysToLz4Base64);
