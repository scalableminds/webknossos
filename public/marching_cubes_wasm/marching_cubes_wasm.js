
let wasm;

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

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

const heap = new Array(32).fill(undefined);

heap.push(undefined, null, true, false);

let heap_next = heap.length;

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}
/**
*/
export function greet() {
    wasm.greet();
}

function getObject(idx) { return heap[idx]; }

function dropObject(idx) {
    if (idx < 36) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}
/**
* @returns {any}
*/
export function get_memory() {
    var ret = wasm.get_memory();
    return takeObject(ret);
}

let cachegetInt32Memory0 = null;
function getInt32Memory0() {
    if (cachegetInt32Memory0 === null || cachegetInt32Memory0.buffer !== wasm.memory.buffer) {
        cachegetInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachegetInt32Memory0;
}

function getArrayI32FromWasm0(ptr, len) {
    return getInt32Memory0().subarray(ptr / 4, ptr / 4 + len);
}
/**
*/
export class MarchingCubes {

    static __wrap(ptr) {
        const obj = Object.create(MarchingCubes.prototype);
        obj.ptr = ptr;

        return obj;
    }

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
    * @param {number} topleft_x
    * @param {number} topleft_y
    * @param {number} topleft_z
    * @param {number} width
    * @param {number} height
    * @param {number} depth
    * @param {number} scale_x
    * @param {number} scale_y
    * @param {number} scale_z
    * @param {number} resolution_x
    * @param {number} resolution_y
    * @param {number} resolution_z
    * @returns {MarchingCubes}
    */
    static new(topleft_x, topleft_y, topleft_z, width, height, depth, scale_x, scale_y, scale_z, resolution_x, resolution_y, resolution_z) {
        var ret = wasm.marchingcubes_new(topleft_x, topleft_y, topleft_z, width, height, depth, scale_x, scale_y, scale_z, resolution_x, resolution_y, resolution_z);
        return MarchingCubes.__wrap(ret);
    }
    /**
    * @returns {number}
    */
    get_cube_ptr() {
        var ret = wasm.marchingcubes_get_cube_ptr(this.ptr);
        return ret;
    }
    /**
    * @returns {number}
    */
    get_value() {
        var ret = wasm.marchingcubes_get_value(this.ptr);
        return ret >>> 0;
    }
    /**
    * @param {number} segment_id
    */
    marche(segment_id) {
        wasm.marchingcubes_marche(this.ptr, segment_id);
    }
    /**
    * @param {number} segment_id
    * @returns {Int32Array}
    */
    find_neighbors(segment_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.marchingcubes_find_neighbors(retptr, this.ptr, segment_id);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var v0 = getArrayI32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_free(r0, r1 * 4);
            return v0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {number}
    */
    get_triangle_ptr() {
        var ret = wasm.marchingcubes_get_triangle_ptr(this.ptr);
        return ret;
    }
    /**
    * @returns {number}
    */
    get_triangle_size() {
        var ret = wasm.marchingcubes_get_triangle_size(this.ptr);
        return ret >>> 0;
    }
}

async function load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

async function init(input) {
    if (typeof input === 'undefined') {
        input = new URL('marching_cubes_wasm_bg.wasm', import.meta.url);
    }
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_alert_49fc3edebf205c84 = function(arg0, arg1) {
        alert(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_memory = function() {
        var ret = wasm.memory;
        return addHeapObject(ret);
    };

    if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
        input = fetch(input);
    }



    const { instance, module } = await load(await input, imports);

    wasm = instance.exports;
    init.__wbindgen_wasm_module = module;

    return wasm;
}

export default init;

