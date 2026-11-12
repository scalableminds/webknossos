use super::*;
use draco_core::{
    DataType, EncoderBuffer, EncoderOptions, FaceIndex, MeshEncoder, PointCloud, PointCloudEncoder,
    PointIndex,
};
use std::time::{Duration, Instant};

const IDENTITY: ([f32; 3], [f64; 3]) = ([0.0; 3], [1.0; 3]);

fn attribute(attribute_type: GeometryAttributeType, values: &[[f32; 3]]) -> PointAttribute {
    let mut attribute = PointAttribute::new();
    attribute.init(attribute_type, 3, DataType::Float32, false, values.len());
    let floats: Vec<f32> = values.iter().flatten().copied().collect();
    attribute.buffer_mut().update_f32s_le(0, &floats);
    attribute
}

/// Encodes a single-triangle mesh losslessly (sequential encoding, positions not quantized).
fn encode_triangle(attribute_type: GeometryAttributeType, corners: [[f32; 3]; 3]) -> Vec<u8> {
    let mut mesh = Mesh::new();
    mesh.add_attribute(attribute(attribute_type, &corners));
    mesh.set_num_faces(1);
    mesh.set_face(FaceIndex(0), [PointIndex(0), PointIndex(1), PointIndex(2)]);
    let mut options = EncoderOptions::new();
    options.set_encoding_method(0); // MESH_SEQUENTIAL_ENCODING
    let mut encoder = MeshEncoder::new();
    encoder.set_mesh(mesh);
    let mut buffer = EncoderBuffer::new();
    encoder.encode(&options, &mut buffer).unwrap();
    buffer.data().to_vec()
}

fn floats(stl: &[u8]) -> Vec<f32> {
    assert_eq!(stl.len() % STL_FACE_SIZE, 0);
    stl.as_chunks::<STL_FACE_SIZE>()
        .0
        .iter()
        .flat_map(|face| {
            assert_eq!(&face[48..], &[0, 0]);
            face[..48]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|bytes| f32::from_le_bytes(*bytes))
        })
        .collect()
}

#[test]
fn converts_a_triangle() {
    let input = encode_triangle(
        GeometryAttributeType::Position,
        [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 3.0, 0.0]],
    );
    let stl = draco_to_stl(&input, IDENTITY.0, IDENTITY.1, 0).unwrap();
    assert_eq!(stl.len(), STL_FACE_SIZE);
    #[rustfmt::skip]
    assert_eq!(floats(&stl), [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 3.0, 0.0]);

    // Offset in f32, then scale in f64; the normal is computed before.
    let stl = draco_to_stl(&input, [1.5, -2.0, 0.1], [0.1, 2.0, 3.0], 0).unwrap();
    let transform = |p: [f32; 3]| {
        [
            (f64::from(p[0] + 1.5) * 0.1) as f32,
            (f64::from(p[1] - 2.0) * 2.0) as f32,
            (f64::from(p[2] + 0.1f32) * 3.0) as f32,
        ]
    };
    let mut expected = vec![0.0, 0.0, 1.0];
    for corner in [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 3.0, 0.0]] {
        expected.extend(transform(corner));
    }
    assert_eq!(floats(&stl), expected);
}

#[test]
fn requantizes_the_lower_16_bits_of_each_coordinate() {
    // Lower 16 bits 1023, 0 and 0xffff, with arbitrary upper bits.
    let a = f32::from_bits(0x4000_03ff);
    let b = f32::from_bits(0x4000_0000);
    let c = f32::from_bits(0x3f80_ffff);
    let input = encode_triangle(
        GeometryAttributeType::Position,
        [[a, b, b], [b, a, b], [b, b, c]],
    );
    let stl = draco_to_stl(&input, IDENTITY.0, IDENTITY.1, 10).unwrap();
    let high = (65535.0f64 / 1023.0) as f32;
    let values = floats(&stl);
    #[rustfmt::skip]
    assert_eq!(values[3..], [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, high]);
    // The normal is computed from the requantized positions: (high, high, 1) normalized.
    let length = (2.0 * high * high + 1.0).sqrt();
    assert!((values[0] - high / length).abs() < 1e-6 && values[0] == values[1]);
    assert!((values[2] - 1.0 / length).abs() < 1e-6);

    let stl = draco_to_stl(&input, IDENTITY.0, IDENTITY.1, 16).unwrap();
    let low = (1023.0 / 65535.0f64) as f32;
    #[rustfmt::skip]
    assert_eq!(floats(&stl)[3..], [low, 0.0, 0.0, 0.0, low, 0.0, 0.0, 0.0, 1.0]);
}

