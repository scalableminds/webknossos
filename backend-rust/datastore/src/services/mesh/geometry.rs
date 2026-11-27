//! Draco→raw STL and STL geometry, preserving the native converter's float arithmetic.
use crate::{
    error::{DsError, DsResult},
    services::mesh::marching_cubes::AdHocMesh,
};
use draco_core::{
    DecodeLimits, DecoderBuffer, Mesh, MeshDecoder, draco_types::DataType,
    geometry_attribute::GeometryAttributeType,
};
pub fn draco_to_stl(
    bytes: &[u8],
    offset: [f32; 3],
    scale: [f64; 3],
    quantization_bits: i32,
) -> DsResult<Vec<u8>> {
    let mut buffer = DecoderBuffer::new(bytes)
        .with_limits(DecodeLimits::default().with_max_faces((i32::MAX as u64) / 50));
    let mut mesh = Mesh::new();
    MeshDecoder::new()
        .decode(&mut buffer, &mut mesh)
        .map_err(|e| {
            DsError::failure(format!("Invalid DRACO Encoding in Mesh Byte Array: {e:?}"))
        })?;
    let position = mesh
        .named_attribute(GeometryAttributeType::Position)
        .ok_or_else(|| DsError::failure("DRACO mesh has no POSITION attribute."))?;
    if position.num_components() != 3
        || !matches!(
            position.data_type(),
            DataType::Float32 | DataType::Int32 | DataType::Uint32
        )
    {
        return Err(DsError::failure("Unsupported DRACO POSITION storage."));
    }
    let len = mesh
        .num_faces()
        .checked_mul(50)
        .filter(|n| *n <= i32::MAX as usize)
        .ok_or_else(|| DsError::failure("Single mesh chunk is too large to encode as STL."))?;
    let mut output = Vec::new();
    output
        .try_reserve_exact(len)
        .map_err(DsError::from_exception)?;
    let stride = usize::try_from(position.byte_stride())
        .map_err(|_| DsError::failure("Invalid DRACO position stride."))?;
    let quantization = 1. / (2f64.powf(f64::from(quantization_bits)) - 1.);
    for face in mesh.faces() {
        let mut vertices = [[0f32; 3]; 3];
        for (index, point) in face.iter().enumerate() {
            let value = position.mapped_index(*point).0 as usize;
            let start = value
                .checked_mul(stride)
                .ok_or_else(|| DsError::failure("DRACO position offset overflow."))?;
            let raw = position
                .buffer()
                .data()
                .get(
                    start
                        ..start
                            .checked_add(12)
                            .ok_or_else(|| DsError::failure("DRACO position offset overflow."))?,
                )
                .ok_or_else(|| DsError::failure("DRACO position mapping exceeds buffer."))?;
            for (dimension, bytes) in raw.as_chunks::<4>().0.iter().enumerate() {
                vertices[index][dimension] = if quantization_bits > 0 {
                    (f64::from((u32::from_le_bytes(*bytes) & 0xffff) as u16) * quantization) as f32
                } else {
                    f32::from_le_bytes(*bytes)
                };
            }
        }
        let mut normal = cross(vertices);
        let magnitude =
            (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if magnitude != 0. {
            for coordinate in &mut normal {
                *coordinate /= magnitude;
            }
        }
        for coordinate in normal {
            output.extend(coordinate.to_le_bytes());
        }
        // Normal is computed before offset/anisotropic scale, exactly as native JNI.
        for vertex in vertices {
            for dimension in 0..3 {
                let translated = vertex[dimension] + offset[dimension];
                let coordinate = (f64::from(translated) * scale[dimension]) as f32;
                output.extend(coordinate.to_le_bytes());
            }
        }
        output.extend([0, 0]);
    }
    Ok(output)
}
fn cross(vertices: [[f32; 3]; 3]) -> [f32; 3] {
    let a = std::array::from_fn::<_, 3, _>(|d| vertices[1][d] - vertices[0][d]);
    let b = std::array::from_fn::<_, 3, _>(|d| vertices[2][d] - vertices[0][d]);
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn combine_stl(chunks: &[Vec<u8>]) -> DsResult<Vec<u8>> {
    let total = chunks
        .iter()
        .try_fold(84usize, |n, c| n.checked_add(c.len()))
        .filter(|n| *n <= i32::MAX as usize)
        .ok_or_else(|| {
            DsError::failure(
                "Mesh is too large to combine into a single STL buffer. Use per-chunk surface \
            area computation instead.",
            )
        })?;
    if chunks.iter().any(|c| !c.len().is_multiple_of(50)) {
        return Err(DsError::failure("Invalid raw STL chunk byte count."));
    }
    let faces = (total - 84) / 50;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(total)
        .map_err(DsError::from_exception)?;
    bytes.resize(80, 0);
    bytes.extend((faces as u32).to_le_bytes());
    for chunk in chunks {
        bytes.extend(chunk);
    }
    Ok(bytes)
}
/// FullMeshHelper.adHocMeshToStl: each face's own normal, then its three vertices, read
/// through the indices.
pub fn ad_hoc_to_stl(mesh: &AdHocMesh) -> DsResult<Vec<u8>> {
    if !mesh.indices.len().is_multiple_of(3) {
        return Err(DsError::failure("Invalid mesh index count."));
    }
    let size = (mesh.indices.len() / 3)
        .checked_mul(50)
        .filter(|n| *n <= i32::MAX as usize)
        .ok_or_else(|| DsError::failure("Single mesh chunk is too large to encode as STL."))?;
    let mut output = Vec::new();
    output
        .try_reserve_exact(size)
        .map_err(DsError::from_exception)?;
    for face in mesh.indices.as_chunks::<3>().0 {
        let points = face_vertices(mesh, face)?;
        let normal = cross(points);
        let reciprocal = 1.
            / (f64::from(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2])
                .sqrt() as f32);
        for coordinate in normal {
            output.extend((coordinate * reciprocal).to_le_bytes());
        }
        for coordinate in points.as_flattened() {
            output.extend(coordinate.to_le_bytes());
        }
        output.extend([0, 0]);
    }
    Ok(output)
}
fn face_vertices(mesh: &AdHocMesh, face: &[u32; 3]) -> DsResult<[[f32; 3]; 3]> {
    let mut points = [[0.; 3]; 3];
    for (point, &index) in points.iter_mut().zip(face) {
        let start = 3 * index as usize;
        *point = mesh
            .vertices
            .get(start..start + 3)
            .and_then(|v| v.try_into().ok())
            .ok_or_else(|| DsError::failure("Mesh index out of range."))?;
    }
    Ok(points)
}
fn triangle_area(vertices: [[f32; 3]; 3]) -> f32 {
    let [x, y, z] = cross(vertices);
    // Scala computes squared length in Float, sqrt in Double, then narrows before /2.
    (f64::from(x * x + y * y + z * z).sqrt() as f32) / 2.
}
/// FullMeshHelper.surfaceArea: the area of an ad-hoc mesh chunk, equal to
/// `surface_area(&ad_hoc_to_stl(mesh)?)` without encoding the STL.
pub fn ad_hoc_surface_area(mesh: &AdHocMesh) -> DsResult<f32> {
    mesh.indices
        .as_chunks::<3>()
        .0
        .iter()
        .try_fold(0f32, |sum, face| {
            Ok(sum + triangle_area(face_vertices(mesh, face)?))
        })
}
pub fn surface_area(raw: &[u8]) -> DsResult<f32> {
    if !raw.len().is_multiple_of(50) {
        return Err(DsError::failure("Invalid raw STL chunk byte count."));
    }
    let mut area = 0f32;
    for record in raw.as_chunks::<50>().0 {
        let mut vertices = [[0.; 3]; 3];
        for (index, bytes) in record[12..48].as_chunks::<4>().0.iter().enumerate() {
            vertices[index / 3][index % 3] = f32::from_le_bytes(*bytes);
        }
        area += triangle_area(vertices);
    }
    Ok(area)
}
