use std::collections::HashMap;

use super::*;
use crate::jni_util::NativeError;

const ORIGIN: [f32; 3] = [0.0, 0.0, 0.0];
const UNIT: [f32; 3] = [1.0, 1.0, 1.0];

/// Meshes the voxels of `segment_id` (its low `bytes_per_element` bytes) in the cuboid, like the native function.
fn ad_hoc_mesh(cuboid: &Cuboid, segment_id: i64, offset: [f32; 3], scale: [f32; 3]) -> Mesh {
    mesh_segment(&SegmentMask::new(cuboid, segment_id), offset, scale)
}

/// A cuboid of `T` elements with the given voxels set to `segment` and all others to `other`.
fn volume<T: Element>(
    dimensions: [usize; 3],
    segment: i64,
    other: i64,
    inside: impl Fn(usize, usize, usize) -> bool,
) -> Vec<u8> {
    let [width, height, depth] = dimensions;
    let mut data = vec![0u8; width * height * depth * T::SIZE];
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                let index = (x + width * (y + height * z)) * T::SIZE;
                let value = if inside(x, y, z) { segment } else { other };
                T::write(&mut data[index..index + T::SIZE], value);
            }
        }
    }
    data
}

fn mesh_of(data: &[u8], bytes_per_element: i32, dimensions: [usize; 3], segment_id: i64) -> Mesh {
    let dimensions = dimensions.map(|d| d as i32);
    let cuboid = Cuboid::new(data, bytes_per_element, &dimensions).unwrap();
    ad_hoc_mesh(&cuboid, segment_id, ORIGIN, UNIT)
}

/// Three floats per vertex and three vertices per triangle, without shared vertices, as [reference_mesh] returns
/// them.
fn triangle_soup(mesh: &Mesh) -> Vec<f32> {
    mesh.indices
        .iter()
        .flat_map(|&index| {
            let start = index as usize * 3;
            mesh.vertices[start..start + 3].iter().copied()
        })
        .collect()
}

/// Asserts that each vertex is stored once and used by a triangle, and that the indices form whole triangles.
fn assert_vertices_unique_and_used(mesh: &Mesh) {
    assert_eq!(mesh.vertices.len() % 3, 0);
    assert_eq!(mesh.indices.len() % 3, 0);
    let vertices = mesh.vertices.as_chunks::<3>().0;
    let distinct: std::collections::HashSet<_> =
        vertices.iter().map(|v| v.map(f32::to_bits)).collect();
    assert_eq!(distinct.len(), vertices.len(), "duplicate vertex");
    let mut used = vec![false; vertices.len()];
    for &index in &mesh.indices {
        used[index as usize] = true;
    }
    assert!(used.iter().all(|&u| u), "unused vertex");
    // Vertices are stored in the order of first use.
    let mut next = 0;
    for &index in &mesh.indices {
        assert!(index <= next);
        if index == next {
            next += 1;
        }
    }
}

