import { expose } from "./comlink_core";

// Load lz4-wasm lazily instead of via a static top-level import. Since Vite 8, the
// native `.wasm` import uses top-level await, which would turn this worker into an
// async module and delay Comlink's `expose()` until the wasm has instantiated, causing
// the first message from the main thread to be dropped. Kicking off the dynamic import
// here (without awaiting) keeps module evaluation synchronous so the Comlink handler is
// registered immediately, while the wasm still starts loading eagerly in the background.
// Deliberately NOT wrapped in importDynamic(): that module pulls main-thread UI (antd,
// Toast) into the worker bundle, and its failure toast could not render inside a worker
// anyway. If this import fails, awaiting lz4Import rejects and Comlink propagates the
// error to the main-thread caller. (Whitelisted in tools/check-no-bare-dynamic-imports.js.)
const lz4Import = import("lz4-wasm");

async function compressLz4Block(
  data: Uint8Array<ArrayBuffer>,
  shouldCompress: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const { compress, decompress } = await lz4Import;
  if (shouldCompress) {
    return compress(data) as Uint8Array<ArrayBuffer>;
  }

  return decompress(data) as Uint8Array<ArrayBuffer>;
}

export default expose(compressLz4Block);
