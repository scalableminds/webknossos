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
//! - The neighbors are the faces of the cuboid that contain a voxel of the segment, see [Neighbors].

mod triangle_table;

use jni::EnvUnowned;
use jni::objects::{JByteArray, JFloatArray, JIntArray, JObject};
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
    /// Three floats per vertex and three vertices per triangle.
    pub vertices: Vec<f32>,
    pub neighbors: Neighbors,
}

/// A cuboid of segment ids with its size in voxels.
#[derive(Debug, Clone, Copy)]
pub struct Cuboid<'a> {
    pub data: &'a [u8],
    pub bytes_per_element: usize,
    pub dimensions: [usize; 3],
}

impl<'a> Cuboid<'a> {
    /// Validates the arguments of a native call.
    pub fn new(data: &'a [u8], bytes_per_element: i32, dimensions: &[i32]) -> NativeResult<Self> {
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
        let expected_length = checked
            .iter()
            .try_fold(bytes_per_element as usize, |product, &d| {
                product.checked_mul(d)
            });
        if expected_length != Some(data.len()) {
            return invalid_argument(
                "data length must be the product of the dimensions times bytesPerElement",
            );
        }
        Ok(Cuboid {
            data,
            bytes_per_element: bytes_per_element as usize,
            dimensions: checked,
        })
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
fn mask_row<T: Element>(row: &[u8], segment_id: i64, mask: &mut [u8]) -> bool {
    let segment = T::read(&segment_id.to_le_bytes()[..T::SIZE]);
    let mut any = 0;
    for (out, element) in mask.iter_mut().zip(row.chunks_exact(T::SIZE)) {
        *out = (T::read(element) == segment) as u8;
        any |= *out;
    }
    any != 0
}

impl SegmentMask {
    /// Builds the mask in one pass over the cuboid, row by row.
    fn new(cuboid: &Cuboid, segment_id: i64) -> Self {
        let [width, height, depth] = cuboid.dimensions;
        let block_counts = cuboid.dimensions.map(|d| d.div_ceil(BLOCK_SIZE));
        let mut voxels = vec![0u8; width * height * depth];
        let mut occupied_blocks = vec![false; block_counts.iter().product()];
        let mut neighbors: Neighbors = 0;
        // Which x-blocks the current row touches.
        let mut row_blocks = vec![false; block_counts[0]];
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
                for (block_x, touched) in row_blocks.iter_mut().enumerate() {
                    let start = block_x * BLOCK_SIZE;
                    let end = (start + BLOCK_SIZE + 1).min(width);
                    *touched = mask[start..end].contains(&1);
                }
                let (first_y, last_y) = blocks_containing(y);
                let (first_z, last_z) = blocks_containing(z);
                for block_z in first_z..=last_z {
                    for block_y in first_y..=last_y {
                        let plane_start = block_counts[0] * (block_y + block_counts[1] * block_z);
                        let plane =
                            &mut occupied_blocks[plane_start..plane_start + block_counts[0]];
                        for (occupied, &touched) in plane.iter_mut().zip(&row_blocks) {
                            *occupied |= touched;
                        }
                    }
                }
            }
        }

        SegmentMask {
            voxels,
            dimensions: cuboid.dimensions,
            block_counts,
            occupied_blocks,
            neighbors,
        }
    }
}

/// The cube index of [TRIANGLES] for each combination of two neighboring columns of four voxels: bits 0..3 of the
/// key are the voxels at x of the rows (y, z), (y + 1, z), (y, z + 1) and (y + 1, z + 1), bits 4..7 the same at
/// x + 1.
const CUBE_INDEX: [u8; 256] = {
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

/// Emits the triangles of the cubes of one block.
fn march_block(
    mask: &SegmentMask,
    start: [usize; 3],
    end: [usize; 3],
    offset: [f32; 3],
    scale: [f32; 3],
    vertices: &mut Vec<f32>,
) {
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
                let x = (start[0] + i) as f32;
                let (y, z) = (y as f32, z as f32);
                for &edge in TRIANGLES[CUBE_INDEX[key as usize] as usize] {
                    let [dx, dy, dz] = EDGE_MIDPOINTS[edge as usize];
                    vertices.extend_from_slice(&[
                        (x + dx + offset[0]) * scale[0],
                        (y + dy + offset[1]) * scale[1],
                        (z + dz + offset[2]) * scale[2],
                    ]);
                }
            }
        }
    }
}

/// Meshes the voxels of a segment mask.
fn mesh_segment(mask: &SegmentMask, offset: [f32; 3], scale: [f32; 3]) -> Mesh {
    let [count_x, count_y, count_z] = mask.block_counts;
    let mut vertices = Vec::new();
    for block_x in 0..count_x {
        for block_y in 0..count_y {
            for block_z in 0..count_z {
                if !mask.occupied_blocks[block_x + count_x * (block_y + count_y * block_z)] {
                    continue;
                }
                let start = [block_x, block_y, block_z].map(|b| b * BLOCK_SIZE);
                let end =
                    [0, 1, 2].map(|axis| (start[axis] + BLOCK_SIZE + 1).min(mask.dimensions[axis]));
                march_block(mask, start, end, offset, scale, &mut vertices);
            }
        }
    }
    Mesh {
        vertices,
        neighbors: mask.neighbors,
    }
}

fn read_vec3_f32(env: &jni::Env, array: &JFloatArray, name: &str) -> NativeResult<[f32; 3]> {
    let values = jni_util::read_array(env, array)?;
    match values[..] {
        [x, y, z] => Ok([x, y, z]),
        _ => invalid_argument(format!("{name} must have three elements")),
    }
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
) -> JFloatArray<'local> {
    jni_util::run(env, "AdHocMesher adHocMesh", |env| {
        let dimensions = jni_util::read_array(env, &dimensions)?;
        let offset = read_vec3_f32(env, &offset, "offset")?;
        let scale = read_vec3_f32(env, &scale, "scale")?;
        if neighbors_out.len(env)? != 1 {
            return invalid_argument("neighborsOut must have one element");
        }
        // The cuboid is only needed to build the mask, a single pass, so it is borrowed rather than copied.
        let mask = jni_util::with_bytes_critical(env, &data, |data| {
            Cuboid::new(data, bytes_per_element, &dimensions)
                .map(|cuboid| SegmentMask::new(&cuboid, segment_id))
        })??;
        let mesh = mesh_segment(&mask, offset, scale);
        neighbors_out.set_region(env, 0, &[jint::from(mesh.neighbors)])?;
        jni_util::new_float_array(env, &mesh.vertices)
    })
}

#[cfg(test)]
mod tests;
