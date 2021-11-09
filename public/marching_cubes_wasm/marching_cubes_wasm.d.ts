/* tslint:disable */
/* eslint-disable */
/**
*/
export function greet(): void;
/**
* @returns {any}
*/
export function get_memory(): any;
/**
*/
export class MarchingCubes {
  free(): void;
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
  static new(topleft_x: number, topleft_y: number, topleft_z: number, width: number, height: number, depth: number, scale_x: number, scale_y: number, scale_z: number, resolution_x: number, resolution_y: number, resolution_z: number): MarchingCubes;
/**
* @returns {number}
*/
  get_cube_ptr(): number;
/**
* @returns {number}
*/
  get_value(): number;
/**
* @param {number} segment_id
*/
  marche(segment_id: number): void;
/**
* @param {number} segment_id
* @returns {Int32Array}
*/
  find_neighbors(segment_id: number): Int32Array;
/**
* @returns {number}
*/
  get_triangle_ptr(): number;
/**
* @returns {number}
*/
  get_triangle_size(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly greet: () => void;
  readonly get_memory: () => number;
  readonly __wbg_marchingcubes_free: (a: number) => void;
  readonly marchingcubes_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
  readonly marchingcubes_get_cube_ptr: (a: number) => number;
  readonly marchingcubes_get_value: (a: number) => number;
  readonly marchingcubes_marche: (a: number, b: number) => void;
  readonly marchingcubes_find_neighbors: (a: number, b: number, c: number) => void;
  readonly marchingcubes_get_triangle_ptr: (a: number) => number;
  readonly marchingcubes_get_triangle_size: (a: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_free: (a: number, b: number) => void;
}

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {InitInput | Promise<InitInput>} module_or_path
*
* @returns {Promise<InitOutput>}
*/
export default function init (module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
