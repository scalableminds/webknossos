import * as Comlink from "comlink";
import pako from "pako";
import "./init_comlink";

function compress(data: ArrayBuffer | string): ArrayBuffer {
  return pako.gzip(data).buffer as ArrayBuffer;
}

export default Comlink.expose(compress);
