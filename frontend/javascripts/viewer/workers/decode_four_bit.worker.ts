import { expose } from "./comlink_wrapper";

// This function receives and returns ArrayBuffer, since that can be transferred without
// copying to/out of the webworker
function decodeFourBit(buffer: ArrayBuffer): ArrayBuffer {
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

export default expose(decodeFourBit);
