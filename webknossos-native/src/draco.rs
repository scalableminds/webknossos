//! Native function of `NativeDracoToStlConverter`: converting Draco-encoded mesh chunks (from meshfiles of user
//! datasets) to STL faces, decoded with the pure Rust `draco-core` crate.
//!
//! The output reproduces the original C++ implementation (which used the Draco C++ library) bit for bit, see
//! [draco_to_stl], as built without fused multiply-adds (x86_64). Built with clang on arm64, the C++ fused the
//! multiply-adds of the cross product and the squared norm, so its normals differed in their last bits (at most
//! ~1e-5 absolute, below 0.001° in direction, on real meshfile chunks).
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
mod tests;
