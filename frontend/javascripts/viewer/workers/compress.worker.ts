import pako from "pako";
import { expose } from "./comlink_core";

function compress(data: ArrayBuffer | string): ArrayBuffer {
  return pako.gzip(data).buffer as ArrayBuffer;
}

export default expose(compress);