/// A direct port of the former Scala implementation (per-block search, eight lookups per cube), as reference.
/// Returns the triangle soup and the neighbors.
fn reference_mesh(
    cuboid: &Cuboid,
    segment_id: i64,
    offset: [f32; 3],
    scale: [f32; 3],
) -> (Vec<f32>, Neighbors) {
    let [width, height, depth] = cuboid.dimensions;
    let size = cuboid.bytes_per_element;
    let low_mask = if size == 8 {
        u64::MAX
    } else {
        (1u64 << (8 * size)) - 1
    };
    let segment = segment_id as u64 & low_mask;
    let voxel = |x: usize, y: usize, z: usize| {
        let index = (x + width * (y + height * z)) * size;
        let mut bytes = [0u8; 8];
        bytes[..size].copy_from_slice(&cuboid.data[index..index + size]);
        u64::from_le_bytes(bytes) == segment
    };
    let contains = |start: [usize; 3], end: [usize; 3]| {
        (start[0]..end[0])
            .any(|x| (start[1]..end[1]).any(|y| (start[2]..end[2]).any(|z| voxel(x, y, z))))
    };
    let (mx, my, mz) = (width - 1, height - 1, depth - 1);
    let faces = [
        ([0, 0, 0], [mx, my, 1]),
        ([0, 0, 0], [mx, 1, mz]),
        ([0, 0, 0], [1, my, mz]),
        ([0, 0, mz], [mx, my, mz + 1]),
        ([0, my, 0], [mx, my + 1, mz]),
        ([mx, 0, 0], [mx + 1, my, mz]),
    ];
    let mut neighbors = 0;
    for (index, (start, end)) in faces.into_iter().enumerate() {
        if contains(start, end) {
            neighbors |= 1 << index;
        }
    }
    let mut vertices = Vec::new();
    for bx in (0..width).step_by(BLOCK_SIZE) {
        for by in (0..height).step_by(BLOCK_SIZE) {
            for bz in (0..depth).step_by(BLOCK_SIZE) {
                let start = [bx, by, bz];
                let end = [
                    bx + (width - bx).min(BLOCK_SIZE + 1),
                    by + (height - by).min(BLOCK_SIZE + 1),
                    bz + (depth - bz).min(BLOCK_SIZE + 1),
                ];
                if !contains(start, end) {
                    continue;
                }
                for z in start[2]..end[2] - 1 {
                    for y in start[1]..end[1] - 1 {
                        for x in start[0]..end[0] - 1 {
                            let corners = [
                                (x, y, z),
                                (x + 1, y, z),
                                (x + 1, y + 1, z),
                                (x, y + 1, z),
                                (x, y, z + 1),
                                (x + 1, y, z + 1),
                                (x + 1, y + 1, z + 1),
                                (x, y + 1, z + 1),
                            ];
                            let cube = corners.iter().enumerate().fold(
                                0,
                                |index, (bit, &(cx, cy, cz))| {
                                    index | ((voxel(cx, cy, cz) as usize) << bit)
                                },
                            );
                            for &edge in TRIANGLES[cube] {
                                let delta = EDGE_MIDPOINTS[edge as usize];
                                vertices.push((x as f32 + delta[0] + offset[0]) * scale[0]);
                                vertices.push((y as f32 + delta[1] + offset[1]) * scale[1]);
                                vertices.push((z as f32 + delta[2] + offset[2]) * scale[2]);
                            }
                        }
                    }
                }
            }
        }
    }
    (vertices, neighbors)
}

/// A small deterministic pseudo random generator (xorshift64*), so the tests need no dependency.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn chance(&mut self, probability: f64) -> bool {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64 <= probability
    }
}

fn triangles(vertices: &[f32]) -> Vec<[[u32; 3]; 3]> {
    vertices
        .as_chunks::<9>()
        .0
        .iter()
        .map(|t| [0, 1, 2].map(|v| [0, 1, 2].map(|axis| t[3 * v + axis].to_bits())))
        .collect()
}

/// Asserts that every edge of the mesh is shared by exactly two triangles (in opposite directions, as the
/// triangles of a consistently oriented closed surface are).
fn assert_watertight(vertices: &[f32]) {
    let mut edges: HashMap<([u32; 3], [u32; 3]), usize> = HashMap::new();
    for triangle in triangles(vertices) {
        for i in 0..3 {
            *edges
                .entry((triangle[i], triangle[(i + 1) % 3]))
                .or_default() += 1;
        }
    }
    assert!(!edges.is_empty());
    for (&(from, to), &count) in &edges {
        assert_eq!(count, 1, "directed edge used {count} times");
        assert_eq!(
            edges.get(&(to, from)),
            Some(&1),
            "edge without opposite edge"
        );
    }
}

#[test]
fn single_voxel_gives_a_closed_octahedron() {
    let dimensions = [3, 3, 3];
    let data = volume::<u32>(dimensions, 7, 0, |x, y, z| (x, y, z) == (1, 1, 1));
    let mesh = mesh_of(&data, 4, dimensions, 7);
    assert_eq!(mesh.indices.len(), 8 * 3); // one triangle per cube around the voxel
    assert_eq!(mesh.vertices.len(), 6 * 3);
    assert_eq!(mesh.neighbors, 0);
    assert_vertices_unique_and_used(&mesh);
    assert_watertight(&triangle_soup(&mesh));
    for vertex in mesh.vertices.as_chunks::<3>().0 {
        let distance: f32 = vertex.iter().map(|c| (c - 1.0).abs()).sum();
        assert_eq!(distance, 0.5);
    }
}

#[test]
fn applies_offset_and_scale_in_f32() {
    let dimensions = [3, 3, 3];
    let data = volume::<u8>(dimensions, 1, 0, |x, y, z| (x, y, z) == (1, 1, 1));
    let cuboid = Cuboid::new(&data, 1, &[3, 3, 3]).unwrap();
    let offset = [3072.0, -17.5, 1.0e6];
    let scale = [11.24, 0.1, 28.0];
    let plain = ad_hoc_mesh(&cuboid, 1, ORIGIN, UNIT);
    let transformed = ad_hoc_mesh(&cuboid, 1, offset, scale);
    for (i, (&p, &t)) in plain.vertices.iter().zip(&transformed.vertices).enumerate() {
        assert_eq!(t.to_bits(), ((p + offset[i % 3]) * scale[i % 3]).to_bits());
    }
}

