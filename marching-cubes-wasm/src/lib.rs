mod utils;
mod marching_cubes_tables;
use wasm_bindgen::memory;
use wasm_bindgen::prelude::*;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

extern crate web_sys;

// A macro to provide `println!(..)`-style syntax for `console.log` logging.
macro_rules! log {
    ( $( $t:tt )* ) => {
        web_sys::console::log_1(&format!( $( $t )* ).into());
    }
}

#[wasm_bindgen]
extern {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello, marching-cubes-wasm!");
}

#[wasm_bindgen]
pub fn get_memory() -> JsValue {memory()}

#[wasm_bindgen]
pub struct MarchingCubes {
    topleft_x: u32,
    topleft_y: u32,
    topleft_z: u32,
    width: u32,
    height: u32,
    depth: u32,
    scale_x: f32,
    scale_y: f32,
    scale_z: f32,
    resolution_x: u32,
    resolution_y: u32,
    resolution_z: u32,
    cube: Vec<u32>,
    triangles: Vec<f32>
}

#[wasm_bindgen]
impl MarchingCubes {
    pub fn new(topleft_x: u32, topleft_y: u32, topleft_z: u32, width: u32, height: u32, depth: u32, scale_x: f32, scale_y: f32, scale_z: f32, resolution_x: u32, resolution_y: u32, resolution_z: u32) -> MarchingCubes {
        //topleft in mag1
        //resolution determines the step size
        //width, height... is in mag
        // scale is in mag 1
        utils::set_panic_hook();
        MarchingCubes { topleft_x, topleft_y, topleft_z, width, height, depth, scale_x, scale_y, scale_z, resolution_x, resolution_y, resolution_z, cube: vec![0; (width * height * depth) as usize], triangles: Vec::new() }
    }
    pub fn get_cube_ptr(&self) -> *const u32 {
        return self.cube.as_ptr();
    }
    pub fn get_value(&self) -> u32 {
        return self.cube[0];
    }
    pub fn marche(&mut self, segment_id: u32) {
        self.triangles.clear();
        let y_stride = self.width;
        let z_stride = self.height * self.width;
        let mut local_values: [u32; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
        let mut vert = [0.0, 0.0, 0.0];
        for z in 0..self.depth - 1 {
            for y in 0..self.height - 1 {
                for x in 0..self.width - 1 {
                    for i in 0..8 {
                        let [x_offset, y_offset, z_offset] = marching_cubes_tables::INDEX_TO_VERTEX[i];
                        local_values[i] = self.cube[(x + x_offset + (y + y_offset) * y_stride + (z + z_offset) * z_stride) as usize]
                    }
                    let mut index = 0;
                    for v in 0..8 {
                        if local_values[v] == segment_id {
                            index |= 1 << v;
                        }
                    }

                    /* The cube vertex and edge indices for base rotation:
                     *
                     *      v7------e6------v6
                     *     / |              /|
                     *   e11 |            e10|
                     *   /   e7           /  |
                     *  /    |           /   e5
                     *  v3------e2-------v2  |
                     *  |    |           |   |
                     *  |   v4------e4---|---v5
                     *  e3  /           e1   /
                     *  |  e8            |  e9
                     *  | /              | /    y z
                     *  |/               |/     |/
                     *  v0------e0-------v1     O--x
                     */

                    // The triangle table gives us the mapping from index to actual
                    // triangles to return for this configuration
                    for t in marching_cubes_tables::TRI_TABLE[index].iter().take_while(|t| **t >= 0) {
                        let v_idx = *t as usize;
                        let vertex_index_v0 = marching_cubes_tables::EDGE_VERTICES[v_idx][0];
                        let vertex_index_v1 = marching_cubes_tables::EDGE_VERTICES[v_idx][1];

                        if (local_values[vertex_index_v0] == segment_id) ^ (local_values[vertex_index_v1] == segment_id) {
                            // If edge is between the current segment id and another segment id use vertex in the middle
                            vert[0] = (marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v0][0] + marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v1][0]) as f32 / 2.0;
                            vert[1] = (marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v0][1] + marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v1][1]) as f32 / 2.0;
                            vert[2] = (marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v0][2] + marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v1][2]) as f32 / 2.0;
                        } else {
                            // Otherwise use the first vertex of the edge
                            let ivert = marching_cubes_tables::INDEX_TO_VERTEX[vertex_index_v0];
                            vert[0] = ivert[0] as f32;
                            vert[1] = ivert[1] as f32;
                            vert[2] = ivert[2] as f32;
                        }
                        //log!("Adding vertices {} - {} - {}", vert[0], vert[1], vert[2]);
                        self.triangles.push(((vert[0] + x as f32) * self.resolution_x as f32  + self.topleft_x as f32)  * self.scale_x);
                        self.triangles.push(((vert[1] + y as f32) * self.resolution_y as f32  + self.topleft_y as f32)  * self.scale_y);
                        self.triangles.push(((vert[2] + z as f32) * self.resolution_z as f32  + self.topleft_z as f32)  * self.scale_z);
                    }
                }
            }
        }
    }

    fn scan_face(&self, segment_id: u32, offset: u32, stride_x: u32, stride_y: u32, width: u32, height: u32)  -> bool {
        for y in 0..height {
            for x in 0..width {
                //log!("offset {} x {} y {}", offset, x, y);
                //log!("stride_x {} stride_y {}", stride_x, stride_y);
                if self.cube[(offset + stride_x * x + stride_y * y) as usize] == segment_id  {
                    return true;
                }
            }
        }
        return false;
    }
    // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
    // neighbor offsets [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];
    pub fn find_neighbors(&self, segment_id: u32) -> Vec<i32> {
        let x_stride = 1u32;
        let y_stride = self.width;
        let z_stride = self.height * self.width;
        let offset = 0;
        let mut neighbors:Vec<i32> = Vec::new();

        // front_xy
        if self.scan_face(segment_id, 0, x_stride, y_stride, self.width, self.height) {
            neighbors.push(0);
        }
        // front_xz
        if self.scan_face(segment_id, 0, x_stride, z_stride, self.width, self.depth) {
            neighbors.push(1);
        }
        // front_yz
        if self.scan_face(segment_id, 0, y_stride, z_stride, self.height, self.depth) {
            neighbors.push(2);
        }
        // back_xy
        if self.scan_face(segment_id, z_stride * (self.depth -1), x_stride, y_stride, self.width, self.height) {
            neighbors.push(3);
        }
        // back_xz
        if self.scan_face(segment_id, y_stride * (self.height -1), x_stride, z_stride, self.width, self.depth) {
            neighbors.push(4);
        }
        // back_yz
        if self.scan_face(segment_id, x_stride * (self.width -1), y_stride, z_stride, self.height, self.depth) {
            neighbors.push(5);
        }
        return neighbors;
    }
    pub fn get_triangle_ptr(&self) -> *const f32 {
        self.triangles.as_ptr()
    }

    pub fn get_triangle_size(&self) -> usize {
        self.triangles.len()
    }
}

