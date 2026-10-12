//! Neuroglancer precomputed arrays: irregular chunks, shard/minishard ranges and codecs.
pub mod compressed_segmentation;
pub mod compresso;
pub mod header;
pub mod jpeg;
pub mod sharding;
use crate::{
    compression::Compressor,
    datareaders::{ArrayFormat, ChunkContents, ChunkContentsCache, DatasetArray, DatasetHeader},
    datavault::{BoxFuture, ByteRange, VaultError, VaultPath},
    error::{DsError, DsResult},
    models::{AdditionalAxis, AxisOrder, DataSourceId, Vec3Int},
};
pub use header::{PrecomputedHeader, PrecomputedScale, PrecomputedScaleHeader};
use sharding::{ShardReader, compressed_morton_code};
use std::sync::Arc;
#[derive(Debug)]
struct PrecomputedFormat {
    header: Arc<PrecomputedScaleHeader>,
    shards: Option<ShardReader>,
}
impl ArrayFormat for PrecomputedFormat {
    fn source_chunk<'a>(
        &'a self,
        root: &'a VaultPath,
        index: &'a [i64],
        token: Option<&'a str>,
    ) -> Option<BoxFuture<'a, DsResult<ChunkContents>>> {
        Some(Box::pin(async move {
            let bounds = self.header.bounding_box_at(index)?;
            let spatial_shape: Vec<i32> = bounds.iter().map(|(a, b)| b - a).collect();
            let mut shape = spatial_shape.clone();
            if self.header.root.num_channels > 1 {
                shape.insert(0, self.header.root.num_channels);
            }
            if shape.iter().any(|s| *s <= 0) {
                return Err(DsError::failure("Invalid precomputed boundary chunk shape"));
            }
            let addressed = if let Some(shards) = &self.shards {
                let xyz: [u32; 3] = self
                    .header
                    .spatial_chunk_index(index)?
                    .iter()
                    .map(|i| {
                        u32::try_from(*i)
                            .map_err(|_| DsError::failure("Invalid precomputed chunk coordinate"))
                    })
                    .collect::<DsResult<Vec<_>>>()?
                    .try_into()
                    .map_err(|_| DsError::failure("Invalid precomputed chunk rank"))?;
                let id = compressed_morton_code(xyz, self.header.grid_size()?)?;
                shards.chunk_path_and_range(root, id, token).await
            } else {
                let filename = bounds
                    .iter()
                    .map(|(a, b)| format!("{a}-{b}"))
                    .collect::<Vec<_>>()
                    .join("_");
                Ok((root.join(&filename), ByteRange::Complete))
            };
            let (path, range) = match addressed {
                Ok(v) => v,
                Err(VaultError::NotFound) => return Ok(ChunkContents::Fill { shape }),
                Err(VaultError::Failure(e)) => return Err(e),
            };
            let bytes = match path.read_bytes(range, token).await {
                Ok(b) => b,
                Err(VaultError::NotFound) => return Ok(ChunkContents::Fill { shape }),
                Err(VaultError::Failure(e)) => {
                    return Err(e.wrap(format!("Reading chunk at {path} failed")));
                }
            };
            let data = if let Some(shards) = &self.shards {
                Compressor::from_precomputed_sharding_encoding(&shards.spec.data_encoding)?
                    .decompress(&bytes, Some(300 * 1024 * 1024))?
            } else {
                bytes.to_vec()
            };
            let decoded = match self.header.scale.encoding.to_ascii_lowercase().as_str() {
                "raw" => data,
                "jpeg" => jpeg::decode(&data)?,
                "compresso" => {
                    let decoded_header = compresso::CompressoHeader::parse(&data)?;
                    if decoded_header.shape
                        != [
                            spatial_shape[0] as usize,
                            spatial_shape[1] as usize,
                            spatial_shape[2] as usize,
                        ]
                        || decoded_header.label_width != self.header.bytes_per_element()
                    {
                        return Err(DsError::failure(
                            "Compresso header does not match precomputed chunk shape or datatype.",
                        ));
                    }
                    let expected = decoded_header
                        .shape
                        .iter()
                        .try_fold(decoded_header.label_width, |n, d| n.checked_mul(*d))
                        .ok_or_else(|| DsError::failure("Compresso chunk size overflow."))?;
                    compresso::decode(&data, expected)?
                }
                "compressed_segmentation" => compressed_segmentation::decode(
                    &data,
                    &spatial_shape,
                    self.header.root.num_channels as usize,
                    self.header
                        .scale
                        .compressed_segmentation_block_size
                        .unwrap_or(Vec3Int::full(8)),
                    self.header.resolved_data_type(),
                )?,
                encoding => {
                    return Err(DsError::failure(format!(
                        "Chunk encoding '{encoding}' not supported."
                    )));
                }
            };
            let count = shape
                .iter()
                .try_fold(self.header.bytes_per_element(), |p, d| {
                    p.checked_mul(*d as usize)
                })
                .ok_or_else(|| DsError::failure("Precomputed chunk size overflow"))?;
            if decoded.len() != count {
                return Err(DsError::failure(format!(
                    "Unexpected precomputed chunk byte count: expected {count}, got {}",
                    decoded.len()
                )));
            }
            // Raw and segmentation are planar (x,y,z,c); JPEG/ImageIO is interleaved BGR.
            // DatasetArray uses cxyz for multi-channel data so reads can select/pack channels.
            let decoded = if self.header.root.num_channels > 1
                && !self.header.scale.encoding.eq_ignore_ascii_case("jpeg")
            {
                let channels = self.header.root.num_channels as usize;
                let width = self.header.bytes_per_element();
                let pixels = count / channels / width;
                let mut interleaved = vec![0u8; count];
                for pixel in 0..pixels {
                    for c in 0..channels {
                        let from = (c * pixels + pixel) * width;
                        let to = (pixel * channels + c) * width;
                        interleaved[to..to + width].copy_from_slice(&decoded[from..from + width]);
                    }
                }
                interleaved
            } else {
                decoded
            };
            Ok(ChunkContents::Bytes {
                bytes: Arc::new(decoded),
                shape,
            })
        }))
    }
}
#[allow(clippy::too_many_arguments)]
pub async fn open_precomputed_array(
    path: &VaultPath,
    id: DataSourceId,
    layer: &str,
    axis: Option<AxisOrder>,
    channel: Option<i32>,
    additional: Option<Vec<AdditionalAxis>>,
    cache: Arc<ChunkContentsCache>,
    token: Option<&str>,
) -> DsResult<DatasetArray> {
    let bytes = path
        .parent()
        .join(header::FILENAME_INFO)
        .read_bytes(ByteRange::Complete, token)
        .await
        .map_err(|e| DsError::from(e.wrap("Could not read header at info")))?;
    let root =
        PrecomputedHeader::parse(&bytes).map_err(|e| e.wrap("Could not parse array header"))?;
    let scale = root.get_scale(&path.basename()).cloned().ok_or_else(|| {
        DsError::failure(format!("Header does not contain scale {}", path.basename()))
    })?;
    let header = Arc::new(PrecomputedScaleHeader::new(scale, root)?);
    let encoding = header.scale.encoding.to_ascii_lowercase();
    if !["raw", "jpeg", "compressed_segmentation", "compresso"].contains(&encoding.as_str()) {
        return Err(DsError::failure(format!(
            "Chunk encoding '{}' not supported.",
            header.scale.encoding
        ))
        .with_status(axum::http::StatusCode::NOT_IMPLEMENTED));
    }
    if encoding == "compresso" && header.root.num_channels != 1 {
        return Err(DsError::failure(
            "Compresso requires a single label channel.",
        ));
    }
    let axis = axis.unwrap_or_else(|| AxisOrder::as_zyx_from_rank(3));
    let axis = if header.root.num_channels > 1 && axis.c.is_none() {
        if axis.x < 0
            || axis.y < 0
            || axis.x > 2
            || axis.y > 2
            || axis.z.is_none_or(|z| !(0..3).contains(&z))
        {
            return Err(DsError::failure("Invalid precomputed spatial axis order"));
        }
        AxisOrder::new(axis.x + 1, axis.y + 1, axis.z.map(|z| z + 1), Some(0))
    } else {
        axis
    };
    let shards = header.scale.sharding.clone().map(ShardReader::new);
    let format = Arc::new(PrecomputedFormat {
        header: Arc::clone(&header),
        shards,
    });
    Ok(DatasetArray::new(
        path.clone(),
        id,
        layer,
        header,
        axis,
        channel,
        additional,
        cache,
        format,
    ))
}
