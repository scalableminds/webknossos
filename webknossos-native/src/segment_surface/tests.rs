use super::*;
use crate::ad_hoc_mesh::{Mesh, mesh_cuboid};
use crate::bucket_scanner::Element;
use crate::jni_util::NativeError;

const UNIT: [f64; 3] = [1.0, 1.0, 1.0];
/// An anisotropic voxel size, like 11.24 × 11.24 × 28 nm.
const ANISOTROPIC: [f64; 3] = [11.24, 11.24, 28.0];

/// A small deterministic pseudo random generator (xorshift64*), so the tests need no dependency.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next() % bound as u64) as usize
    }

    fn chance(&mut self, probability: f64) -> bool {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64 <= probability
    }
}

/// A volume of segment ids, x fastest, as one id per voxel.
struct Volume {
    dimensions: [usize; 3],
    ids: Vec<i64>,
}

impl Volume {
    fn new(dimensions: [usize; 3], id: impl Fn(usize, usize, usize) -> i64) -> Self {
        let [width, height, depth] = dimensions;
        let mut ids = Vec::with_capacity(width * height * depth);
        for z in 0..depth {
            for y in 0..height {
                for x in 0..width {
                    ids.push(id(x, y, z));
                }
            }
        }
        Volume { dimensions, ids }
    }

    fn id(&self, [x, y, z]: [usize; 3]) -> i64 {
        let [width, height, _] = self.dimensions;
        self.ids[x + width * (y + height * z)]
    }

    /// The elements of the box `[start, end)` as `T`, x fastest.
    fn cuboid_bytes<T: Element>(&self, start: [usize; 3], end: [usize; 3]) -> Vec<u8> {
        let mut data = Vec::new();
        for z in start[2]..end[2] {
            for y in start[1]..end[1] {
                for x in start[0]..end[0] {
                    let mut element = [0u8; 8];
                    T::write(&mut element[..T::SIZE], self.id([x, y, z]));
                    data.extend_from_slice(&element[..T::SIZE]);
                }
            }
        }
        data
    }
}

/// Measures the segment in the box `[start, end)` of the volume, with the interior `[interior_start, interior_end)`
/// in coordinates of the volume.
fn measure_box(
    volume: &Volume,
    segment_id: i64,
    [start, end]: [[usize; 3]; 2],
    [interior_start, interior_end]: [[usize; 3]; 2],
    scale: [f64; 3],
) -> Surface {
    let data = volume.cuboid_bytes::<u32>(start, end);
    let dimensions = [0, 1, 2].map(|axis| (end[axis] - start[axis]) as i32);
    let cuboid = Cuboid::new(&data, 4, &dimensions).unwrap();
    let mut mask = PaddedMask::empty(cuboid.dimensions);
    mask.fill(&cuboid, segment_id);
    let interior = Interior {
        start: [0, 1, 2].map(|axis| interior_start[axis] - start[axis]),
        end: [0, 1, 2].map(|axis| interior_end[axis] - start[axis]),
    };
    measure_surface(&mask, interior, &case_areas(scale))
}

/// Measures the whole volume as a single chunk.
fn measure_whole(volume: &Volume, segment_id: i64, scale: [f64; 3]) -> Surface {
    let whole = [[0; 3], volume.dimensions];
    measure_box(volume, segment_id, whole, whole, scale)
}

/// Measures the volume chunk by chunk, as the datastore does with the buckets of the segment index: every bucket
/// with a voxel of the segment, its cuboid extended by one voxel on each side within the volume.
fn measure_by_buckets(
    volume: &Volume,
    segment_id: i64,
    bucket_length: usize,
    scale: [f64; 3],
) -> Surface {
    let bucket_counts = volume.dimensions.map(|d| d.div_ceil(bucket_length));
    let mut total = Surface {
        area: 0.0,
        voxel_count: 0,
    };
    for bz in 0..bucket_counts[2] {
        for by in 0..bucket_counts[1] {
            for bx in 0..bucket_counts[0] {
                let interior_start = [bx, by, bz].map(|b| b * bucket_length);
                let interior_end = [0, 1, 2].map(|axis| {
                    (interior_start[axis] + bucket_length).min(volume.dimensions[axis])
                });
                if !bucket_contains(volume, segment_id, interior_start, interior_end) {
                    continue; // not in the segment index
                }
                let start = interior_start.map(|s| s.saturating_sub(1));
                let end =
                    [0, 1, 2].map(|axis| (interior_end[axis] + 1).min(volume.dimensions[axis]));
                let surface = measure_box(
                    volume,
                    segment_id,
                    [start, end],
                    [interior_start, interior_end],
                    scale,
                );
                total.area += surface.area;
                total.voxel_count += surface.voxel_count;
            }
        }
    }
    total
}

