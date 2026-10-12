//! MeshFileService + local HDF5/Zarr3 and sharded precomputed mesh-file readers.
use super::{
    mesh_manifest::{Manifest, MeshLod, SegmentInfo, merge},
    segment_index::hash_function,
};
use crate::{
    compression::Compressor,
    datareaders::hdf5::Hdf5Reader,
    datareaders::{
        ChunkContentsCache, DatasetArray,
        nd_array::MaDataType,
        precomputed::sharding::{ShardReader, ShardingSpecification},
        zarr3::open_zarr3_array,
    },
    datavault::{ByteRange, DataVaultService},
    error::{DsError, DsResult},
    models::{
        DataSourceId, LayerAttachment, StaticLayer, UPath,
        enums::LayerAttachmentDataformat,
        json::{Fields, read_f64, read_i64, read_list, read_string},
    },
    wk_client::AlfuCache,
};
use futures::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
type CacheKey = (DataSourceId, String, String, UPath, Option<String>);
#[derive(Clone)]
pub struct MeshFileKey {
    pub source: DataSourceId,
    pub layer: String,
    pub attachment: LayerAttachment,
}
impl MeshFileKey {
    fn cache_key(&self) -> CacheKey {
        (
            self.source.clone(),
            self.layer.clone(),
            self.attachment.name.clone(),
            self.attachment.path.clone(),
            self.attachment.credential_id.clone(),
        )
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshFileInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_name: Option<String>,
    pub format_version: i64,
}
#[derive(Clone)]
struct Attributes {
    version: i64,
    format: String,
    multiplier: f64,
    transform: Vec<Vec<f64>>,
    hash: String,
    buckets: i64,
    mapping: Option<String>,
}
#[derive(Deserialize)]
struct RemoteInfo {
    lod_scale_multiplier: f64,
    transform: Vec<f64>,
    sharding: Option<ShardingSpecification>,
    vertex_quantization_bits: i32,
}
struct RemoteMesh {
    info: RemoteInfo,
    shards: ShardReader,
}
#[derive(Clone, Debug)]
pub struct ChunkRequest {
    pub byte_offset: i64,
    pub byte_size: i32,
    pub segment_id: Option<u64>,
}
pub struct MeshFileService {
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    attributes: AlfuCache<CacheKey, Arc<Attributes>>,
    arrays: AlfuCache<(CacheKey, String), Arc<DatasetArray>>,
    hdf5: AlfuCache<CacheKey, Arc<Hdf5Reader>>,
    remote: AlfuCache<CacheKey, Arc<RemoteMesh>>,
}
impl MeshFileService {
    pub fn new(vaults: DataVaultService, chunks: Arc<ChunkContentsCache>) -> Self {
        Self {
            vaults,
            chunks,
            attributes: AlfuCache::with_defaults(),
            arrays: AlfuCache::with_defaults(),
            hdf5: AlfuCache::new(30, std::time::Duration::MAX, std::time::Duration::MAX),
            remote: AlfuCache::new(
                100,
                std::time::Duration::from_secs(7200),
                std::time::Duration::from_secs(3600),
            ),
        }
    }
    pub fn look_up(
        source: &DataSourceId,
        layer: &StaticLayer,
        name: &str,
    ) -> DsResult<MeshFileKey> {
        let attachment = layer
            .attachments
            .as_ref()
            .and_then(|a| a.meshes.iter().find(|a| a.name == name))
            .cloned()
            .ok_or_else(DsError::empty)?;
        if !attachment.path.is_absolute() {
            return Err(DsError::failure(
                "Path of mesh file is ambiguous, must be absolute.",
            ));
        }
        Ok(MeshFileKey {
            source: source.clone(),
            layer: layer.name.clone(),
            attachment,
        })
    }
    pub fn clear_caches(&self, source: &DataSourceId, layer: Option<&str>) -> usize {
        let matches =
            |(s, l, _, _, _): &CacheKey| s == source && layer.is_none_or(|name| name == l);
        self.attributes.clear_matching(matches)
            + self.arrays.clear_matching(|(k, _)| matches(k))
            + self.hdf5.clear_matching(matches)
            + self.remote.clear_matching(matches)
            + self.chunks.clear_for_source(source, layer)
    }
    async fn hdf5<T: Send + 'static>(
        &self,
        key: &MeshFileKey,
        operation: impl FnOnce(&Hdf5Reader) -> DsResult<T> + Send + 'static,
    ) -> DsResult<T> {
        let path = key.attachment.local_path()?;
        let file = self
            .hdf5
            .get_or_load(key.cache_key(), || async move {
                tokio::task::spawn_blocking(move || Ok(Arc::new(Hdf5Reader::open(&path)?)))
                    .await
                    .map_err(DsError::from_exception)?
            })
            .await?;
        tokio::task::spawn_blocking(move || operation(&file))
            .await
            .map_err(DsError::from_exception)?
    }
    async fn attributes(
        &self,
        key: &MeshFileKey,
        token: Option<&str>,
    ) -> DsResult<Arc<Attributes>> {
        self.attributes
            .get_or_load(key.cache_key(), || async {
                let group = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                let bytes = group
                    .join("zarr.json")
                    .read_bytes(ByteRange::Complete, token)
                    .await
                    .map_err(|e| {
                        DsError::from(e.wrap("Could not read mesh file zarr group file"))
                    })?;
                let parse = || -> DsResult<Attributes> {
                    let json: Value =
                        serde_json::from_slice(&bytes).map_err(DsError::from_exception)?;
                    let vx = &json["attributes"]["voxelytics"];
                    let mut f = Fields::new(&vx["artifact_attributes"]);
                    let format = f.req("mesh_format", read_string);
                    let multiplier = f.req("lod_scale_multiplier", read_f64);
                    let transform = f.req("transform", |v| {
                        read_list(v, |row| read_list(row, read_f64))
                    });
                    let hash = f.req("hash_function", read_string);
                    let buckets = f.req("n_buckets", read_i64);
                    let mapping = f.opt("mapping_name", read_string);
                    f.finish().map_err(|e| DsError::failure(e.to_string()))?;
                    let field = |e: crate::models::json::JsError| DsError::failure(e.to_string());
                    Ok(Attributes {
                        version: read_i64(&vx["artifact_schema_version"]).map_err(field)?,
                        format: format.map_err(field)?,
                        multiplier: multiplier.map_err(field)?,
                        transform: transform.map_err(field)?,
                        hash: hash.map_err(field)?,
                        buckets: buckets.map_err(field)?,
                        mapping: mapping.map_err(field)?,
                    })
                };
                Ok(Arc::new(parse().map_err(|e| {
                    e.wrap("Could not parse meshFile attributes from zarr group file.")
                })?))
            })
            .await
    }
    async fn array(
        &self,
        key: &MeshFileKey,
        name: &str,
        token: Option<&str>,
    ) -> DsResult<Arc<DatasetArray>> {
        self.arrays
            .get_or_load((key.cache_key(), name.into()), || async {
                let group = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                Ok(Arc::new(
                    open_zarr3_array(
                        &group.join(name),
                        key.source.clone(),
                        &key.layer,
                        None,
                        None,
                        None,
                        Arc::clone(&self.chunks),
                        token,
                    )
                    .await?,
                ))
            })
            .await
    }
    async fn remote(&self, key: &MeshFileKey, token: Option<&str>) -> DsResult<Arc<RemoteMesh>> {
        self.remote
            .get_or_load(key.cache_key(), || async {
                let root = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                let bytes = root
                    .join("info")
                    .read_bytes(ByteRange::Complete, token)
                    .await
                    .map_err(|e| DsError::from(e.wrap("Failed to read mesh info")))?;
                let info: RemoteInfo = serde_json::from_slice(&bytes)
                    .map_err(|e| DsError::from_exception(e).wrap("Failed to read mesh info"))?;
                if info.transform.len() != 12 {
                    return Err(DsError::failure(
                        "Invalid mesh info: transform has to be of length 12",
                    ));
                }
                let spec = info
                    .sharding
                    .clone()
                    .unwrap_or_else(|| ShardingSpecification {
                        kind: "neuroglancer_uint64_sharded_v1".into(),
                        preshift_bits: 0,
                        hash: "identity".into(),
                        minishard_bits: 0,
                        shard_bits: 0,
                        minishard_index_encoding: "raw".into(),
                        data_encoding: "raw".into(),
                    });
                spec.validate()?;
                Ok(Arc::new(RemoteMesh {
                    info,
                    shards: ShardReader::new(spec),
                }))
            })
            .await
    }
    pub async fn mapping_name(
        &self,
        key: &MeshFileKey,
        token: Option<&str>,
    ) -> DsResult<Option<String>> {
        match key.attachment.data_format {
            LayerAttachmentDataformat::Hdf5 => Ok(self
                .hdf5(key, |reader| reader.root_string("mapping_name"))
                .await
                .ok()),
            LayerAttachmentDataformat::Zarr3 => {
                Ok(self.attributes(key, token).await?.mapping.clone())
            }
            LayerAttachmentDataformat::NeuroglancerPrecomputed => Ok(None),
            _ => Err(unsupported(key)),
        }
    }
    async fn version(&self, key: &MeshFileKey, token: Option<&str>) -> DsResult<i64> {
        match key.attachment.data_format {
            LayerAttachmentDataformat::Hdf5 => Ok(self
                .hdf5(key, |r| r.root_i64("artifact_schema_version"))
                .await
                .unwrap_or(0)),
            LayerAttachmentDataformat::Zarr3 => Ok(self.attributes(key, token).await?.version),
            LayerAttachmentDataformat::NeuroglancerPrecomputed => Ok(7),
            _ => Err(unsupported(key)),
        }
    }
    pub async fn list(
        &self,
        source: &DataSourceId,
        layer: &StaticLayer,
        token: Option<&str>,
    ) -> Vec<MeshFileInfo> {
        let mut infos = Vec::new();
        for attachment in layer
            .attachments
            .as_ref()
            .map(|a| a.meshes.as_slice())
            .unwrap_or(&[])
        {
            let read = async {
                let key = Self::look_up(source, layer, &attachment.name)?;
                let version = self.version(&key, token).await?;
                let mapping = self.mapping_name(&key, token).await?;
                Ok::<_, DsError>(MeshFileInfo {
                    name: attachment.name.clone(),
                    mapping_name: mapping,
                    format_version: version,
                })
            }
            .await;
            match read {
                Ok(info) => infos.push(info),
                Err(e) => {
                    tracing::warn!(source=%source,name=%attachment.name,error=%e,"Failed to list mesh file")
                }
            }
        }
        infos
    }
    pub async fn vertex_quantization_bits(
        &self,
        key: &MeshFileKey,
        token: Option<&str>,
    ) -> DsResult<i32> {
        if key.attachment.data_format == LayerAttachmentDataformat::NeuroglancerPrecomputed {
            Ok(self.remote(key, token).await?.info.vertex_quantization_bits)
        } else {
            Ok(0)
        }
    }
    async fn zarr_manifest(
        &self,
        key: &MeshFileKey,
        attrs: &Attributes,
        id: u64,
        token: Option<&str>,
    ) -> DsResult<Vec<MeshLod>> {
        if attrs.buckets == 0 {
            return Err(DsError::failure("Mesh file n_buckets must be positive."));
        }
        let bucket = hash_function(&attrs.hash)?(id as i64) as u64 % attrs.buckets as u64;
        let offsets = self.array(key, "bucket_offsets", token).await?;
        let range = longs(&offsets, &[bucket as i64], &[2], token).await?;
        let [start, end] = range[..] else {
            return Err(DsError::failure("Invalid mesh bucket offsets."));
        };
        let count = end
            .checked_sub(start)
            .filter(|n| *n > 0)
            .ok_or_else(|| DsError::failure(format!("No entry for segment {}", id as i64)))?;
        let rows = i32::try_from(
            count
                .checked_add(1)
                .ok_or_else(|| DsError::failure("Mesh bucket overflow."))?,
        )
        .map_err(|_| DsError::failure("Mesh bucket overflow."))?;
        let buckets = self.array(key, "buckets", token).await?;
        let values = longs(&buckets, &[start, 0], &[rows, 3], token).await?;
        let entry = values
            .as_chunks::<3>()
            .0
            .iter()
            .find(|entry| entry[0] as u64 == id)
            .ok_or_else(|| {
                DsError::failure(format!("SegmentId {} not in bucket list", id as i64))
            })?;
        let (start, end) = (entry[1], entry[2]);
        let bytes = self
            .zarr_bytes(
                key,
                start,
                end.checked_sub(start)
                    .ok_or_else(|| DsError::failure("Mesh manifest range overflow."))?,
                token,
            )
            .await?;
        Manifest::parse(&bytes)?.enrich(start as u64, id, attrs.multiplier, &attrs.transform, false)
    }
    async fn zarr_bytes(
        &self,
        key: &MeshFileKey,
        start: i64,
        count: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<u8>> {
        if start < 0 || count < 0 {
            return Err(DsError::failure("Invalid mesh byte range."));
        }
        let array = self.array(key, "neuroglancer", token).await?;
        if !matches!(
            array.header().resolved_data_type(),
            crate::datareaders::ArrayDataType::I1 | crate::datareaders::ArrayDataType::U1
        ) {
            return Err(DsError::failure(
                "Mesh payload is not stored as byte array.",
            ));
        }
        let mut bytes = Vec::new();
        let mut offset = 0;
        while offset < count {
            let size = (count - offset).min(64 * 1024 * 1024) as i32;
            let data = array
                .read_as_multi_array(
                    &[start
                        .checked_add(offset)
                        .ok_or_else(|| DsError::failure("Mesh byte range overflow."))?],
                    &[size],
                    token,
                )
                .await?;
            if data.data_type() != MaDataType::Byte {
                return Err(DsError::failure(
                    "Mesh payload is not stored as byte array.",
                ));
            }
            bytes.extend_from_slice(data.storage());
            offset += i64::from(size);
        }
        Ok(bytes)
    }
    async fn hdf_manifest(
        &self,
        key: &MeshFileKey,
        id: u64,
        multiplier: f64,
        transform: Vec<Vec<f64>>,
    ) -> DsResult<Vec<MeshLod>> {
        self.hdf5(key, move |reader| {
            let buckets = reader.root_u64("n_buckets")?;
            if buckets == 0 {
                return Err(DsError::failure("Mesh file n_buckets must be positive."));
            }
            let bucket =
                hash_function(&reader.root_string("hash_function")?)?(id as i64) as u64 % buckets;
            let range = reader.uint64_values("bucket_offsets", bucket, 2, None)?;
            let [start, end] = range[..] else {
                return Err(DsError::failure("Invalid mesh bucket offsets."));
            };
            let count = end
                .checked_sub(start)
                .filter(|n| *n > 0)
                .ok_or_else(|| DsError::failure(format!("No entry for segment {}", id as i64)))?;
            let values = reader.uint64_values(
                "buckets",
                start,
                count
                    .checked_add(1)
                    .ok_or_else(|| DsError::failure("Mesh bucket overflow."))?,
                Some(3),
            )?;
            let entry = values
                .as_chunks::<3>()
                .0
                .iter()
                .find(|entry| entry[0] == id)
                .ok_or_else(|| {
                    DsError::failure(format!("SegmentId {} not in bucket list", id as i64))
                })?;
            let bytes = hdf_bytes(
                reader,
                entry[1],
                entry[2]
                    .checked_sub(entry[1])
                    .ok_or_else(|| DsError::failure("Mesh manifest range overflow."))?,
            )?;
            Manifest::parse(&bytes)?.enrich(entry[1], id, multiplier, &transform, false)
        })
        .await
    }
    pub async fn list_chunks(
        &self,
        key: &MeshFileKey,
        ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<SegmentInfo> {
        match key.attachment.data_format {
            LayerAttachmentDataformat::Hdf5 => {
                let (format, multiplier, transform) = self
                    .hdf5(key, |r| {
                        Ok((
                            r.root_string("mesh_format")?,
                            r.root_f64("lod_scale_multiplier")?,
                            r.root_f64_matrix("transform")?,
                        ))
                    })
                    .await?;
                let mut groups = Vec::new();
                for id in ids {
                    if let Ok(group) = self
                        .hdf_manifest(key, *id as u64, multiplier, transform.clone())
                        .await
                    {
                        groups.push(group);
                    }
                }
                if groups.is_empty() {
                    return Err(zero_chunks(key, ids));
                }
                merge(groups, format, [1.; 3])
            }
            LayerAttachmentDataformat::Zarr3 => {
                let attrs = self.attributes(key, token).await?;
                let futures = ids
                    .iter()
                    .map(|id| self.zarr_manifest(key, &attrs, *id as u64, token))
                    .collect::<Vec<_>>();
                let results = stream::iter(futures)
                    .buffered(if key.attachment.path.is_remote() {
                        32
                    } else {
                        1
                    })
                    .collect::<Vec<_>>()
                    .await;
                let groups = results
                    .into_iter()
                    .filter_map(Result::ok)
                    .collect::<Vec<_>>();
                if groups.is_empty() {
                    return Err(zero_chunks(key, ids));
                }
                merge(groups, attrs.format.clone(), [1.; 3])
            }
            LayerAttachmentDataformat::NeuroglancerPrecomputed => {
                let mesh = self.remote(key, token).await?;
                let root = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                let transform = mesh
                    .info
                    .transform
                    .chunks(4)
                    .map(|row| row.to_vec())
                    .collect::<Vec<_>>();
                let mut groups = Vec::new();
                for id in ids {
                    let (path, range) = mesh
                        .shards
                        .chunk_path_and_range(&root, *id as u64, token)
                        .await?;
                    let ByteRange::StartEnd { start, .. } = range else {
                        unreachable!("shard reader returns byte range")
                    };
                    let bytes = path.read_bytes(range, token).await?;
                    let bytes = Compressor::from_precomputed_sharding_encoding(
                        &mesh.shards.spec.data_encoding,
                    )?
                    .decompress(&bytes, Some(300 * 1024 * 1024))?;
                    groups.push(Manifest::parse(&bytes)?.enrich(
                        start,
                        *id as u64,
                        mesh.info.lod_scale_multiplier,
                        &transform,
                        true,
                    )?);
                }
                let scale = 1. / 2f64.powf(f64::from(mesh.info.vertex_quantization_bits));
                if !scale.is_finite() {
                    return Err(DsError::failure("Invalid mesh vertex quantization scale."));
                }
                merge(groups, "draco".into(), [scale; 3])
            }
            _ => Err(unsupported(key)),
        }
    }
    pub async fn read_chunks(
        &self,
        key: &MeshFileKey,
        requests: &[ChunkRequest],
        token: Option<&str>,
    ) -> DsResult<(Vec<u8>, String)> {
        let total = requests
            .iter()
            .try_fold(0u64, |total, r| {
                if r.byte_offset < 0 || r.byte_size < 0 {
                    return None;
                }
                r.byte_offset.checked_add(i64::from(r.byte_size))?;
                total.checked_add(r.byte_size as u64)
            })
            .filter(|n| *n <= i32::MAX as u64)
            .ok_or_else(|| DsError::failure("Invalid or excessive mesh byte ranges."))?;
        if key.attachment.data_format == LayerAttachmentDataformat::NeuroglancerPrecomputed {
            let id = requests
                .first()
                .and_then(|r| r.segment_id)
                .ok_or_else(|| DsError::failure("Segment id parameter is required"))?;
            if requests
                .iter()
                .filter_map(|r| r.segment_id)
                .any(|other| other != id)
            {
                return Err(DsError::failure(
                    "All requests must have the same segment id",
                ));
            }
            let mesh = self.remote(key, token).await?;
            let root = self
                .vaults
                .vault_path_for_attachment(&key.attachment)
                .await?;
            let (shard, _) = mesh.shards.spec.minishard_info(id);
            let path = root.join(&mesh.shards.spec.shard_filename(shard));
            let mut bytes = Vec::new();
            bytes
                .try_reserve(total as usize)
                .map_err(DsError::from_exception)?;
            for request in requests {
                bytes.extend(
                    path.read_bytes(
                        ByteRange::StartEnd {
                            start: request.byte_offset as u64,
                            end: request.byte_offset as u64 + request.byte_size as u64,
                        },
                        token,
                    )
                    .await?,
                );
            }
            return Ok((bytes, "draco".into()));
        }
        let mut sorted = requests.iter().cloned().enumerate().collect::<Vec<_>>();
        sorted.sort_by_key(|(_, r)| r.byte_offset);
        let (mut parts, format) = match key.attachment.data_format {
            LayerAttachmentDataformat::Hdf5 => {
                self.hdf5(key, move |r| {
                    let format = r.root_string("mesh_format")?;
                    let parts = sorted
                        .into_iter()
                        .map(|(index, request)| {
                            Ok((
                                index,
                                hdf_bytes(r, request.byte_offset as u64, request.byte_size as u64)?,
                            ))
                        })
                        .collect::<DsResult<Vec<_>>>()?;
                    Ok((parts, format))
                })
                .await?
            }
            LayerAttachmentDataformat::Zarr3 => {
                let format = self.attributes(key, token).await?.format.clone();
                let mut parts = Vec::new();
                for (index, request) in sorted {
                    parts.push((
                        index,
                        self.zarr_bytes(
                            key,
                            request.byte_offset,
                            i64::from(request.byte_size),
                            token,
                        )
                        .await?,
                    ));
                }
                (parts, format)
            }
            _ => return Err(unsupported(key)),
        };
        parts.sort_by_key(|(index, _)| *index);
        let mut bytes = Vec::new();
        bytes
            .try_reserve(total as usize)
            .map_err(DsError::from_exception)?;
        for (_, part) in parts {
            bytes.extend(part);
        }
        Ok((bytes, format))
    }
}
fn unsupported(key: &MeshFileKey) -> DsError {
    DsError::failure(format!(
        "Trying to load mesh file with unsupported data format {}",
        key.attachment.data_format
    ))
}
fn zero_chunks(key: &MeshFileKey, ids: &[i64]) -> DsError {
    DsError::failure(format!(
        "Zero mesh chunks for segment {} in mesh file “{}”.",
        ids.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(","),
        key.attachment.name
    ))
}
async fn longs(
    array: &DatasetArray,
    offset: &[i64],
    shape: &[i32],
    token: Option<&str>,
) -> DsResult<Vec<i64>> {
    if offset.iter().any(|n| *n < 0)
        || shape.iter().any(|n| *n < 0)
        || shape
            .iter()
            .try_fold(8i64, |n, s| n.checked_mul(i64::from(*s)))
            .is_none_or(|n| n > 300 * 1024 * 1024)
    {
        return Err(DsError::failure("Invalid mesh table range."));
    }
    super::agglomerate::nd_longs(&array.read_as_multi_array(offset, shape, token).await?)
}
fn hdf_bytes(reader: &Hdf5Reader, start: u64, count: u64) -> DsResult<Vec<u8>> {
    if count > i32::MAX as u64 {
        return Err(DsError::failure("Mesh payload exceeds Int32 byte size."));
    }
    if count == 0 {
        return reader.bytes("neuroglancer", start, 0);
    }
    let shape = reader.dataset_shape("neuroglancer")?;
    if shape.len() != 1 || start >= shape[0] {
        return Err(DsError::failure("Invalid mesh payload offset."));
    }
    let count = count.min(shape[0] - start);
    let mut bytes = Vec::new();
    bytes
        .try_reserve(count as usize)
        .map_err(DsError::from_exception)?;
    let mut offset = 0;
    while offset < count {
        let size = (count - offset).min(64 * 1024 * 1024);
        bytes.extend(
            reader.bytes(
                "neuroglancer",
                start
                    .checked_add(offset)
                    .ok_or_else(|| DsError::failure("Mesh payload offset overflow."))?,
                size,
            )?,
        );
        offset += size;
    }
    Ok(bytes)
}
