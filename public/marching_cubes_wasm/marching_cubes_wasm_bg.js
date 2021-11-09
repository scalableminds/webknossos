import * as wasm from './marching_cubes_wasm_bg.wasm';

const lTextDecoder = typeof TextDecoder === 'undefined' ? (0, module.require)('util').TextDecoder : TextDecoder;

let cachedTextDecoder = new lTextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

let cachegetUint8Memory0 = null;
function getUint8Memory0() {
    if (cachegetUint8Memory0 === null || cachegetUint8Memory0.buffer !== wasm.memory.buffer) {
        cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachegetUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}
/**
*/
export function greet() {
    wasm.greet();
}

/**
*/
export class MarchingCubes {

    __destroy_into_raw() {
        const ptr = this.ptr;
        this.ptr = 0;

        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_marchingcubes_free(ptr);
    }
    /**
    * @param {number} width
    * @param {number} height
    * @param {number} depth
    * @returns {number}
    */
    set_cube(width, height, depth) {
        var ret = wasm.marchingcubes_set_cube(this.ptr, width, height, depth);
        return ret;
    }
    /**
    * @returns {number}
    */
    get_value() {
        var ret = wasm.marchingcubes_get_value(this.ptr);
        return ret >>> 0;
    }
}

export function __wbg_alert_49fc3edebf205c84(arg0, arg1) {
    alert(getStringFromWasm0(arg0, arg1));
};

export function __wbindgen_throw(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

