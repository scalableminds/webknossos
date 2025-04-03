import { sleep } from "libs/utils";
// NOTE: This is a mirror of byte_array_lz4_compression.worker.js
// and is ONLY meant for mocking during tests. This implementation
// allows to introduce an artificial delay for compression/decompression.
import { __compressLz4BlockHelper } from "oxalis/workers/byte_array_lz4_compression.worker";

let isSleepEnabled = false;

export function setSlowCompression(isEnabled: boolean) {
  isSleepEnabled = isEnabled;
}

async function slowCompressLz4Block(data: Uint8Array, compress: boolean): Promise<Uint8Array> {
  if (isSleepEnabled) {
    await sleep(400);
  }

  return __compressLz4BlockHelper(data, compress);
}

export default slowCompressLz4Block;