fn bucket_contains(volume: &Volume, segment_id: i64, start: [usize; 3], end: [usize; 3]) -> bool {
    (start[2]..end[2]).any(|z| {
        (start[1]..end[1]).any(|y| (start[0]..end[0]).any(|x| volume.id([x, y, z]) == segment_id))
    })
}

/// The area of a mesh in f64, with the vertices (meshed at unit scale, so exact in f32) scaled in f64.
fn mesh_area(mesh: &Mesh, scale: [f64; 3]) -> f64 {
    let vertex = |index: u32| {
        let start = index as usize * 3;
        [0, 1, 2].map(|axis| f64::from(mesh.vertices[start + axis]) * scale[axis])
    };
    mesh.indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|&[a, b, c]| triangle_area(vertex(a), vertex(b), vertex(c)))
        .sum()
}

/// Meshes the box `[start, end)` of the volume like the ad-hoc mesher and returns its area.
fn mesh_box_area(
    volume: &Volume,
    segment_id: i64,
    start: [usize; 3],
    end: [usize; 3],
    scale: [f64; 3],
) -> f64 {
    let data = volume.cuboid_bytes::<u32>(start, end);
    let dimensions = [0, 1, 2].map(|axis| (end[axis] - start[axis]) as i32);
    let cuboid = Cuboid::new(&data, 4, &dimensions).unwrap();
    mesh_area(&mesh_cuboid(&cuboid, segment_id, [0.0; 3], [1.0; 3]), scale)
}

/// The volume with a border of one voxel of id 0 on each side.
fn padded(volume: &Volume) -> Volume {
    let dimensions = volume.dimensions.map(|d| d + 2);
    Volume::new(dimensions, |x, y, z| {
        let inside = [x, y, z]
            .iter()
            .zip(volume.dimensions)
            .all(|(&c, d)| c >= 1 && c <= d);
        if inside {
            volume.id([x - 1, y - 1, z - 1])
        } else {
            0
        }
    })
}

/// Random blobs of segment 7 among other ids, with their sizes and positions drawn from the seed.
fn blobs(dimensions: [usize; 3], seed: u64) -> Volume {
    let mut random = Random(seed);
    let centers: Vec<([f64; 3], f64)> = (0..12)
        .map(|_| {
            let center = dimensions.map(|d| random.below(d) as f64);
            (center, 3.0 + random.below(14) as f64)
        })
        .collect();
    let noise: Vec<bool> = (0..dimensions.iter().product::<usize>())
        .map(|_| random.chance(0.02))
        .collect();
    let [width, height, _] = dimensions;
    Volume::new(dimensions, |x, y, z| {
        let in_blob = centers.iter().any(|(center, radius)| {
            let d = [
                x as f64 - center[0],
                y as f64 - center[1],
                z as f64 - center[2],
            ];
            d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= radius * radius
        });
        // Some noise voxels, so that there are single voxels and thin structures on bucket borders, too.
        if in_blob ^ noise[x + width * (y + height * z)] {
            7
        } else {
            3
        }
    })
}

fn assert_close(actual: f64, expected: f64, relative: f64) {
    assert!(
        (actual - expected).abs() <= relative * expected.abs(),
        "{actual} differs from {expected} by more than {relative} relative"
    );
}

#[test]
fn case_areas_match_the_triangles_of_the_mesher() {
    // The corners of a cube in the order of the bits of its configuration, see triangle_table.rs.
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
    for scale in [UNIT, ANISOTROPIC, [0.5, 3.0, 7.25]] {
        let areas = case_areas(scale);
        for (case, &area) in areas.iter().enumerate() {
            let volume = Volume::new([2, 2, 2], |x, y, z| {
                let corner = corners.iter().position(|&c| c == [x, y, z]).unwrap();
                if case >> corner & 1 == 1 { 1 } else { 0 }
            });
            let meshed = mesh_box_area(&volume, 1, [0; 3], [2; 3], scale);
            assert_close(area, meshed, 1e-12);
        }
        assert_eq!(areas[0], 0.0);
        assert_eq!(areas[255], 0.0);
    }
}

