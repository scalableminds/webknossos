//! Native function of `NativeDracoToStlConverter`: converting Draco-encoded mesh chunks (from meshfiles of user
//! datasets) to STL faces, decoded with the pure Rust `draco-core` crate.
//!
//! The output reproduces the original C++ implementation (which used the Draco C++ library) bit for bit, see
//! [draco_to_stl], as built without fused multiply-adds (x86_64). Built with clang on arm64, the C++ fused the
//! multiply-adds of the cross product and the squared norm, so its normals differed in their last bits (at most
//! ~1e-5 absolute, below 0.001° in direction, on the golden corpus).
//!
//! The input is untrusted: malformed streams fail with an error.

use draco_core::{
    DecodeLimits, DecoderBuffer, GeometryAttributeType, Mesh, MeshDecoder, PointAttribute,
};
use jni::EnvUnowned;
use jni::objects::{JByteArray, JObject};
use jni::sys::{jdouble, jfloat, jint};

use crate::jni_util::{self, NativeError, NativeResult, invalid_argument};

/// Bytes per STL face: normal and three vertices (3 × f32 each), then a u16 attribute byte count.
const STL_FACE_SIZE: usize = 50;

/// The most faces whose STL output still fits into a Java `byte[]` (at most `i32::MAX` elements).
const MAX_FACES: usize = i32::MAX as usize / STL_FACE_SIZE;

/// Decodes a Draco mesh. Point cloud streams are rejected, as by the C++ `Decoder::DecodeMeshFromBuffer`: the
/// crate is built without its `point_cloud_decode` feature, so `MeshDecoder` fails on them.
///
/// Meshes with more than [MAX_FACES] faces are rejected while decoding, before the decoder allocates them, as
/// their STL output could not be returned anyway. The default limits of draco-core admit 512M faces, i.e. let a
/// tiny stream request gigabytes, and a failed allocation aborts the process.
fn decode_mesh(input: &[u8]) -> NativeResult<Mesh> {
    let limits = DecodeLimits::default().with_max_faces(MAX_FACES as u64);
    let mut mesh = Mesh::new();
    MeshDecoder::new()
        .decode(
            &mut DecoderBuffer::new(input).with_limits(limits),
            &mut mesh,
        )
        .map_err(|error| {
            NativeError::InvalidArgument(format!(
                "Invalid DRACO Encoding in Mesh Byte Array: {error}"
            ))
        })?;
    Ok(mesh)
}

