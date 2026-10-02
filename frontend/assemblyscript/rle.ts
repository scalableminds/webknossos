// AssemblyScript source — compile to frontend/assets/wasm/rle.wasm
// Memory layout: input at [0, MAX_LEN), output at [MAX_LEN, 2*MAX_LEN)
const MAX_LEN: i32 = 32768; // 32^3

export function getInputPtr(): i32 {
  return 0;
}

export function getOutputPtr(): i32 {
  return MAX_LEN;
}

// Returns the number of bytes written to the output region.
// Each run is encoded as: 1 byte value + 2 bytes count (u16, little-endian).
export function rle(inputLen: i32): i32 {
  let outputCursor: i32 = 0;
  let currentElement: u8 = load<u8>(0);
  let count: i32 = 1;

  for (let x: i32 = 1; x < inputLen; x++) {
    const val: u8 = load<u8>(x);
    if (val === currentElement) {
      count++;
    } else {
      store<u8>(MAX_LEN + outputCursor, currentElement);
      outputCursor++;
      store<u16>(MAX_LEN + outputCursor, count as u16);
      outputCursor += 2;
      currentElement = val;
      count = 1;
    }
  }

  store<u8>(MAX_LEN + outputCursor, currentElement);
  outputCursor++;
  store<u16>(MAX_LEN + outputCursor, count as u16);
  outputCursor += 2;

  return outputCursor;
}
