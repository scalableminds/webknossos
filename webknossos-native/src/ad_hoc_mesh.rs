//! Native function of `NativeAdHocMesher`: ad-hoc meshing of one segment in a cuboid of segment ids with marching
//! cubes.
//!
//! The cuboid is a byte array of little-endian elements with 1, 2, 4 or 8 bytes each, x fastest. A voxel belongs to
//! the segment if its raw bits equal the low bits of the segment id, so signedness does not matter. The output is
//! deterministic down to the order of the vertices:
//! - The cuboid is split into blocks of [BLOCK_SIZE]³ cubes, iterated with x outermost and z innermost. A block
//!   spans `BLOCK_SIZE + 1` voxels per axis (fewer at the end of the cuboid), so neighboring blocks share a plane of
//!   voxels. Blocks without a voxel of the segment are skipped.
//! - Within a block, cubes are iterated with z outermost and x innermost. A cube is the 2×2×2 voxels starting at its
//!   corner `(x, y, z)`. It emits the vertices of its triangles from [TRIANGLES] as
//!   `(x + edgeMidpoint.x + offset.x) * scale.x` (likewise for y and z) in f32.
//! - The mesh is indexed: a vertex is stored once, when it is first emitted, and the triangles refer to it by index.
//!   Vertices are identified by the voxel edge they lie on, so the merging is exact. Resolving the indices gives the
//!   triangle soup with three vertices per triangle.
//! - The neighbors are the faces of the cuboid that contain a voxel of the segment, see [Neighbors].

pub(crate) mod triangle_table;

use std::sync::Mutex;

use jni::EnvUnowned;
use jni::objects::{JByteArray, JFloatArray, JIntArray, JObject, JObjectArray};
use jni::sys::{jint, jlong};

use crate::bucket_scanner::Element;
use crate::jni_util::{self, NativeResult, invalid_argument};
use triangle_table::{EDGE_MIDPOINTS, TRIANGLES};

/// The number of cubes per axis of a block.
const BLOCK_SIZE: usize = 32;

/// The six faces of the cuboid that may contain the segment, as bits in this order: 0 front xy (z = 0), 1 front xz
/// (y = 0), 2 front yz (x = 0), 3 back xy (z = max), 4 back xz (y = max), 5 back yz (x = max).
///
/// A face covers only the voxels that are the corner of a cube, i.e. it excludes its last row and column: front xy
/// covers x < width - 1 and y < height - 1, front xz covers x < width - 1 and z < depth - 1, and so on. This is
/// intended: the frontend pads each requested cuboid by one voxel towards the top left (see ad_hoc_mesh_saga.ts), so
/// adjacent cuboids overlap by one voxel plane, and the excluded row or column is the first one of the same face of
/// the adjacent cuboid along that axis, which reports it.
pub type Neighbors = u8;

/// The mesh of a segment in a cuboid.
#[derive(Debug, Clone, PartialEq)]
pub struct Mesh {
    /// Three floats per vertex, each vertex once, in the order of first use.
    pub vertices: Vec<f32>,
    /// Three vertex indices per triangle.
    pub indices: Vec<u32>,
    pub neighbors: Neighbors,
}

/// The largest cuboid, in voxels, whose vertex indices fit into a Java `int`: there are at most three edges, and
/// so three vertices, per voxel.
const MAX_VOXELS: usize = i32::MAX as usize / 3;

/// A cuboid of segment ids with its size in voxels.
#[derive(Debug, Clone, Copy)]
pub struct Cuboid<'a> {
    pub data: &'a [u8],
    pub bytes_per_element: usize,
    pub dimensions: [usize; 3],
}

impl<'a> Cuboid<'a> {
    /// Validates the arguments, like a native call does.
    #[cfg(test)]
    pub fn new(data: &'a [u8], bytes_per_element: i32, dimensions: &[i32]) -> NativeResult<Self> {
        let (bytes_per_element, dimensions) =
            Self::validate(data.len(), bytes_per_element, dimensions)?;
        Ok(Cuboid {
            data,
            bytes_per_element,
            dimensions,
        })
    }

