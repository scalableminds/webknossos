//! Neuroglancer multi-resolution manifests and the Scala mesh-chunk JSON contract.
use crate::{
    error::{DsError, DsResult},
    models::datasource::unsigned_long_envelope,
};
use serde::{Serialize, Serializer};
fn unsigned<S: Serializer>(id: &u64, s: S) -> Result<S::Ok, S::Error> {
    unsigned_long_envelope(*id).serialize(s)
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshChunk {
    pub position: [f32; 3],
    pub byte_offset: i64,
    pub byte_size: i32,
    #[serde(serialize_with = "unsigned")]
    pub unmapped_segment_id: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct MeshLod {
    pub chunks: Vec<MeshChunk>,
    pub transform: Vec<Vec<f64>>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentInfo {
    pub mesh_format: String,
    pub lods: Vec<MeshLod>,
    pub chunk_scale: [f64; 3],
}
#[derive(Debug)]
pub struct Manifest {
    shape: [f32; 3],
    origin: [f32; 3],
    scales: Vec<f32>,
    vertex_offsets: Vec<[f32; 3]>,
    positions: Vec<Vec<[i32; 3]>>,
    sizes: Vec<Vec<i32>>,
}
struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl Cursor<'_> {
    fn word(&mut self) -> DsResult<[u8; 4]> {
        let end = self
            .offset
            .checked_add(4)
            .ok_or_else(|| DsError::failure("Mesh manifest offset overflow."))?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| DsError::failure("Truncated mesh manifest."))?;
        self.offset = end;
        Ok(bytes.try_into().expect("four bytes"))
    }
    fn int(&mut self) -> DsResult<i32> {
        Ok(i32::from_le_bytes(self.word()?))
    }
    fn float(&mut self) -> DsResult<f32> {
        let v = f32::from_le_bytes(self.word()?);
        if !v.is_finite() {
            return Err(DsError::failure("Nonfinite mesh manifest coordinate."));
        }
        Ok(v)
    }
    fn triple(&mut self) -> DsResult<[f32; 3]> {
        Ok([self.float()?, self.float()?, self.float()?])
    }
}
impl Manifest {
    pub fn parse(bytes: &[u8]) -> DsResult<Self> {
        let mut c = Cursor { bytes, offset: 0 };
        let shape = c.triple()?;
        let origin = c.triple()?;
        let lods =
            usize::try_from(c.int()?).map_err(|_| DsError::failure("Invalid mesh LOD count."))?;
        if lods
            .checked_mul(20)
            .is_none_or(|n| n > bytes.len() - c.offset)
        {
            return Err(DsError::failure("Truncated mesh LOD metadata."));
        }
        let scales = (0..lods).map(|_| c.float()).collect::<DsResult<Vec<_>>>()?;
        let vertex_offsets = (0..lods)
            .map(|_| c.triple())
            .collect::<DsResult<Vec<_>>>()?;
        let counts = (0..lods)
            .map(|_| {
                usize::try_from(c.int()?).map_err(|_| DsError::failure("Invalid mesh chunk count."))
            })
            .collect::<DsResult<Vec<_>>>()?;
        let total = counts
            .iter()
            .try_fold(0usize, |n, c| n.checked_add(*c))
            .and_then(|n| n.checked_mul(16));
        if total.is_none_or(|n| n > bytes.len() - c.offset) {
            return Err(DsError::failure("Truncated mesh chunk records."));
        }
        let mut positions = Vec::new();
        let mut sizes = Vec::new();
        for count in counts {
            let x = (0..count).map(|_| c.int()).collect::<DsResult<Vec<_>>>()?;
            let y = (0..count).map(|_| c.int()).collect::<DsResult<Vec<_>>>()?;
            let z = (0..count).map(|_| c.int()).collect::<DsResult<Vec<_>>>()?;
            positions.push(
                x.into_iter()
                    .zip(y)
                    .zip(z)
                    .map(|((x, y), z)| [x, y, z])
                    .collect(),
            );
            sizes.push(
                (0..count)
                    .map(|_| {
                        let size = c.int()?;
                        if size < 0 {
                            return Err(DsError::failure(
                                "Mesh fragment exceeds supported Int32 size.",
                            ));
                        }
                        Ok(size)
                    })
                    .collect::<DsResult<Vec<_>>>()?,
            );
        }
        // Scala ignores trailing bytes; old files may contain padding after the manifest.
        Ok(Self {
            shape,
            origin,
            scales,
            vertex_offsets,
            positions,
            sizes,
        })
    }
    pub fn enrich(
        &self,
        start: u64,
        id: u64,
        multiplier: f64,
        transform: &[Vec<f64>],
        precomputed: bool,
    ) -> DsResult<Vec<MeshLod>> {
        let total = self
            .sizes
            .iter()
            .flatten()
            .try_fold(0u64, |n, s| n.checked_add(*s as u64))
            .ok_or_else(|| DsError::failure("Mesh fragment size overflow."))?;
        let mut offset = start
            .checked_sub(total)
            .ok_or_else(|| DsError::failure("Mesh fragments precede start of file."))?;
        let mut lods = Vec::new();
        for lod in 0..self.scales.len() {
            let current_transform = if precomputed {
                if transform.len() < 3 || transform.iter().take(3).any(|row| row.len() < 4) {
                    return Err(DsError::failure("Invalid precomputed mesh transform."));
                }
                let base = self.shape.map(|v| (1f32 * (multiplier as f32)) * v);
                vec![
                    vec![
                        f64::from(base[0]) * transform[0][0] * f64::from(self.scales[lod]),
                        transform[0][1],
                        transform[0][2],
                        transform[0][3]
                            + f64::from(self.origin[0])
                            + f64::from(self.vertex_offsets[lod][0]),
                    ],
                    vec![
                        transform[1][0],
                        f64::from(base[1]) * transform[1][1] * f64::from(self.scales[lod]),
                        transform[1][2],
                        transform[1][3]
                            + f64::from(self.origin[1])
                            + f64::from(self.vertex_offsets[lod][1]),
                    ],
                    vec![
                        transform[2][0],
                        transform[2][1],
                        f64::from(base[2]) * transform[2][2] * f64::from(self.scales[lod]),
                        transform[2][3]
                            + f64::from(self.origin[2])
                            + f64::from(self.vertex_offsets[lod][2]),
                    ],
                    vec![0., 0., 0., 1.],
                ]
            } else {
                transform.to_vec()
            };
            if current_transform.iter().flatten().any(|v| !v.is_finite()) {
                return Err(DsError::failure("Nonfinite mesh transform."));
            }
            let mut chunks = Vec::new();
            for (point, size) in self.positions[lod].iter().zip(&self.sizes[lod]) {
                let position = std::array::from_fn(|dim| {
                    if precomputed {
                        point[dim] as f32
                    } else {
                        self.origin[dim]
                            + ((((point[dim] as f32) * self.shape[dim])
                                * (2f64.powi(lod as i32) as f32))
                                * self.scales[lod])
                                * (multiplier as f32)
                    }
                });
                if position.iter().any(|v| !v.is_finite()) {
                    return Err(DsError::failure("Nonfinite mesh position."));
                }
                chunks.push(MeshChunk {
                    position,
                    byte_offset: i64::try_from(offset)
                        .map_err(|_| DsError::failure("Mesh byte offset overflow."))?,
                    byte_size: *size,
                    unmapped_segment_id: id,
                });
                offset = offset
                    .checked_add(*size as u64)
                    .ok_or_else(|| DsError::failure("Mesh byte offset overflow."))?;
            }
            lods.push(MeshLod {
                chunks,
                transform: current_transform,
            });
        }
        Ok(lods)
    }
}
pub fn merge(groups: Vec<Vec<MeshLod>>, format: String, scale: [f64; 3]) -> DsResult<SegmentInfo> {
    let Some(first) = groups.first() else {
        return Err(DsError::empty());
    };
    let count = first.len();
    if groups.iter().any(|lods| lods.len() != count) {
        return Err(DsError::failure(
            "Mesh segments have inconsistent LOD counts.",
        ));
    }
    let mut lods = first
        .iter()
        .map(|lod| MeshLod {
            chunks: Vec::new(),
            transform: lod.transform.clone(),
        })
        .collect::<Vec<_>>();
    for group in groups {
        for (target, source) in lods.iter_mut().zip(group) {
            target.chunks.extend(source.chunks);
        }
    }
    Ok(SegmentInfo {
        mesh_format: format,
        lods,
        chunk_scale: scale,
    })
}