#[test]
fn a_single_voxel_has_the_area_of_its_octahedron() {
    // Eight triangles, each cutting off a corner of the voxel at the midpoints of its three edges. For a voxel of
    // size a × b × c, together sqrt(a²b² + a²c² + b²c²).
    let volume = Volume::new([3, 3, 3], |x, y, z| ((x, y, z) == (1, 1, 1)) as i64);
    for [a, b, c] in [UNIT, ANISOTROPIC] {
        let surface = measure_whole(&volume, 1, [a, b, c]);
        assert_close(
            surface.area,
            (a * a * b * b + a * a * c * c + b * b * c * c).sqrt(),
            1e-12,
        );
        assert_eq!(surface.voxel_count, 1);
    }
}

#[test]
fn counts_the_border_of_the_cuboid_as_background() {
    // A single voxel in the corner of a 1³ cuboid: its cubes reach out of the cuboid, where nothing belongs to the
    // segment. So it has the same surface as a voxel surrounded by background.
    let volume = Volume::new([1, 1, 1], |_, _, _| 1);
    let surface = measure_whole(&volume, 1, UNIT);
    assert_close(surface.area, 3f64.sqrt(), 1e-12);
    assert_eq!(surface.voxel_count, 1);
}

#[test]
fn a_whole_cuboid_has_the_area_of_its_mesh() {
    for seed in 1..6 {
        let volume = blobs([37, 29, 33], seed);
        for scale in [UNIT, ANISOTROPIC] {
            let surface = measure_whole(&volume, 7, scale);
            // The mesher only meshes the cubes inside its cuboid, so it gets the border as extra voxels.
            let padded = padded(&volume);
            let meshed = mesh_box_area(&padded, 7, [0; 3], padded.dimensions, scale);
            assert_close(surface.area, meshed, 1e-12);
            let voxels = volume.ids.iter().filter(|&&id| id == 7).count() as u64;
            assert_eq!(surface.voxel_count, voxels);
        }
    }
}

#[test]
fn chunks_sum_to_the_whole_surface() {
    // Dimensions that are no multiple of the bucket length, so the last buckets are cut off.
    for (seed, bucket_length) in [(11, 32), (12, 32), (13, 16), (14, 7)] {
        let volume = blobs([90, 75, 70], seed);
        for scale in [UNIT, ANISOTROPIC] {
            let whole = measure_whole(&volume, 7, scale);
            let chunked = measure_by_buckets(&volume, 7, bucket_length, scale);
            assert_close(chunked.area, whole.area, 1e-12);
            assert_eq!(chunked.voxel_count, whole.voxel_count);
        }
    }
}

#[test]
fn chunks_include_the_cubes_below_a_bucket_whose_lower_neighbors_are_empty() {
    // A segment that fills exactly bucket (1, 1, 1), so none of the buckets below it is in the segment index. The
    // cubes that cut off its lower faces have their origin in those buckets.
    let volume = Volume::new([96, 96, 96], |x, y, z| {
        [x, y, z].iter().all(|c| (32..64).contains(c)) as i64
    });
    let whole = measure_whole(&volume, 1, UNIT);
    let chunked = measure_by_buckets(&volume, 1, 32, UNIT);
    assert_close(chunked.area, whole.area, 1e-12);
    assert_eq!(chunked.voxel_count, 32 * 32 * 32);

    // The former chunking meshed a 33³ cuboid starting at the bucket, so it missed these cubes: three of the six
    // faces of the cube and the edges and corners between them.
    let unpadded = mesh_box_area(&volume, 1, [32; 3], [65; 3], UNIT);
    assert!(unpadded < whole.area * 0.6, "{unpadded} vs {}", whole.area);
}