    /// Validates the arguments of a native call for a cuboid of `data_len` bytes. Returns the bytes per element
    /// and the dimensions.
    pub(crate) fn validate(
        data_len: usize,
        bytes_per_element: i32,
        dimensions: &[i32],
    ) -> NativeResult<(usize, [usize; 3])> {
        if !matches!(bytes_per_element, 1 | 2 | 4 | 8) {
            return invalid_argument(format!(
                "unsupported bytesPerElement value {bytes_per_element}"
            ));
        }
        let &[x, y, z] = dimensions else {
            return invalid_argument("dimensions must have three elements");
        };
        if x <= 0 || y <= 0 || z <= 0 {
            return invalid_argument("dimensions must be positive");
        }
        let checked = [x, y, z].map(|d| d as usize);
        let voxel_count = checked
            .iter()
            .try_fold(1usize, |product, &d| product.checked_mul(d))
            .filter(|&count| count <= MAX_VOXELS);
        let Some(voxel_count) = voxel_count else {
            return invalid_argument(format!("cuboid must have at most {MAX_VOXELS} voxels"));
        };
        // Cannot overflow, as voxel_count <= MAX_VOXELS < i32::MAX and bytes_per_element <= 8.
        if voxel_count * bytes_per_element as usize != data_len {
            return invalid_argument(
                "data length must be the product of the dimensions times bytesPerElement",
            );
        }
        Ok((bytes_per_element as usize, checked))
    }
}

/// A 0/1 mask of the voxels of the segment, together with the blocks and faces that contain one.
struct SegmentMask {
    voxels: Vec<u8>,
    dimensions: [usize; 3],
    /// The number of blocks per axis.
    block_counts: [usize; 3],
    /// Indexed by `bx + block_counts.x * (by + block_counts.y * bz)`.
    occupied_blocks: Vec<bool>,
    neighbors: Neighbors,
}

/// The blocks along one axis that contain voxel `coordinate`: its own block and, for the first voxel of a block
/// other than the first, also the previous block, whose last voxel plane it is. Returns `(first, last)`.
#[inline(always)]
fn blocks_containing(coordinate: usize) -> (usize, usize) {
    let block = coordinate / BLOCK_SIZE;
    if coordinate.is_multiple_of(BLOCK_SIZE) && block > 0 {
        (block - 1, block)
    } else {
        (block, block)
    }
}

/// Writes `mask[i] = 1` if element `i` of `row` equals the low `T::SIZE` bytes of `segment_id`, else 0. Returns
/// whether any element matched.
pub(crate) fn mask_row<T: Element>(row: &[u8], segment_id: i64, mask: &mut [u8]) -> bool {
    let segment = T::read(&segment_id.to_le_bytes()[..T::SIZE]);
    let mut any = 0;
    for (out, element) in mask.iter_mut().zip(row.chunks_exact(T::SIZE)) {
        *out = (T::read(element) == segment) as u8;
        any |= *out;
    }
    any != 0
}

impl SegmentMask {
    /// Builds the mask of a cuboid.
    #[cfg(test)]
    fn new(cuboid: &Cuboid, segment_id: i64) -> Self {
        let mut mask = Self::empty(cuboid.dimensions);
        mask.fill(cuboid, segment_id);
        mask
    }

    /// An empty mask for a cuboid of the given dimensions, to be filled by [Self::fill].
    fn empty(dimensions: [usize; 3]) -> Self {
        let block_counts = dimensions.map(|d| d.div_ceil(BLOCK_SIZE));
        SegmentMask {
            voxels: vec![0u8; dimensions.iter().product()],
            dimensions,
            block_counts,
            occupied_blocks: vec![false; block_counts.iter().product()],
            neighbors: 0,
        }
    }

