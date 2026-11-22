//! Scala ad-hoc meshing: 32-cell tiles in x/y/z order; cells inside each tile in z/y/x order.
//! Like webknossos-native's `ad_hoc_mesh.rs`, the mesh is indexed: a vertex is stored once,
//! when it is first emitted, and identified by the voxel edge it lies on, so the merging is exact.
use std::collections::HashMap;

use crate::error::{DsError, DsResult};
use crate::services::mesh::marching_cubes_table::{EDGES, TRIANGLES};

/// Scala `AdHocMesh.maxVertexCountForShortIndices`: not 65536, because WebGL 2 treats the
/// 16-bit index 65535 as primitive restart.
pub const MAX_VERTEX_COUNT_FOR_SHORT_INDICES: usize = 65535;

/// Scala `AdHocMesh`: an indexed triangle mesh of one segment in a cuboid.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AdHocMesh {
    /// Three floats per vertex, each vertex once, in the order of first use.
    pub vertices: Vec<f32>,
    /// Three vertex indices per triangle.
    pub indices: Vec<u32>,
    /// The faces of the cuboid that contain the segment (empty unless requested).
    pub neighbors: Vec<i32>,
}

impl AdHocMesh {
    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / 3
    }

    /// Three floats per vertex and three vertices per triangle, without shared vertices.
    pub fn triangle_soup(&self) -> Vec<f32> {
        self.indices
            .iter()
            .flat_map(|&index| {
                let start = 3 * index as usize;
                self.vertices[start..start + 3].iter().copied()
            })
            .collect()
    }

    /// Scala `AdHocMesh.toBytes`, little-endian. Indexed: the vertices as floats, followed by
    /// the indices as `u16` if there are at most [`MAX_VERTEX_COUNT_FOR_SHORT_INDICES`]
    /// vertices, else as `u32`. Otherwise: the triangle soup as floats.
    pub fn to_bytes(&self, indexed: bool) -> Vec<u8> {
        if !indexed {
            return self
                .triangle_soup()
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect();
        }
        let short = self.vertex_count() <= MAX_VERTEX_COUNT_FOR_SHORT_INDICES;
        let mut bytes = Vec::with_capacity(
            4 * self.vertices.len() + if short { 2 } else { 4 } * self.indices.len(),
        );
        bytes.extend(self.vertices.iter().flat_map(|v| v.to_le_bytes()));
        for &index in &self.indices {
            if short {
                bytes.extend((index as u16).to_le_bytes());
            } else {
                bytes.extend(index.to_le_bytes());
            }
        }
        bytes
    }
}

/// The triangle soup and the neighbors, see [`marching_cubes_indexed`].
pub fn marching_cubes(
    membership: &[bool],
    dimensions: [usize; 3],
    offset: [f32; 3],
    scale: [f32; 3],
    find_neighbors: bool,
) -> DsResult<(Vec<f32>, Vec<i32>)> {
    let mesh = marching_cubes_indexed(membership, dimensions, offset, scale, find_neighbors)?;
    Ok((mesh.triangle_soup(), mesh.neighbors))
}

/// For each edge of [`EDGES`], the axis it runs along and the offset of its first voxel from
/// the cube's origin corner.
fn edge_voxel(edge: usize) -> (usize, [usize; 3]) {
    let mut axis = 0;
    let mut voxel = [0; 3];
    for (d, &midpoint) in EDGES[edge].iter().enumerate() {
        let halves = (midpoint * 2.0) as usize;
        if halves == 1 {
            axis = d;
        }
        voxel[d] = halves / 2;
    }
    (axis, voxel)
}

pub fn marching_cubes_indexed(
    membership: &[bool],
    dimensions: [usize; 3],
    offset: [f32; 3],
    scale: [f32; 3],
    find_neighbors: bool,
) -> DsResult<AdHocMesh> {
    let count = dimensions.iter().try_fold(1usize, |v, d| v.checked_mul(*d));
    if dimensions.contains(&0) || count != Some(membership.len()) {
        return Err(DsError::failure("Invalid marching-cubes dimensions."));
    }
    let at = |x: usize, y: usize, z: usize| membership[x + dimensions[0] * (y + dimensions[1] * z)];
    let contains = |start: [usize; 3], end: [usize; 3]| {
        (start[0]..end[0])
            .any(|x| (start[1]..end[1]).any(|y| (start[2]..end[2]).any(|z| at(x, y, z))))
    };
    let [x, y, z] = dimensions.map(|d| d - 1);
    let surfaces = [
        ([0, 0, 0], [x, y, 1]),
        ([0, 0, 0], [x, 1, z]),
        ([0, 0, 0], [1, y, z]),
        ([0, 0, z], [x, y, z + 1]),
        ([0, y, 0], [x, y + 1, z]),
        ([x, 0, 0], [x + 1, y, z]),
    ];
    let neighbors = if find_neighbors {
        surfaces
            .iter()
            .enumerate()
            .filter(|(_, (start, end))| contains(*start, *end))
            .map(|(i, _)| i as i32)
            .collect()
    } else {
        Vec::new()
    };
    let corners = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
    ];
    let edge_voxels: [(usize, [usize; 3]); 12] = std::array::from_fn(edge_voxel);
    let mut vertices = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    // Vertex index of each voxel edge, keyed by `3 * (x + width * (y + height * z)) + axis`.
    let mut edge_vertices: HashMap<usize, u32> = HashMap::new();
    for bx in (0..dimensions[0]).step_by(32) {
        for by in (0..dimensions[1]).step_by(32) {
            for bz in (0..dimensions[2]).step_by(32) {
                let end =
                    std::array::from_fn(|d| [bx, by, bz][d].saturating_add(33).min(dimensions[d]));
                if !contains([bx, by, bz], end) {
                    continue;
                }
                for z in bz..end[2] - 1 {
                    for y in by..end[1] - 1 {
                        for x in bx..end[0] - 1 {
                            let mut cube = 0;
                            for (bit, corner) in corners.iter().enumerate() {
                                if at(x + corner[0], y + corner[1], z + corner[2]) {
                                    cube |= 1 << bit;
                                }
                            }
                            let edges = &TRIANGLES[cube];
                            let num_edges =
                                edges.iter().position(|i| *i < 0).unwrap_or(edges.len());
                            if indices
                                .len()
                                .checked_add(num_edges)
                                .is_none_or(|n| n * 3 > i32::MAX as usize / 4)
                            {
                                return Err(DsError::failure("Mesh vertex buffer is too large."));
                            }
                            indices
                                .try_reserve(num_edges)
                                .map_err(DsError::from_exception)?;
                            for &edge in &edges[..num_edges] {
                                let edge = edge as usize;
                                let (axis, [vx, vy, vz]) = edge_voxels[edge];
                                let key = 3
                                    * ((x + vx)
                                        + dimensions[0] * ((y + vy) + dimensions[1] * (z + vz)))
                                    + axis;
                                let next = (vertices.len() / 3) as u32;
                                let index = *edge_vertices.entry(key).or_insert_with(|| {
                                    for (d, coordinate) in [x, y, z].iter().enumerate() {
                                        vertices.push(
                                            (*coordinate as f32 + EDGES[edge][d] + offset[d])
                                                * scale[d],
                                        );
                                    }
                                    next
                                });
                                indices.push(index);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(AdHocMesh {
        vertices,
        indices,
        neighbors,
    })
}
