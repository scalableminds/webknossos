import { expose } from "./comlink_wrapper";
import lz4 from "./lz4_wasm_wrapper";

function compressLz4Block(
  data: Uint8Array<ArrayBuffer>,
  compress: boolean,
): Uint8Array<ArrayBuffer> {
  if (compress) {
    return lz4.compress(data) as Uint8Array<ArrayBuffer>;
  }

  return lz4.decompress(data) as Uint8Array<ArrayBuffer>;
}

export default expose(compressLz4Block);
