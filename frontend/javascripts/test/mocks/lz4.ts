import * as lz4 from "lz4-wasm-nodejs";
import mockRequire from "mock-require";

mockRequire("lz4-wasm", lz4);
