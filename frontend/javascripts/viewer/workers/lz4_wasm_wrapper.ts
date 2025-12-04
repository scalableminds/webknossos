// Simple wrapper around the lz4-wasm module such that it can be replaced with a NodeJs version
//  in tests
import * as lz4 from "lz4-wasm";
export default lz4;