#[test]
fn keeps_the_normal_of_a_degenerate_face_zero() {
    let input = encode_triangle(
        GeometryAttributeType::Position,
        [[1.0, 1.0, 1.0], [2.0, 2.0, 2.0], [3.0, 3.0, 3.0]],
    );
    let stl = draco_to_stl(&input, IDENTITY.0, IDENTITY.1, 0).unwrap();
    assert_eq!(floats(&stl)[..3], [0.0, 0.0, 0.0]);
}

#[test]
fn rejects_a_mesh_without_positions() {
    let input = encode_triangle(
        GeometryAttributeType::Generic,
        [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 3.0, 0.0]],
    );
    assert!(decode_mesh(&input).is_ok());
    assert!(draco_to_stl(&input, IDENTITY.0, IDENTITY.1, 0).is_err());
}

#[test]
fn rejects_point_clouds() {
    let mut cloud = PointCloud::new();
    cloud.add_attribute(attribute(
        GeometryAttributeType::Position,
        &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
    ));
    cloud.set_num_points(2);
    let mut encoder = PointCloudEncoder::new();
    encoder.set_point_cloud(cloud);
    let mut buffer = EncoderBuffer::new();
    encoder.encode(&EncoderOptions::new(), &mut buffer).unwrap();
    assert!(draco_to_stl(buffer.data(), IDENTITY.0, IDENTITY.1, 0).is_err());
}

#[test]
fn rejects_invalid_input() {
    let (_, input) = &corpus()[0];
    for invalid in [&[][..], b"DRACO", &input[..8], &input[..input.len() / 2]] {
        assert!(draco_to_stl(invalid, IDENTITY.0, IDENTITY.1, 0).is_err());
    }
}

/// A closed UV sphere (`rings` × `segments` quads around two poles) or, if `closed` is false, a height field grid
/// of `rings` × `segments` quads, both with wavy positions so that the prediction schemes have something to do.
fn wavy_mesh(rings: usize, segments: usize, closed: bool) -> Mesh {
    let mut positions = Vec::new();
    let mut faces = Vec::new();
    if closed {
        positions.push([0.0, 0.0, 50.0]);
        for ring in 1..rings {
            let theta = std::f32::consts::PI * ring as f32 / rings as f32;
            for segment in 0..segments {
                let phi = std::f32::consts::TAU * segment as f32 / segments as f32;
                let radius = 50.0 + 4.0 * (3.0 * phi).sin() * (2.0 * theta).cos();
                positions.push([
                    radius * theta.sin() * phi.cos() + 1000.0,
                    radius * theta.sin() * phi.sin() - 300.0,
                    radius * theta.cos(),
                ]);
            }
        }
        positions.push([0.0, 0.0, -50.0]);
        let last = positions.len() - 1;
        let at = |ring: usize, segment: usize| 1 + (ring - 1) * segments + segment % segments;
        for segment in 0..segments {
            faces.push([0, at(1, segment), at(1, segment + 1)]);
            faces.push([last, at(rings - 1, segment + 1), at(rings - 1, segment)]);
            for ring in 1..rings - 1 {
                let (a, b) = (at(ring, segment), at(ring, segment + 1));
                let (c, d) = (at(ring + 1, segment), at(ring + 1, segment + 1));
                faces.push([a, c, b]);
                faces.push([b, c, d]);
            }
        }
    } else {
        let at = |row: usize, column: usize| row * (segments + 1) + column;
        for row in 0..=rings {
            for column in 0..=segments {
                let (x, y) = (row as f32 * 2.5, column as f32 * 2.5);
                positions.push([x, y, 10.0 * (x / 7.0).sin() * (y / 5.0).cos()]);
            }
        }
        for row in 0..rings {
            for column in 0..segments {
                let (a, b) = (at(row, column), at(row, column + 1));
                let (c, d) = (at(row + 1, column), at(row + 1, column + 1));
                faces.push([a, c, b]);
                faces.push([b, c, d]);
            }
        }
    }
    let mut mesh = Mesh::new();
    mesh.add_attribute(attribute(GeometryAttributeType::Position, &positions));
    mesh.set_num_faces(faces.len());
    for (index, face) in faces.iter().enumerate() {
        mesh.set_face(
            FaceIndex(index as u32),
            face.map(|point| PointIndex(point as u32)),
        );
    }
    mesh
}

