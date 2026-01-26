// Simple wrapper around the lz4-wasm module such that it can be replaced with a NodeJs version
//  in tests
import { compress, decompress } from "lz4-wasm";
export default { compress, decompress };
