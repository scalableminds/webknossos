// @flow
import lz4 from "lz4js";

import { expose } from "./comlink_wrapper";

function compressLz4Block(data: Uint8Array, compress: boolean): Uint8Array {
  if (compress) {
    return lz4.compress(data);
  }
  return lz4.decompress(data);
}

export default expose<typeof compressLz4Block>(compressLz4Block);
