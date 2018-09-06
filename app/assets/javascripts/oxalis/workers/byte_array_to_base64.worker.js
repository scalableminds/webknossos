// @flow
import Base64 from "base64-js";

import { expose } from "./comlink_wrapper";

export default function byteArrayToBase64(byteArray: Uint8Array): string {
  return Base64.fromByteArray(byteArray);
}

expose(byteArrayToBase64, self);