/// A ball of `radius` (in the unit of the voxel size), centered in a volume that just contains it.
fn ball(radius: f64, voxel_size: [f64; 3]) -> Volume {
    let dimensions = [0, 1, 2].map(|axis| (2.0 * radius / voxel_size[axis]).ceil() as usize + 4);
    let center = dimensions.map(|d| d as f64 / 2.0);
    Volume::new(dimensions, |x, y, z| {
        let voxel_center = [x, y, z].map(|c| c as f64 + 0.5);
        let squared: f64 = (0..3)
            .map(|axis| ((voxel_center[axis] - center[axis]) * voxel_size[axis]).powi(2))
            .sum();
        (squared <= radius * radius) as i64
    })
}

#[test]
fn overestimates_the_area_of_a_ball_like_the_mesh() {
    // Marching cubes on a binary mask approximates a smooth surface by facets at 0°, 45° and 90°-ish angles, so its
    // area exceeds that of a sphere by a fixed fraction that does not shrink with the radius: about 9% for cubic
    // voxels and more for anisotropic ones. The ad-hoc meshes the user sees have the same surface.
    for (voxel_size, expected_excess) in [(UNIT, 0.087), (ANISOTROPIC, 0.145)] {
        for radius_in_voxels in [10.0, 30.0, 60.0] {
            let radius = radius_in_voxels * voxel_size[0];
            let surface = measure_whole(&ball(radius, voxel_size), 1, voxel_size);
            let sphere = 4.0 * std::f64::consts::PI * radius * radius;
            assert_close(surface.area / sphere, 1.0 + expected_excess, 0.01);
            // The voxel count, in contrast, converges to the volume of the ball.
            let ball_volume = 4.0 / 3.0 * std::f64::consts::PI * radius.powi(3);
            let voxel_volume: f64 = voxel_size.iter().product();
            assert_close(surface.voxel_count as f64 * voxel_volume, ball_volume, 0.03);
        }
    }
}

#[test]
fn compares_only_the_low_bytes_of_the_segment_id() {
    let dimensions = [4, 4, 4];
    let volume = Volume::new(
        dimensions,
        |x, y, z| if (x, y, z) == (1, 2, 1) { 5 } else { 0 },
    );
    let data = volume.cuboid_bytes::<u8>([0; 3], dimensions);
    let cuboid = Cuboid::new(&data, 1, &[4, 4, 4]).unwrap();
    for (segment_id, voxels) in [(5, 1), (256 + 5, 1), (6, 0)] {
        let mut mask = PaddedMask::empty(cuboid.dimensions);
        mask.fill(&cuboid, segment_id);
        let interior = Interior {
            start: [0; 3],
            end: dimensions,
        };
        let surface = measure_surface(&mask, interior, &case_areas(UNIT));
        assert_eq!(surface.voxel_count, voxels);
        assert_eq!(surface.area > 0.0, voxels > 0);
    }
}

#[test]
fn an_empty_interior_has_no_surface() {
    let volume = Volume::new([3, 3, 3], |_, _, _| 1);
    let surface = measure_box(&volume, 1, [[0; 3], [3; 3]], [[1, 1, 1], [1, 3, 3]], UNIT);
    assert_eq!(
        surface,
        Surface {
            area: 0.0,
            voxel_count: 0
        }
    );
}

#[test]
fn rejects_invalid_interiors() {
    let message = |result: NativeResult<Interior>| match result {
        Err(NativeError::InvalidArgument(message)) => message,
        other => panic!("expected an invalid argument, got {other:?}"),
    };
    let dimensions = [4, 4, 4];
    assert!(message(Interior::new(&[0, 0], &[4, 4, 4], dimensions)).contains("three elements"));
    assert!(
        message(Interior::new(&[-1, 0, 0], &[4, 4, 4], dimensions)).contains("0 <= interiorStart")
    );
    assert!(
        message(Interior::new(&[2, 0, 0], &[1, 4, 4], dimensions)).contains("0 <= interiorStart")
    );
    assert!(message(Interior::new(&[0, 0, 0], &[4, 5, 4], dimensions)).contains("<= dimensions"));
    assert_eq!(
        Interior::new(&[1, 0, 2], &[4, 3, 2], dimensions).unwrap(),
        Interior {
            start: [1, 0, 2],
            end: [4, 3, 2]
        }
    );
}
