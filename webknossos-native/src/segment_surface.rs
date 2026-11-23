//! Native function of `NativeSegmentSurface`: the surface area and voxel count of one segment in one chunk of a
//! segmentation, for the segment statistics.
//!
//! The surface is the one the ad-hoc mesher ([crate::ad_hoc_mesh]) builds with marching cubes, but its triangles are
//! never built. Every vertex lies at the midpoint of a cube edge, so the area of a cube's triangles depends only on
//! the cube's configuration (one of 256) and the voxel size. The area of the surface is therefore a sum of table
//! lookups, one per cube, see [case_areas]. It is computed in f64 and does not depend on where the chunk lies,
//! unlike the area of f32 mesh vertices far from the origin.
//!
//! A segment is measured chunk by chunk, and the results of the chunks are summed. A chunk owns the voxels of its
//! *interior*, and the interiors of all chunks partition the dataset (the chunks are the buckets of the segment
//! index, which lists every bucket with a voxel of the segment). The cuboid of a chunk contains its interior plus
//! one voxel on each side, where the dataset has one; voxels outside of the cuboid count as not belonging to the
//! segment.
//!
//! The cubes that touch the interior (those with at least one interior voxel) are evaluated. A cube with voxels of
//! the segment adds its area times the fraction of these voxels that the chunk owns. These fractions sum to one
//! over the chunks that own a voxel of the segment in the cube, and each of those chunks has a voxel of the segment,
//! so it is measured. Summing all chunks thus counts the area of every cube exactly once, including the cubes that
//! straddle the border of two chunks, no matter which of them contain the segment.

use jni::EnvUnowned;
use std::cell::Cell;

use jni::objects::{JByteArray, JDoubleArray, JIntArray, JObject};
use jni::sys::{jint, jlong};

use crate::ad_hoc_mesh::triangle_table::{EDGE_MIDPOINTS, TRIANGLES};
use crate::ad_hoc_mesh::{CUBE_INDEX, Cuboid, mask_row};
use crate::jni_util::{self, NativeResult, invalid_argument};

/// The surface area and voxel count of a segment in a chunk.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Surface {
    /// In the unit of the scale, squared.
    pub area: f64,
    /// The voxels of the segment in the interior.
    pub voxel_count: u64,
}

/// The voxels a chunk owns: `start[axis] <= coordinate < end[axis]`, in voxels of the cuboid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Interior {
    pub start: [usize; 3],
    pub end: [usize; 3],
}