#[test]
fn empty_and_full_cuboids_have_no_triangles() {
    let dimensions = [40, 33, 35];
    let empty = volume::<u16>(dimensions, 5, 6, |_, _, _| false);
    assert_eq!(
        mesh_of(&empty, 2, dimensions, 5),
        Mesh {
            vertices: vec![],
            indices: vec![],
            neighbors: 0
        }
    );
    let full = volume::<u16>(dimensions, 5, 6, |_, _, _| true);
    assert_eq!(
        mesh_of(&full, 2, dimensions, 5),
        Mesh {
            vertices: vec![],
            indices: vec![],
            neighbors: 0b111111
        }
    );
}

#[test]
fn a_single_voxel_cuboid_has_no_cubes_and_no_faces() {
    // All faces of a 1×1×1 cuboid are empty, as they exclude their last row and column.
    for bytes_per_element in [1, 2, 4, 8] {
        let data = vec![3u8; bytes_per_element];
        let segment_id = i64::from_le_bytes([3; 8]);
        let mesh = mesh_of(&data, bytes_per_element as i32, [1, 1, 1], segment_id);
        assert_eq!(
            mesh,
            Mesh {
                vertices: vec![],
                indices: vec![],
                neighbors: 0
            }
        );
    }
}

#[test]
fn faces_exclude_their_last_row_and_column() {
    let dimensions = [4, 5, 6];
    let corner = volume::<u8>(dimensions, 1, 0, |x, y, z| (x, y, z) == (3, 4, 5));
    assert_eq!(mesh_of(&corner, 1, dimensions, 1).neighbors, 0);
    let origin = volume::<u8>(dimensions, 1, 0, |x, y, z| (x, y, z) == (0, 0, 0));
    assert_eq!(mesh_of(&origin, 1, dimensions, 1).neighbors, 0b000111);
    let back_x = volume::<u8>(dimensions, 1, 0, |x, y, z| (x, y, z) == (3, 1, 1));
    assert_eq!(mesh_of(&back_x, 1, dimensions, 1).neighbors, 0b100000);
    let back_z = volume::<u8>(dimensions, 1, 0, |x, y, z| (x, y, z) == (1, 1, 5));
    assert_eq!(mesh_of(&back_z, 1, dimensions, 1).neighbors, 0b001000);
    let back_y = volume::<u8>(dimensions, 1, 0, |x, y, z| (x, y, z) == (1, 4, 1));
    assert_eq!(mesh_of(&back_y, 1, dimensions, 1).neighbors, 0b010000);
}

#[test]
fn a_ball_is_watertight_for_all_element_sizes() {
    let dimensions = [65, 17, 40];
    let inside = |x: usize, y: usize, z: usize| {
        let d = |c: usize, center: f64, radius: f64| (c as f64 - center) / radius;
        d(x, 32.0, 25.0).powi(2) + d(y, 8.0, 6.5).powi(2) + d(z, 20.0, 15.0).powi(2) <= 1.0
    };
    let meshes = [
        mesh_of(&volume::<u8>(dimensions, 9, 3, inside), 1, dimensions, 9),
        mesh_of(&volume::<u16>(dimensions, 9, 3, inside), 2, dimensions, 9),
        mesh_of(&volume::<u32>(dimensions, 9, 3, inside), 4, dimensions, 9),
        mesh_of(&volume::<u64>(dimensions, 9, 3, inside), 8, dimensions, 9),
    ];
    assert_watertight(&triangle_soup(&meshes[0]));
    assert_vertices_unique_and_used(&meshes[0]);
    assert_eq!(meshes[0].neighbors, 0);
    for mesh in &meshes[1..] {
        assert_eq!(mesh, &meshes[0]);
    }
}