    /// Fills the empty mask in one pass over the cuboid, row by row. Does not allocate, as it runs inside a JNI
    /// critical section, see [jni_util::with_bytes_critical].
    fn fill(&mut self, cuboid: &Cuboid, segment_id: i64) {
        debug_assert_eq!(cuboid.dimensions, self.dimensions);
        let [width, height, depth] = cuboid.dimensions;
        let block_counts = self.block_counts;
        let voxels = &mut self.voxels;
        let occupied_blocks = &mut self.occupied_blocks;
        let mut neighbors: Neighbors = 0;
        let row_bytes = width * cuboid.bytes_per_element;

        for z in 0..depth {
            for y in 0..height {
                let row_index = y + height * z;
                let row = &cuboid.data[row_index * row_bytes..(row_index + 1) * row_bytes];
                let mask = &mut voxels[row_index * width..(row_index + 1) * width];
                let any = match cuboid.bytes_per_element {
                    1 => mask_row::<u8>(row, segment_id, mask),
                    2 => mask_row::<u16>(row, segment_id, mask),
                    4 => mask_row::<u32>(row, segment_id, mask),
                    _ => mask_row::<u64>(row, segment_id, mask),
                };
                if !any {
                    continue;
                }

                // Faces, see [Neighbors]. Only the first `width - 1` voxels count for the xy and xz faces, and only
                // rows on the border of the cuboid can be part of one, so the scan is skipped for all others.
                let on_xy_or_xz_face = z == 0 || z == depth - 1 || y == 0 || y == height - 1;
                let inner_any = on_xy_or_xz_face && mask[..width - 1].contains(&1);
                if inner_any && y + 1 < height {
                    if z == 0 {
                        neighbors |= 1 << 0;
                    }
                    if z == depth - 1 {
                        neighbors |= 1 << 3;
                    }
                }
                if z + 1 < depth {
                    if inner_any && y == 0 {
                        neighbors |= 1 << 1;
                    }
                    if inner_any && y == height - 1 {
                        neighbors |= 1 << 4;
                    }
                    if y + 1 < height {
                        if mask[0] == 1 {
                            neighbors |= 1 << 2;
                        }
                        if mask[width - 1] == 1 {
                            neighbors |= 1 << 5;
                        }
                    }
                }

                // Blocks
                let (first_y, last_y) = blocks_containing(y);
                let (first_z, last_z) = blocks_containing(z);
                for block_x in 0..block_counts[0] {
                    let start = block_x * BLOCK_SIZE;
                    let end = (start + BLOCK_SIZE + 1).min(width);
                    if !mask[start..end].contains(&1) {
                        continue;
                    }
                    for block_z in first_z..=last_z {
                        for block_y in first_y..=last_y {
                            occupied_blocks[block_x
                                + block_counts[0] * (block_y + block_counts[1] * block_z)] = true;
                        }
                    }
                }
            }
        }

        self.neighbors = neighbors;
    }
}

/// The cube index of [TRIANGLES] for each combination of two neighboring columns of four voxels: bits 0..3 of the
/// key are the voxels at x of the rows (y, z), (y + 1, z), (y, z + 1) and (y + 1, z + 1), bits 4..7 the same at
/// x + 1.
pub(crate) const CUBE_INDEX: [u8; 256] = {
    const fn bit(key: usize, i: usize) -> u8 {
        ((key >> i) & 1) as u8
    }
    let mut table = [0u8; 256];
    let mut key = 0;
    while key < 256 {
        table[key] = bit(key, 0) // corner 0: (x, y, z)
            | bit(key, 4) << 1 // corner 1: (x + 1, y, z)
            | bit(key, 5) << 2 // corner 2: (x + 1, y + 1, z)
            | bit(key, 1) << 3 // corner 3: (x, y + 1, z)
            | bit(key, 2) << 4 // corner 4: (x, y, z + 1)
            | bit(key, 6) << 5 // corner 5: (x + 1, y, z + 1)
            | bit(key, 7) << 6 // corner 6: (x + 1, y + 1, z + 1)
            | bit(key, 3) << 7; // corner 7: (x, y + 1, z + 1)
        key += 1;
    }
    table
};

/// For each edge of [EDGE_MIDPOINTS], the axis it runs along and the offset of its first voxel from the cube's
/// origin corner.
const EDGE_VOXELS: [(usize, [usize; 3]); 12] = {
    let mut table = [(0, [0; 3]); 12];
    let mut edge = 0;
    while edge < 12 {
        let mut axis = 0;
        while axis < 3 {
            // 0, 1 or 2 half voxels; 1 for the axis of the edge.
            let halves = (EDGE_MIDPOINTS[edge][axis] * 2.0) as usize;
            if halves == 1 {
                table[edge].0 = axis;
            }
            table[edge].1[axis] = halves / 2;
            axis += 1;
        }
        edge += 1;
    }
    table
};

/// The size, in entries, of the edge tables kept between calls (4 MB, enough for the 65³ voxels the frontend
/// requests, and up to 70³). Larger tables are allocated per call.
const CACHED_EDGE_TABLE_LEN: usize = 1 << 20;

/// The most edge tables kept between calls, which bounds their memory (32 MB) no matter how many threads mesh.
const MAX_CACHED_EDGE_TABLES: usize = 8;

/// Edge tables of previous calls, all zeros and [CACHED_EDGE_TABLE_LEN] long, see [MeshBuilder::edge_vertices].
/// Reusing them avoids allocating and zeroing megabytes per call; only the entries of the vertices are reset.
static EDGE_TABLES: Mutex<Vec<Vec<u32>>> = Mutex::new(Vec::new());