impl Interior {
    /// Validates the interior of a native call.
    fn new(start: &[i32], end: &[i32], dimensions: [usize; 3]) -> NativeResult<Self> {
        let (&[sx, sy, sz], &[ex, ey, ez]) = (start, end) else {
            return invalid_argument("interiorStart and interiorEnd must have three elements");
        };
        let mut interior = Interior {
            start: [0; 3],
            end: [0; 3],
        };
        for (axis, (start, end)) in [(sx, ex), (sy, ey), (sz, ez)].into_iter().enumerate() {
            if start < 0 || start > end || end as usize > dimensions[axis] {
                return invalid_argument(
                    "the interior must satisfy 0 <= interiorStart <= interiorEnd <= dimensions",
                );
            }
            interior.start[axis] = start as usize;
            interior.end[axis] = end as usize;
        }
        Ok(interior)
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// The area of the triangle with the given corners.
pub(crate) fn triangle_area(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> f64 {
    let u = sub(b, a);
    let v = sub(c, a);
    let cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt() / 2.0
}

/// For each cube configuration (the index of [TRIANGLES]), the total area of its triangles for voxels of the given
/// size. Cubes that are fully outside or inside the segment have no triangles and so an area of 0.
pub fn case_areas(scale: [f64; 3]) -> [f64; 256] {
    let vertex = |edge: u8| {
        let midpoint = EDGE_MIDPOINTS[edge as usize];
        [0, 1, 2].map(|axis| f64::from(midpoint[axis]) * scale[axis])
    };
    std::array::from_fn(|case| {
        TRIANGLES[case]
            .as_chunks::<3>()
            .0
            .iter()
            .map(|&[a, b, c]| triangle_area(vertex(a), vertex(b), vertex(c)))
            .sum()
    })
}

/// A 0/1 mask of the voxels of the segment in a cuboid, surrounded by a border of 0 voxels, one voxel thick. With
/// the border, the cubes around the outermost voxels of the cuboid are looked up like all others.
pub struct PaddedMask {
    voxels: Vec<u8>,
    /// Of the cuboid, without the border.
    dimensions: [usize; 3],
}

impl PaddedMask {
    /// An empty mask for a cuboid of the given dimensions, to be filled by [Self::fill].
    pub fn empty(dimensions: [usize; 3]) -> Self {
        PaddedMask {
            voxels: vec![0u8; dimensions.iter().map(|d| d + 2).product()],
            dimensions,
        }
    }

    /// Fills the empty mask in one pass over the cuboid, row by row. Does not allocate, as it runs inside a JNI
    /// critical section, see [jni_util::with_bytes_critical].
    pub fn fill(&mut self, cuboid: &Cuboid, segment_id: i64) {
        debug_assert_eq!(cuboid.dimensions, self.dimensions);
        let [width, height, depth] = cuboid.dimensions;
        let [padded_width, padded_height, _] = self.padded_dimensions();
        let row_bytes = width * cuboid.bytes_per_element;
        for z in 0..depth {
            for y in 0..height {
                let row_index = y + height * z;
                let row = &cuboid.data[row_index * row_bytes..(row_index + 1) * row_bytes];
                let start = 1 + padded_width * ((y + 1) + padded_height * (z + 1));
                let mask = &mut self.voxels[start..start + width];
                match cuboid.bytes_per_element {
                    1 => mask_row::<u8>(row, segment_id, mask),
                    2 => mask_row::<u16>(row, segment_id, mask),
                    4 => mask_row::<u32>(row, segment_id, mask),
                    _ => mask_row::<u64>(row, segment_id, mask),
                };
            }
        }
    }

    fn padded_dimensions(&self) -> [usize; 3] {
        self.dimensions.map(|d| d + 2)
    }

    /// The row of the padded mask at padded `(y, z)`.
    fn row(&self, y: usize, z: usize) -> &[u8] {
        let [padded_width, padded_height, _] = self.padded_dimensions();
        &self.voxels[(y + padded_height * z) * padded_width..][..padded_width]
    }
}

/// Measures the segment in the interior of a chunk, see the module documentation. `areas` are the [case_areas] of
/// the voxel size.
pub fn measure_surface(mask: &PaddedMask, interior: Interior, areas: &[f64; 256]) -> Surface {
    let Interior { start, end } = interior;
    if (0..3).any(|axis| start[axis] == end[axis]) {
        return Surface {
            area: 0.0,
            voxel_count: 0,
        };
    }
    // In padded coordinates (shifted by one, for the border), the interior is [start + 1, end + 1) and the cubes
    // touching it have their origin corner in [start, end]: a cube spans its origin and the next voxel.
    let inside = |axis: usize, padded: usize| padded > start[axis] && padded <= end[axis];

    let mut voxel_count = 0u64;
    for z in start[2] + 1..=end[2] {
        for y in start[1] + 1..=end[1] {
            let row = &mask.row(y, z)[start[0] + 1..=end[0]];
            voxel_count += row.iter().map(|&voxel| u64::from(voxel)).sum::<u64>();
        }
    }

    // Per cube configuration: the number of cubes whose voxels of the segment are all owned, and the sum of the
    // owned fractions of the others.
    let mut whole_cubes = [0u64; 256];
    let mut cube_fractions = [0f64; 256];
    // The four voxels of column x of the current cube row as bits 0..3, as in [CUBE_INDEX].
    let mut columns = vec![0u8; end[0] - start[0] + 2];
    for z in start[2]..=end[2] {
        for y in start[1]..=end[1] {
            let rows = [
                mask.row(y, z),
                mask.row(y + 1, z),
                mask.row(y, z + 1),
                mask.row(y + 1, z + 1),
            ]
            .map(|row| &row[start[0]..=end[0] + 1]);
            let voxels = rows[0].iter().zip(rows[1]).zip(rows[2]).zip(rows[3]);
            for (column, (((&v00, &v10), &v01), &v11)) in columns.iter_mut().zip(voxels) {
                *column = v00 | v10 << 1 | v01 << 2 | v11 << 3;
            }
            if columns.iter().all(|&column| column == 0) {
                continue; // no voxel of the segment around this row of cubes
            }
            // Which of the four rows lie in the interior, as bits 0..3 like the voxels of a column.
            let rows_inside = (inside(1, y) && inside(2, z)) as u8
                | ((inside(1, y + 1) && inside(2, z)) as u8) << 1
                | ((inside(1, y) && inside(2, z + 1)) as u8) << 2
                | ((inside(1, y + 1) && inside(2, z + 1)) as u8) << 3;
            for (i, pair) in columns.windows(2).enumerate() {
                let key = pair[0] | pair[1] << 4;
                if key == 0 || key == 0xff {
                    continue; // fully outside or inside: no triangles
                }
                let x = start[0] + i;
                let owned_voxels = if inside(0, x) { rows_inside } else { 0 }
                    | if inside(0, x + 1) {
                        rows_inside << 4
                    } else {
                        0
                    };
                let case = CUBE_INDEX[key as usize] as usize;
                let owned = key & owned_voxels;
                if owned == key {
                    whole_cubes[case] += 1;
                } else if owned != 0 {
                    cube_fractions[case] +=
                        f64::from(owned.count_ones()) / f64::from(key.count_ones());
                }
            }
        }
    }

    let area = (0..256)
        .map(|case| areas[case] * (whole_cubes[case] as f64 + cube_fractions[case]))
        .sum();
    Surface { area, voxel_count }
}

thread_local! {
    /// The [case_areas] of the last voxel size measured on this thread. All chunks of a segment, and usually all
    /// segments of a dataset, share the voxel size, so the table is rarely rebuilt.
    static CACHED_CASE_AREAS: Cell<Option<([f64; 3], [f64; 256])>> = const { Cell::new(None) };
}

/// [case_areas], reused from the last call on this thread if the voxel size is the same.
fn cached_case_areas(scale: [f64; 3]) -> [f64; 256] {
    CACHED_CASE_AREAS.with(|cache| match cache.get() {
        Some((cached_scale, areas)) if cached_scale == scale => areas,
        _ => {
            let areas = case_areas(scale);
            cache.set(Some((scale, areas)));
            areas
        }
    })
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)] // JNI signature
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_services_mesh_NativeSegmentSurface_measure<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    data: JByteArray<'local>,
    bytes_per_element: jint,
    dimensions: JIntArray<'local>,
    segment_id: jlong,
    interior_start: JIntArray<'local>,
    interior_end: JIntArray<'local>,
    scale: JDoubleArray<'local>,
) -> JDoubleArray<'local> {
    jni_util::run(env, "SegmentSurface measure", |env| {
        let dimensions = jni_util::read_array(env, &dimensions)?;
        let interior_start = jni_util::read_array(env, &interior_start)?;
        let interior_end = jni_util::read_array(env, &interior_end)?;
        let scale = jni_util::read_vec3(env, &scale, "scale")?;
        if scale.iter().any(|s| !s.is_finite() || *s <= 0.0) {
            return invalid_argument("scale must be positive");
        }
        let (bytes_per_element, dimensions) =
            Cuboid::validate(data.len(env)?, bytes_per_element, &dimensions)?;
        let interior = Interior::new(&interior_start, &interior_end, dimensions)?;
        // As in ad_hoc_mesh: the mask is allocated beforehand, so the critical section only covers the one pass.
        let mut mask = PaddedMask::empty(dimensions);
        jni_util::with_bytes_critical(env, &data, |data| {
            let cuboid = Cuboid {
                data,
                bytes_per_element,
                dimensions,
            };
            mask.fill(&cuboid, segment_id)
        })?;
        let surface = measure_surface(&mask, interior, &cached_case_areas(scale));
        // The voxel count is at most the cuboid's (below i32::MAX voxels), so it is exact as f64.
        jni_util::new_double_array(env, &[surface.area, surface.voxel_count as f64])
    })
}

#[cfg(test)]
mod tests;