#[test]
fn compares_only_the_low_bytes_of_the_segment_id() {
    let dimensions = [5, 5, 5];
    let inside = |x, y, z| (x, y, z) == (2, 2, 2);
    let high_bits = 0x7a5b_3c2d_0000_0000_i64;
    for (data, bytes_per_element, raw) in [
        (volume::<u8>(dimensions, 0xab, 0, inside), 1, 0xab),
        (volume::<u16>(dimensions, 0xabcd, 0, inside), 2, 0xabcd),
        (
            volume::<u32>(dimensions, 0xab_cdef, 0, inside),
            4,
            0xab_cdef,
        ),
    ] {
        let mesh = mesh_of(&data, bytes_per_element, dimensions, high_bits | raw);
        assert_eq!(mesh, mesh_of(&data, bytes_per_element, dimensions, raw));
        assert_eq!(mesh.indices.len(), 8 * 3);
    }
    // Values whose topmost bit is set (negative if read as signed) match as well.
    let data = volume::<u64>(dimensions, -2, 0, inside);
    assert_eq!(mesh_of(&data, 8, dimensions, -2).indices.len(), 8 * 3);
    assert!(
        mesh_of(&data, 8, dimensions, 0xff_ffff_fffe)
            .vertices
            .is_empty()
    );
}

#[test]
fn matches_the_reference_on_random_volumes() {
    let mut random = Random(0x5eed);
    let dimension_list = [
        [1, 1, 1],
        [2, 2, 2],
        [1, 5, 7],
        [6, 5, 1],
        [32, 32, 32],
        [33, 33, 33],
        [34, 33, 32],
        [65, 17, 40],
        [17, 65, 9],
        [100, 3, 50],
        [97, 2, 66],
    ];
    for dimensions in dimension_list {
        for density in [0.0, 0.001, 0.05, 0.3, 0.7, 0.99, 1.0] {
            for bytes_per_element in [1, 2, 4, 8] {
                let voxel_count: usize = dimensions.iter().product();
                let mut data = vec![0u8; voxel_count * bytes_per_element];
                let segment_id = random.next() as i64;
                for element in data.chunks_exact_mut(bytes_per_element) {
                    let value = if random.chance(density) {
                        segment_id
                    } else {
                        random.next() as i64 % 3
                    };
                    element.copy_from_slice(&value.to_le_bytes()[..bytes_per_element]);
                }
                let cuboid = Cuboid::new(
                    &data,
                    bytes_per_element as i32,
                    &dimensions.map(|d| d as i32),
                )
                .unwrap();
                let offset = [random.next() as u16 as f32 * 0.25, -3.5, 1.0e5];
                let scale = [11.24, 0.3, 28.0];
                let (expected_soup, expected_neighbors) =
                    reference_mesh(&cuboid, segment_id, offset, scale);
                let actual = ad_hoc_mesh(&cuboid, segment_id, offset, scale);
                assert_eq!(
                    actual.neighbors, expected_neighbors,
                    "{dimensions:?} {density} {bytes_per_element}"
                );
                assert_vertices_unique_and_used(&actual);
                let bits = |v: &[f32]| v.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
                assert!(
                    bits(&triangle_soup(&actual)) == bits(&expected_soup),
                    "{dimensions:?} {density} {bytes_per_element}"
                );
            }
        }
    }
}

fn invalid_argument_message<T: std::fmt::Debug>(result: NativeResult<T>) -> String {
    match result {
        Err(NativeError::InvalidArgument(message)) => message,
        other => panic!("expected an invalid argument error, got {other:?}"),
    }
}

#[test]
fn rejects_invalid_arguments() {
    let data = [0u8; 24];
    assert!(Cuboid::new(&data, 4, &[2, 3, 1]).is_ok());
    for bytes_per_element in [0, 3, -1, 16] {
        let message = invalid_argument_message(Cuboid::new(&data, bytes_per_element, &[2, 3, 1]));
        assert!(message.contains("bytesPerElement"), "{message}");
    }
    for dimensions in [&[2, 3][..], &[2, 3, 1, 1][..], &[][..]] {
        let message = invalid_argument_message(Cuboid::new(&data, 4, dimensions));
        assert!(message.contains("three"), "{message}");
    }
    for dimensions in [[0, 3, 1], [2, -3, -1], [i32::MIN, 1, 1]] {
        let message = invalid_argument_message(Cuboid::new(&data, 4, &dimensions));
        assert!(message.contains("positive"), "{message}");
    }
    for (bytes_per_element, dimensions) in [(4, [2, 3, 2]), (8, [2, 3, 1]), (1, [2, 3, 1])] {
        let message = invalid_argument_message(Cuboid::new(&data, bytes_per_element, &dimensions));
        assert!(message.contains("data length"), "{message}");
    }
    // The vertex indices must fit into a Java int.
    for dimensions in [[i32::MAX; 3], [1000, 1000, 1000]] {
        let message = invalid_argument_message(Cuboid::new(&data, 1, &dimensions));
        assert!(message.contains("at most"), "{message}");
    }
}