/// Takes a zeroed edge table with at least `len` entries out of [EDGE_TABLES], or allocates one.
fn take_edge_table(len: usize) -> Vec<u32> {
    if len > CACHED_EDGE_TABLE_LEN {
        return vec![0; len];
    }
    let cached = EDGE_TABLES.lock().ok().and_then(|mut tables| tables.pop());
    // Allocated at the cached size, so it can serve any later call that fits. The pages of a large zeroed
    // allocation are only backed by memory once they are written.
    cached.unwrap_or_else(|| vec![0; CACHED_EDGE_TABLE_LEN])
}

/// Returns an edge table, all zeros again, to [EDGE_TABLES] if it has the cached size and there is room.
fn return_edge_table(table: Vec<u32>) {
    if table.len() != CACHED_EDGE_TABLE_LEN {
        return;
    }
    if let Ok(mut tables) = EDGE_TABLES.lock()
        && tables.len() < MAX_CACHED_EDGE_TABLES
    {
        tables.push(table);
    }
}

/// Collects the indexed mesh, merging the vertices of the same voxel edge.
struct MeshBuilder {
    /// For each edge of [EDGE_MIDPOINTS], its entry in [Self::edge_vertices] relative to the cube's.
    edge_offsets: [usize; 12],
    offset: [f32; 3],
    scale: [f32; 3],
    vertices: Vec<f32>,
    indices: Vec<u32>,
    /// For each voxel edge, its vertex index + 1, or 0 if it has none yet. Indexed by
    /// `3 * (x + width * (y + height * z)) + axis` of the edge's first voxel and axis.
    edge_vertices: Vec<u32>,
    /// The entry of [Self::edge_vertices] of each vertex, to reset the table.
    vertex_edges: Vec<usize>,
}

impl MeshBuilder {
    fn new(dimensions: [usize; 3], offset: [f32; 3], scale: [f32; 3]) -> Self {
        let edge_count = 3 * dimensions.iter().product::<usize>();
        // Taken out of the pool, so a panic drops it instead of leaving set entries behind.
        let edge_vertices = take_edge_table(edge_count);
        let [width, height, _] = dimensions;
        let edge_offsets =
            EDGE_VOXELS.map(|(axis, [vx, vy, vz])| 3 * (vx + width * (vy + height * vz)) + axis);
        MeshBuilder {
            edge_offsets,
            offset,
            scale,
            vertices: Vec::new(),
            indices: Vec::new(),
            edge_vertices,
            vertex_edges: Vec::new(),
        }
    }

    /// Adds the vertex on `edge` of the cube at `(x, y, z)` to the current triangle. `cube_slot` is the cube's
    /// entry in [Self::edge_vertices], `3 * (x + width * (y + height * z))`.
    #[inline(always)]
    fn add(&mut self, [x, y, z]: [usize; 3], cube_slot: usize, edge: u8) {
        let slot = cube_slot + self.edge_offsets[edge as usize];
        let index = match self.edge_vertices[slot] {
            0 => {
                let index = self.vertex_edges.len() as u32;
                self.edge_vertices[slot] = index + 1;
                self.vertex_edges.push(slot);
                let [dx, dy, dz] = EDGE_MIDPOINTS[edge as usize];
                let [ox, oy, oz] = self.offset;
                let [sx, sy, sz] = self.scale;
                self.vertices.extend_from_slice(&[
                    (x as f32 + dx + ox) * sx,
                    (y as f32 + dy + oy) * sy,
                    (z as f32 + dz + oz) * sz,
                ]);
                index
            }
            stored => stored - 1,
        };
        self.indices.push(index);
    }

    /// Resets the edge table, returns it to the pool, and returns the vertices and indices.
    fn finish(mut self) -> (Vec<f32>, Vec<u32>) {
        if self.edge_vertices.len() == CACHED_EDGE_TABLE_LEN {
            for &slot in &self.vertex_edges {
                self.edge_vertices[slot] = 0;
            }
            return_edge_table(self.edge_vertices);
        }
        (self.vertices, self.indices)
    }
}

