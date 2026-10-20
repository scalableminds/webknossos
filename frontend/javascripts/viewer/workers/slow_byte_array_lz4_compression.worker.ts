/* NOTE: This is a mirror of byte_array_lz4_compression.worker.js
 * and is ONLY meant for mocking during tests. This implementation
 * allows to introduce an artificial delay for compression/decompression.
 */
import { compress, decompress } from "lz4-wasm";

// `sleep` is inlined rather than imported from libs/utils on purpose. This module is
// substituted for the real compression worker by a global vi.mock factory (see
// test/global_mocks.ts), so everything it imports has to be loaded before the mock
// resolves. libs/utils drags in chalk, dayjs, lodash-es and libs/window for one four-line
// helper, which widened that window enough to lose a race against Vitest's environment
// teardown and surface as an intermittent unhandled rejection.
function sleep(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

let isSleepEnabled = false;

export function setSlowCompression(isEnabled: boolean) {
  isSleepEnabled = isEnabled;
}

async function slowCompressLz4Block(
  data: Uint8Array,
  shouldCompress: boolean,
): Promise<Uint8Array> {
  if (isSleepEnabled) {
    await sleep(400);
  }

  if (shouldCompress) {
    return compress(data);
  }

  return decompress(data);
}

export default slowCompressLz4Block;