/// The triangles of a triangle soup as their vertices' bits, sorted, to compare meshes regardless of triangle order.
fn sorted_triangles(soup: &[f32]) -> Vec<[[u32; 3]; 3]> {
    let mut triangles = triangles(soup);
    triangles.sort_unstable();
    triangles
}

/// Meshes the given buckets of a u8 volume one by one, as the datastore meshes a segment from its segment index: each
/// bucket's cuboid spans the bucket plus one voxel at its high end, so it meshes the cubes whose origin lies in it.
fn mesh_buckets(
    data: &[u8],
    dimensions: [usize; 3],
    bucket_length: usize,
    buckets: &std::collections::BTreeSet<[usize; 3]>,
    segment_id: i64,
) -> Vec<f32> {
    let [width, height, _] = dimensions;
    let mut soup = Vec::new();
    for bucket in buckets {
        let start = bucket.map(|b| b * bucket_length);
        let end = [0, 1, 2].map(|axis| (start[axis] + bucket_length + 1).min(dimensions[axis]));
        let mut cuboid = Vec::new();
        for z in start[2]..end[2] {
            for y in start[1]..end[1] {
                let row = start[0] + width * (y + height * z);
                cuboid.extend_from_slice(&data[row..row + end[0] - start[0]]);
            }
        }
        let size = [0, 1, 2].map(|axis| (end[axis] - start[axis]) as i32);
        let cuboid = Cuboid::new(&cuboid, 1, &size).unwrap();
        let offset = start.map(|s| s as f32);
        soup.extend(triangle_soup(&ad_hoc_mesh(
            &cuboid, segment_id, offset, UNIT,
        )));
    }
    soup
}

#[test]
fn meshing_the_segment_buckets_and_their_lower_neighbors_gives_the_whole_mesh() {
    // A cube's triangles come from the bucket of its origin corner, which can lie one bucket below the buckets that
    // contain the segment (in x, y, z or diagonally) without containing a voxel of the segment itself.
    let bucket_length = 8;
    let dimensions = [43, 37, 30];
    let mut random = Random(23);
    let balls: Vec<([f64; 3], f64)> = (0..7)
        .map(|_| {
            let center = dimensions.map(|d| 4.0 + (random.next() % (d as u64 - 8)) as f64);
            (center, 1.5 + (random.next() % 5) as f64)
        })
        .collect();
    let data = volume::<u8>(dimensions, 1, 0, |x, y, z| {
        let [width, height, depth] = dimensions;
        // The border stays background, so that the whole volume's mesh is closed.
        if x == 0 || y == 0 || z == 0 || x == width - 1 || y == height - 1 || z == depth - 1 {
            return false;
        }
        // A cube filling exactly bucket (2, 2, 2): none of the buckets below it contains the segment.
        let in_bucket = [x, y, z].iter().all(|c| (16..24).contains(c));
        in_bucket
            || balls.iter().any(|(center, radius)| {
                let d = [
                    x as f64 - center[0],
                    y as f64 - center[1],
                    z as f64 - center[2],
                ];
                d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= radius * radius
            })
    });
    let whole = triangle_soup(&mesh_of(&data, 1, dimensions, 1));
    assert_watertight(&whole);

    let [width, height, depth] = dimensions;
    let mut segment_buckets = std::collections::BTreeSet::new();
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                if data[x + width * (y + height * z)] == 1 {
                    segment_buckets.insert([x, y, z].map(|c| c / bucket_length));
                }
            }
        }
    }
    let mut with_lower_neighbors = std::collections::BTreeSet::new();
    for bucket in &segment_buckets {
        for d in 0..8 {
            let offset = [d & 1, d >> 1 & 1, d >> 2 & 1];
            if (0..3).all(|axis| bucket[axis] >= offset[axis]) {
                with_lower_neighbors.insert([0, 1, 2].map(|axis| bucket[axis] - offset[axis]));
            }
        }
    }
    assert!(with_lower_neighbors.len() > segment_buckets.len());

    let chunked = mesh_buckets(&data, dimensions, bucket_length, &with_lower_neighbors, 1);
    assert_eq!(sorted_triangles(&chunked), sorted_triangles(&whole));

    // Meshing only the segment's own buckets misses triangles: the mesh has holes.
    let own_buckets_only = mesh_buckets(&data, dimensions, bucket_length, &segment_buckets, 1);
    assert!(triangles(&own_buckets_only).len() < triangles(&whole).len());
}
