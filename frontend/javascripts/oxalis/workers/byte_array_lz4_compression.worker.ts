import { expose } from "./comlink_wrapper";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'lz4j... Remove this comment to see the full error message
import lz4Slow from "lz4js";
import * as lz4 from "lz4-wasm";

const useSlowCompressor = Math.random() > 0.5;
console.log("useSlowCompressor", useSlowCompressor);
function compressLz4Block(data: Uint8Array, compress: boolean): Uint8Array {
  const compressor = useSlowCompressor ? lz4Slow : lz4;

  const then = performance.now();
  if (compress) {
    const retval = compressor.compress(data);
    console.log(`${useSlowCompressor ? "slow" : "fast"} compress: ${performance.now() - then}`);
    return retval;
  }

  const retval = compressor.decompress(data);
  console.log(`${useSlowCompressor ? "slow" : "fast"} decompress: ${performance.now() - then}`);
  return retval;
}

// This function is only exposed for slow_byte_array_lz4_compression.worker.js
// which is only used for some automated tests.
export function __compressLz4BlockHelper(data: Uint8Array, compress: boolean): Uint8Array {
  return compressLz4Block(data, compress);
}
export default expose(compressLz4Block);