/// The value of `attribute` for point `point` as three f32. Like the C++ `PointAttribute::GetMappedValue`, this
/// copies the value's raw bytes at `byte_stride * value_index` without converting its data type (positions decode
/// as float32 for all our inputs). The C++ adds the attribute's byte offset, which is always 0 for decoded
/// attributes; draco-core neither exposes it on `PointAttribute` nor sets it to anything else.
/// Unlike the C++, a stride other than 12 bytes neither leaves components uninitialized nor overflows the output:
/// missing components are 0 and further bytes are ignored.
fn mapped_value(
    attribute: &PointAttribute,
    point: draco_core::PointIndex,
) -> NativeResult<[f32; 3]> {
    let stride = usize::try_from(attribute.byte_stride()).unwrap_or(0);
    let length = stride.min(12);
    let value_index = attribute.mapped_index(point).0 as usize;
    let bytes = value_index.checked_mul(stride).and_then(|start| {
        attribute
            .buffer()
            .data()
            .get(start..start.checked_add(length)?)
    });
    let Some(bytes) = bytes else {
        return invalid_argument(format!(
            "Point {} maps to position {value_index}, which the attribute does not have",
            point.0
        ));
    };
    let mut raw = [0u8; 12];
    raw[..length].copy_from_slice(bytes);
    Ok(std::array::from_fn(|i| {
        f32::from_le_bytes([raw[4 * i], raw[4 * i + 1], raw[4 * i + 2], raw[4 * i + 3]])
    }))
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// `draco::CrossProduct` followed by `VectorD::Normalize`, in f32: a zero vector stays zero (and NaN stays NaN).
fn face_normal(pos: &[[f32; 3]; 3]) -> [f32; 3] {
    let u = sub(pos[1], pos[0]);
    let v = sub(pos[2], pos[0]);
    let normal = [
        (u[1] * v[2]) - (u[2] * v[1]),
        (u[2] * v[0]) - (u[0] * v[2]),
        (u[0] * v[1]) - (u[1] * v[0]),
    ];
    // VectorD::Dot sums from 0 in component order.
    let mut squared_norm = 0f32;
    for component in normal {
        squared_norm += component * component;
    }
    let magnitude = squared_norm.sqrt();
    if magnitude == 0.0 {
        return normal;
    }
    normal.map(|component| component / magnitude)
}

/// Decodes the Draco mesh in `input` and encodes its faces as binary STL faces (50 bytes each, without the STL
/// header, as the caller concatenates the faces of several chunks).
///
/// Semantics of the C++ implementation, kept:
/// - Faces in decoder order, corners in face order; positions are the raw bytes of the position attribute.
/// - If `vertex_quantization_bits > 0`, each coordinate becomes the lower 16 bits of its f32 bit pattern times
///   `1 / (2^bits - 1)`, computed in f64 and stored as f32.
/// - The normal is computed from these positions, before the transform.
/// - Each vertex is then offset (in f32) and scaled (f32 × f64 in f64, stored as f32).
pub fn draco_to_stl(
    input: &[u8],
    offset: [f32; 3],
    scale: [f64; 3],
    vertex_quantization_bits: i32,
) -> NativeResult<Vec<u8>> {
    let mesh = decode_mesh(input)?;
    let num_faces = mesh.num_faces();
    if num_faces == 0 {
        return Ok(Vec::new());
    }
    if num_faces > MAX_FACES {
        // decode_mesh already rejects these, this guards the size computation below.
        return invalid_argument(format!(
            "Draco mesh has {num_faces} faces, at most {MAX_FACES} fit into the output"
        ));
    }
    let mut output = Vec::new();
    output
        .try_reserve_exact(num_faces * STL_FACE_SIZE)
        .map_err(|error| {
            NativeError::InvalidArgument(format!(
                "Cannot allocate the STL output for {num_faces} faces: {error}"
            ))
        })?;
    let Some(positions) = mesh.named_attribute(GeometryAttributeType::Position) else {
        return invalid_argument("Draco mesh has faces but no position attribute");
    };
    let quantization_factor = (vertex_quantization_bits > 0)
        .then(|| 1.0 / (2f64.powf(f64::from(vertex_quantization_bits)) - 1.0));

    for face in mesh.faces() {
        let mut pos = [[0f32; 3]; 3];
        for (corner, &point) in pos.iter_mut().zip(face) {
            *corner = mapped_value(positions, point)?;
        }
        if let Some(factor) = quantization_factor {
            for coordinate in pos.iter_mut().flatten() {
                let lower_bits = coordinate.to_bits() as u16;
                *coordinate = (f64::from(f32::from(lower_bits)) * factor) as f32;
            }
        }

        for component in face_normal(&pos) {
            output.extend_from_slice(&component.to_le_bytes());
        }
        for vertex in pos {
            for axis in 0..3 {
                let value = (f64::from(vertex[axis] + offset[axis]) * scale[axis]) as f32;
                output.extend_from_slice(&value.to_le_bytes());
            }
        }
        output.extend_from_slice(&0u16.to_le_bytes()); // no face attributes
    }
    Ok(output)
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)] // JNI signature
pub extern "system" fn Java_com_scalableminds_webknossos_datastore_draco_NativeDracoToStlConverter_dracoToStl<
    'local,
>(
    env: EnvUnowned<'local>,
    _this: JObject<'local>,
    input_bytes: JByteArray<'local>,
    offset_x: jfloat,
    offset_y: jfloat,
    offset_z: jfloat,
    scale_x: jdouble,
    scale_y: jdouble,
    scale_z: jdouble,
    vertex_quantization_bits: jint,
) -> JByteArray<'local> {
    jni_util::run(env, "transcoding DRACO Mesh to STL Faces", |env| {
        let input = jni_util::read_bytes(env, &input_bytes)?;
        let output = draco_to_stl(
            &input,
            [offset_x, offset_y, offset_z],
            [scale_x, scale_y, scale_z],
            vertex_quantization_bits,
        )?;
        jni_util::new_byte_array(env, &output)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use draco_core::{
        DataType, EncoderBuffer, EncoderOptions, FaceIndex, MeshEncoder, PointCloud,
        PointCloudEncoder, PointIndex,
    };
    use std::path::PathBuf;
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

    /// The Draco meshes of the golden test corpus (real meshfile chunks and synthetic DracoPy meshes).
    fn corpus() -> Vec<(String, Vec<u8>)> {
        let directory =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test/native-golden/draco");
        let mut files: Vec<_> = std::fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "drc"))
            .collect();
        files.sort();
        assert!(
            !files.is_empty(),
            "no .drc files in {}",
            directory.display()
        );
        files
            .into_iter()
            .map(|path| {
                (
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    std::fs::read(&path).unwrap(),
                )
            })
            .collect()
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
}
