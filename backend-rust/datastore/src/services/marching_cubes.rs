//! Scala ad-hoc meshing: 32-cell tiles in x/y/z order; cells inside each tile in z/y/x order.
use super::marching_cubes_table::{EDGES, TRIANGLES};
use crate::error::{DsError, DsResult};

pub fn marching_cubes(
    membership: &[bool],
    dimensions: [usize; 3],
    offset: [f32; 3],
    scale: [f32; 3],
    find_neighbors: bool,
) -> DsResult<(Vec<f32>, Vec<i32>)> {
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
    let mut vertices = Vec::new();
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
                            let added = num_edges * 3;
                            if vertices
                                .len()
                                .checked_add(added)
                                .is_none_or(|n| n > i32::MAX as usize / 4)
                            {
                                return Err(DsError::failure("Mesh vertex buffer is too large."));
                            }
                            vertices
                                .try_reserve(added)
                                .map_err(DsError::from_exception)?;
                            for edge in &edges[..num_edges] {
                                for (d, coordinate) in [x, y, z].iter().enumerate() {
                                    vertices.push(
                                        (*coordinate as f32 + EDGES[*edge as usize][d] + offset[d])
                                            * scale[d],
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok((vertices, neighbors))
}
