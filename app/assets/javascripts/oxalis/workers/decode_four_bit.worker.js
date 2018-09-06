// @flow

// This module provides performance intensive functions, which is why it has to be
// imported and used via a webworker like this:
// import { proxy } from "comlinkjs";
// import DecodeFourBitWorker from ".../workers/decode_four_bit.worker";
// const decodeFourBit = proxy(new DecodeFourBitWorker);
// await decodeFourBit(...)

import { expose } from "./comlink_wrapper";

// This function receives and returns ArrayBuffer, since that can be transferred without
// copying to/out of the webworker
export default function decodeFourBit(buffer: ArrayBuffer): ArrayBuffer {
  const bufferArray = new Uint8Array(buffer);
  // Expand 4-bit data
  const newColors = new Uint8Array(2 * bufferArray.length);

  let index = 0;
  while (index < newColors.length) {
    const value = bufferArray[index >> 1];
    newColors[index] = value & 0b11110000;
    index++;
    newColors[index] = value << 4;
    index++;
  }

  return newColors.buffer;
}

expose(decodeFourBit, self);
