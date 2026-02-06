import { compress, decompress } from "lz4-wasm";
import { expose } from "./comlink_wrapper";

function compressLz4Block(
  data: Uint8Array<ArrayBuffer>,
  shouldCompress: boolean,
): Uint8Array<ArrayBuffer> {
  if (shouldCompress) {
    return compress(data) as Uint8Array<ArrayBuffer>;
  }

  return decompress(data) as Uint8Array<ArrayBuffer>;
}

export default expose(compressLz4Block);
