import importDynamic from "libs/import_dynamic";
import { expose } from "./comlink_core";

// Load lz4-wasm lazily instead of via a static top-level import. Since Vite 8, the
// native `.wasm` import uses top-level await, which would turn this worker into an
// async module and delay Comlink's `expose()` until the wasm has instantiated, causing
// the first message from the main thread to be dropped. Kicking off the dynamic import
// here (without awaiting) keeps module evaluation synchronous so the Comlink handler is
// registered immediately, while the wasm still starts loading eagerly in the background.
const lz4Import = importDynamic(() => import("lz4-wasm"));

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
