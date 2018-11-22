// @flow

import pako from "pako";

import { expose } from "./comlink_wrapper";

function compress(data: Uint8Array | string): Promise<Uint8Array> {
  return pako.gzip(data);
}

export default expose(compress);