/// Edgebreaker-encoded meshes with quantized positions, at the quantizations and compression levels used for
/// meshfiles.
fn corpus() -> Vec<(String, Vec<u8>)> {
    let mut corpus = Vec::new();
    for (shape, rings, segments, closed) in [("sphere", 12, 20, true), ("grid", 9, 14, false)] {
        for bits in [8, 11, 14, 16] {
            for level in [0, 1, 7, 10] {
                let mut options = EncoderOptions::new();
                options.set_encoding_method(1); // MESH_EDGEBREAKER_ENCODING
                options.set_attribute_quantization(0, bits);
                options.set_compression_level(level);
                let mut encoder = MeshEncoder::new();
                encoder.set_mesh(wavy_mesh(rings, segments, closed));
                let mut buffer = EncoderBuffer::new();
                encoder.encode(&options, &mut buffer).unwrap();
                corpus.push((
                    format!("{shape}_q{bits}_level{level}"),
                    buffer.data().to_vec(),
                ));
            }
        }
    }
    corpus
}

#[test]
fn converts_the_corpus() {
    for (name, input) in corpus() {
        let num_faces = decode_mesh(&input).unwrap().num_faces();
        assert!(num_faces > 0, "{name}");
        for bits in [0, 10, 16] {
            let stl = draco_to_stl(&input, [1.5, -2.0, 3.25], [11.24, 11.24, 28.0], bits)
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(stl.len(), num_faces * STL_FACE_SIZE, "{name}");
            for value in floats(&stl) {
                assert!(value.is_finite(), "{name}");
            }
        }
    }
}

/// A deterministic pseudo random number generator (SplitMix64), to avoid a dependency.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Runs one corrupted input. It must return (Ok or Err) without panicking. The time it takes is only reported,
/// not asserted, as it depends on the machine and on debug vs. release builds.
fn check_corruption(description: &str, input: &[u8], slowest: &mut (Duration, String)) {
    let start = Instant::now();
    let result = std::panic::catch_unwind(|| {
        draco_to_stl(input, [1.5, -2.0, 3.25], [11.24, 11.24, 28.0], 10)
    });
    let elapsed = start.elapsed();
    match result {
        Ok(Ok(output)) => assert_eq!(output.len() % STL_FACE_SIZE, 0, "{description}"),
        Ok(Err(_)) => {}
        Err(_) => panic!("draco_to_stl panicked on {description}"),
    }
    if elapsed > slowest.0 {
        *slowest = (elapsed, description.to_string());
    }
}

#[test]
fn survives_corrupted_input() {
    let mut rng = Rng(7);
    let mut slowest = (Duration::ZERO, String::new());
    let (mut cases, mut accepted) = (0, 0);
    for (name, input) in corpus() {
        let mut check = |description: String, corrupted: &[u8]| {
            check_corruption(&description, corrupted, &mut slowest);
            cases += 1;
            if draco_to_stl(corrupted, IDENTITY.0, IDENTITY.1, 0).is_ok() {
                accepted += 1;
            }
        };
        // Truncations: every length within the header, then spread over the rest.
        let step = (input.len() / 20).max(1);
        for length in (0..input.len()).filter(|&length| length < 40 || length % step == 0) {
            check(format!("{name} truncated to {length}"), &input[..length]);
        }
        // Single byte flips, half of them in the first 64 bytes (header, connectivity and attribute headers).
        for i in 0..40 {
            let mut corrupted = input.clone();
            let position = rng.below(if i % 2 == 0 {
                input.len().min(64)
            } else {
                input.len()
            });
            let mask = (rng.below(255) + 1) as u8;
            corrupted[position] ^= mask;
            check(format!("{name} byte {position} ^= {mask:#04x}"), &corrupted);
        }
        // Several random bytes overwritten.
        for _ in 0..20 {
            let mut corrupted = input.clone();
            let count = rng.below(8) + 1;
            let positions: Vec<usize> = (0..count).map(|_| rng.below(input.len())).collect();
            for &position in &positions {
                corrupted[position] = rng.next() as u8;
            }
            check(
                format!("{name} bytes {positions:?} overwritten (seeded)"),
                &corrupted,
            );
        }
    }
    assert!(cases > 3000, "only {cases} cases");
    eprintln!(
        "{cases} corrupted inputs ({accepted} accepted), slowest {:?}: {}",
        slowest.0, slowest.1
    );
}
