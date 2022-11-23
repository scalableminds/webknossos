import pako from "pako";
import { expose } from "./comlink_wrapper";

function compress(data: ArrayBuffer | string): ArrayBuffer {
  return pako.gzip(data);
}

export default expose(compress);
