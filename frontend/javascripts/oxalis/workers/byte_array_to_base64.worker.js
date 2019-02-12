// @flow
import Base64 from "base64-js";

import { expose } from "./comlink_wrapper";

function byteArrayToBase64(byteArray: Uint8Array): string {
  return Base64.fromByteArray(byteArray);
}

export default expose<typeof byteArrayToBase64>(byteArrayToBase64);
