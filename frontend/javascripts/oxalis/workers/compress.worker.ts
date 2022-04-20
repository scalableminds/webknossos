// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'pako... Remove this comment to see the full error message
import pako from "pako";
import { expose } from "./comlink_wrapper";

function compress(data: ArrayBuffer | string): Promise<ArrayBuffer> {
  return pako.gzip(data);
}

export default expose(compress);
