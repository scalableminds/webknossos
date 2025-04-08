/* NOTE: This is a mirror of byte_array_lz4_compression.worker.js
 * and is ONLY meant for mocking during tests. This implementation
 * allows to introduce an artificial delay for compression/decompression.
 */
import { sleep } from "libs/utils";
import * as lz4 from "lz4-wasm-nodejs";

let isSleepEnabled = false;

export function setSlowCompression(isEnabled: boolean) {
  isSleepEnabled = isEnabled;
}

async function slowCompressLz4Block(data: Uint8Array, compress: boolean): Promise<Uint8Array> {
  if (isSleepEnabled) {
    await sleep(400);
  }

  if (compress) {
    return lz4.compress(data);
  }

  return lz4.decompress(data);
}

export default slowCompressLz4Block;