/// Emits the triangles of the cubes of one block.
fn march_block(mask: &SegmentMask, start: [usize; 3], end: [usize; 3], mesh: &mut MeshBuilder) {
    let [width, height, _] = mask.dimensions;
    let row = |y: usize, z: usize| &mask.voxels[(y + height * z) * width..][..width];
    // The four voxels of column x of the current cube row as bits 0..3, see [CUBE_INDEX].
    let mut column_buffer = [0u8; BLOCK_SIZE + 1];
    let columns = &mut column_buffer[..end[0] - start[0]];
    for z in start[2]..end[2] - 1 {
        for y in start[1]..end[1] - 1 {
            let [r00, r10, r01, r11] = [row(y, z), row(y + 1, z), row(y, z + 1), row(y + 1, z + 1)]
                .map(|row| &row[start[0]..end[0]]);
            let voxels = r00.iter().zip(r10).zip(r01).zip(r11);
            for (column, (((&v00, &v10), &v01), &v11)) in columns.iter_mut().zip(voxels) {
                *column = v00 | v10 << 1 | v01 << 2 | v11 << 3;
            }
            if columns.iter().all(|&column| column == 0) {
                continue; // no voxel of the segment around this row of cubes
            }
            for (i, pair) in columns.windows(2).enumerate() {
                let key = pair[0] | pair[1] << 4;
                if key == 0 || key == 0xff {
                    continue; // fully outside or inside: no triangles
                }
                let x = start[0] + i;
                let cube_slot = 3 * (x + width * (y + height * z));
                for &edge in TRIANGLES[CUBE_INDEX[key as usize] as usize] {
                    mesh.add([x, y, z], cube_slot, edge);
                }
            }
        }
    }
}

/// Meshes the voxels of a segment mask.
fn mesh_segment(mask: &SegmentMask, offset: [f32; 3], scale: [f32; 3]) -> Mesh {
    if !mask.occupied_blocks.contains(&true) {
        return Mesh {
            vertices: Vec::new(),
            indices: Vec::new(),
            neighbors: mask.neighbors,
        };
    }
    let [count_x, count_y, count_z] = mask.block_counts;
    let mut mesh = MeshBuilder::new(mask.dimensions, offset, scale);
    for block_x in 0..count_x {
        for block_y in 0..count_y {
            for block_z in 0..count_z {
                if !mask.occupied_blocks[block_x + count_x * (block_y + count_y * block_z)] {
                    continue;
                }
                let start = [block_x, block_y, block_z].map(|b| b * BLOCK_SIZE);
                let end =
                    [0, 1, 2].map(|axis| (start[axis] + BLOCK_SIZE + 1).min(mask.dimensions[axis]));
                march_block(mask, start, end, &mut mesh);
            }
        }
    }
    let (vertices, indices) = mesh.finish();
    Mesh {
        vertices,
        indices,
        neighbors: mask.neighbors,
    }
}

/// Meshes a cuboid like the native function, for the tests of other modules.
#[cfg(test)]
pub(crate) fn mesh_cuboid(
    cuboid: &Cuboid,
    segment_id: i64,
    offset: [f32; 3],
    scale: [f32; 3],
) -> Mesh {
    mesh_segment(&SegmentMask::new(cuboid, segment_id), offset, scale)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_services_mesh_NativeAdHocMesher_adHocMesh<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    data: JByteArray<'local>,
    bytes_per_element: jint,
    dimensions: JIntArray<'local>,
    segment_id: jlong,
    offset: JFloatArray<'local>,
    scale: JFloatArray<'local>,
    neighbors_out: JIntArray<'local>,
    indices_out: JObjectArray<'local>,
) -> JFloatArray<'local> {
    jni_util::run(env, "AdHocMesher adHocMesh", |env| {
        let dimensions = jni_util::read_array(env, &dimensions)?;
        let offset = jni_util::read_vec3(env, &offset, "offset")?;
        let scale = jni_util::read_vec3(env, &scale, "scale")?;
        if neighbors_out.len(env)? != 1 {
            return invalid_argument("neighborsOut must have one element");
        }
        if indices_out.len(env)? != 1 {
            return invalid_argument("indicesOut must have one element");
        }
        let (bytes_per_element, dimensions) =
            Cuboid::validate(data.len(env)?, bytes_per_element, &dimensions)?;
        // The cuboid is only needed to fill the mask, a single pass, so it is borrowed rather than copied. The mask
        // is allocated beforehand, so the critical section only covers that pass.
        let mut mask = SegmentMask::empty(dimensions);
        jni_util::with_bytes_critical(env, &data, |data| {
            let cuboid = Cuboid {
                data,
                bytes_per_element,
                dimensions,
            };
            mask.fill(&cuboid, segment_id)
        })?;
        let mesh = mesh_segment(&mask, offset, scale);
        neighbors_out.set_region(env, 0, &[jint::from(mesh.neighbors)])?;
        // The indices are below MAX_VOXELS * 3 <= i32::MAX.
        let indices: Vec<i32> = mesh.indices.iter().map(|&index| index as i32).collect();
        let indices = jni_util::new_int_array(env, &indices)?;
        indices_out.set_element(env, 0, &indices)?;
        jni_util::new_float_array(env, &mesh.vertices)
    })
}

#[cfg(test)]
mod tests;
