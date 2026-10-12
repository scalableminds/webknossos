//! Scala `AgglomerateService` + `ZarrAgglomerateService` (+ `NativeBucketScanner` mapping helpers).
//!
//! Agglomerate files are layer attachments. Zarr3 attachment groups are read with the existing
//! Zarr3 reader; local HDF5 files use their own cached mapping blocks and fresh graph readers.
use std::{collections::HashSet, sync::Arc, time::SystemTime};

use futures::{StreamExt, stream};

use super::hdf5_agglomerate::Hdf5AgglomerateService;
use crate::{
    config::AgglomerateFileCacheConfig,
    datareaders::{
        ChunkContentsCache, DatasetArray,
        nd_array::{MaDataType, NdArray, to_long_array},
        zarr3::open_zarr3_array,
    },
    datavault::{BoxFuture, DataVaultService, VaultError, VaultResult},
    error::{DsError, DsResult},
    models::{
        DataSourceId, LayerAttachment, StaticLayer, UPath, Vec3Int,
        data_requests::DataServiceDataRequest,
        enums::{ElementClass, LayerAttachmentDataformat},
    },
    proto::{AgglomerateEdge, AgglomerateGraph, SkeletonTracing, datastore as pb},
    services::binary_data::AgglomerateMapper,
    wk_client::AlfuCache,
};

const KEY_SEGMENT_TO_AGGLOMERATE: &str = "segment_to_agglomerate";
const KEY_AGGLOMERATE_TO_SEGMENTS: &str = "agglomerate_to_segments";
const KEY_AGGLOMERATE_TO_SEGMENTS_OFFSETS: &str = "agglomerate_to_segments_offsets";
const KEY_AGGLOMERATE_TO_EDGES: &str = "agglomerate_to_edges";
const KEY_AGGLOMERATE_TO_EDGES_OFFSETS: &str = "agglomerate_to_edges_offsets";
const KEY_AGGLOMERATE_TO_POSITIONS: &str = "agglomerate_to_positions";
const KEY_AGGLOMERATE_TO_AFFINITIES: &str = "agglomerate_to_affinities";

/// Scala `AgglomerateFileKey`.
#[derive(Debug, Clone, PartialEq)]
pub struct AgglomerateFileKey {
    pub data_source_id: DataSourceId,
    pub layer_name: String,
    pub attachment: LayerAttachment,
}

type ArrayKey = (DataSourceId, String, String, UPath, Option<String>, String);

/// `NativeBucketScanner.segmentIdAtIndex`.
pub(crate) fn segment_id_at(
    data: &[u8],
    index: usize,
    bytes_per_element: usize,
    signed: bool,
) -> i64 {
    let b = &data[index * bytes_per_element..(index + 1) * bytes_per_element];
    match (bytes_per_element, signed) {
        (1, true) => i64::from(b[0] as i8),
        (1, false) => i64::from(b[0]),
        (2, true) => i64::from(i16::from_le_bytes([b[0], b[1]])),
        (2, false) => i64::from(u16::from_le_bytes([b[0], b[1]])),
        (4, true) => i64::from(i32::from_le_bytes(b.try_into().expect("4 bytes"))),
        (4, false) => i64::from(u32::from_le_bytes(b.try_into().expect("4 bytes"))),
        _ => i64::from_le_bytes(b.try_into().expect("8 bytes")),
    }
}

fn element_count(data: &[u8], bytes_per_element: usize) -> DsResult<usize> {
    if !matches!(bytes_per_element, 1 | 2 | 4 | 8) {
        return Err(DsError::failure(
            "Native Exception in BucketScanner: unsupported bytesPerElement value",
        ));
    }
    if !data.len().is_multiple_of(bytes_per_element) {
        return Err(DsError::failure(
            "Native Exception in BucketScanner: Bucket bytes length must be divisible by bytesPerElement",
        ));
    }
    Ok(data.len() / bytes_per_element)
}

/// `NativeBucketScanner.collectSegmentIds(skipZeroes = false)` (order unspecified).
pub fn collect_segment_ids(
    data: &[u8],
    bytes_per_element: usize,
    signed: bool,
) -> DsResult<Vec<i64>> {
    let count = element_count(data, bytes_per_element)?;
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for i in 0..count {
        let id = segment_id_at(data, i, bytes_per_element, signed);
        if seen.insert(id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// `NativeBucketScanner.applySegmentIdMapping` (unmapped ids become 0, values truncated).
pub fn apply_segment_id_mapping(
    data: &[u8],
    bytes_per_element: usize,
    signed: bool,
    source: &[i64],
    target: &[i64],
) -> DsResult<Vec<u8>> {
    let count = element_count(data, bytes_per_element)?;
    let mapping: std::collections::HashMap<i64, i64> =
        source.iter().copied().zip(target.iter().copied()).collect();
    let mut out = vec![0u8; data.len()];
    for i in 0..count {
        let id = segment_id_at(data, i, bytes_per_element, signed);
        let mapped = mapping.get(&id).copied().unwrap_or(0);
        out[i * bytes_per_element..(i + 1) * bytes_per_element]
            .copy_from_slice(&mapped.to_le_bytes()[..bytes_per_element]);
    }
    Ok(out)
}

/// `ucar.ma2.Array.getLong` over any integer storage (Java widening of the signed storage type).
pub fn nd_longs(array: &NdArray) -> DsResult<Vec<i64>> {
    let storage = array.storage();
    match array.data_type() {
        MaDataType::Byte => Ok(storage.iter().map(|b| i64::from(*b as i8)).collect()),
        MaDataType::Short => Ok(storage
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| i64::from(i16::from_le_bytes(*c)))
            .collect()),
        _ => to_long_array(array),
    }
}

fn floats(array: &NdArray) -> DsResult<Vec<f32>> {
    match array.data_type() {
        MaDataType::Float => Ok(array
            .storage()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| f32::from_le_bytes(*c))
            .collect()),
        _ => Err(DsError::failure(
            "java.lang.ClassCastException: affinities are not stored as float32",
        )),
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn unsupported_format(key: &AgglomerateFileKey) -> DsError {
    DsError::failure(format!(
        "Trying to load agglomerate file with unsupported data format {}",
        key.attachment.data_format
    ))
}

pub struct AgglomerateService {
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    arrays: AlfuCache<ArrayKey, Arc<DatasetArray>>,
    hdf5: Hdf5AgglomerateService,
    tree_max_edges: u64,
    graph_max_edges: u64,
}

impl AgglomerateService {
    pub fn new(
        vaults: DataVaultService,
        chunks: Arc<ChunkContentsCache>,
        tree_max_edges: u64,
        graph_max_edges: u64,
        hdf5_config: AgglomerateFileCacheConfig,
    ) -> Self {
        Self {
            vaults,
            chunks,
            arrays: AlfuCache::with_defaults(),
            hdf5: Hdf5AgglomerateService::new(hdf5_config),
            tree_max_edges,
            graph_max_edges,
        }
    }

    /// Scala `listAgglomeratesFiles`.
    pub fn list_agglomerate_files(layer: &StaticLayer) -> Vec<String> {
        layer
            .attachments
            .as_ref()
            .map(|a| a.agglomerates.iter().map(|a| a.name.clone()).collect())
            .unwrap_or_default()
    }

    /// Scala `lookUpAgglomerateFileKey` (missing attachment: `Empty`).
    pub fn look_up(
        data_source_id: &DataSourceId,
        layer: &StaticLayer,
        mapping_name: &str,
    ) -> DsResult<AgglomerateFileKey> {
        let attachment = layer
            .attachments
            .as_ref()
            .and_then(|a| a.agglomerates.iter().find(|a| a.name == mapping_name))
            .ok_or_else(DsError::empty)?;
        if !attachment.path.is_absolute() {
            return Err(DsError::failure(
                "Path of agglomerate file is ambiguous, must be absolute.",
            ));
        }
        Ok(AgglomerateFileKey {
            data_source_id: data_source_id.clone(),
            layer_name: layer.name.clone(),
            attachment: attachment.clone(),
        })
    }

    /// Supported attachment formats.
    pub fn supports(key: &AgglomerateFileKey) -> DsResult<()> {
        match key.attachment.data_format {
            LayerAttachmentDataformat::Zarr3 | LayerAttachmentDataformat::Hdf5 => Ok(()),
            _ => Err(unsupported_format(key)),
        }
    }

    pub fn clear_caches(&self, id: &DataSourceId, layer: Option<&str>) -> usize {
        self.arrays
            .clear_matching(|(s, l, _, _, _, _)| s == id && layer.is_none_or(|layer| layer == l))
            + self.hdf5.clear_caches(id, layer)
            + self.chunks.clear_for_source(id, layer)
    }

    async fn array(
        &self,
        key: &AgglomerateFileKey,
        name: &str,
        token: Option<&str>,
    ) -> DsResult<Arc<DatasetArray>> {
        Self::supports(key)?;
        let cache_key = (
            key.data_source_id.clone(),
            key.layer_name.clone(),
            key.attachment.name.clone(),
            key.attachment.path.clone(),
            key.attachment.credential_id.clone(),
            name.to_owned(),
        );
        self.arrays
            .get_or_load(cache_key, || async {
                let group = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                let array = open_zarr3_array(
                    &group.join(name),
                    key.data_source_id.clone(),
                    &key.layer_name,
                    None,
                    None,
                    None,
                    Arc::clone(&self.chunks),
                    token,
                )
                .await?;
                Ok(Arc::new(array))
            })
            .await
    }

    async fn read_longs(
        array: &DatasetArray,
        offset: &[i64],
        shape: &[i32],
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        nd_longs(&array.read_as_multi_array(offset, shape, token).await?)
    }

    async fn map_single_segment(
        array: &DatasetArray,
        segment_id: i64,
        token: Option<&str>,
    ) -> DsResult<i64> {
        Self::read_longs(array, &[segment_id], &[1], token)
            .await?
            .first()
            .copied()
            .ok_or_else(DsError::empty)
    }

    /// Scala `applyAgglomerate` (Zarr3).
    pub async fn apply_agglomerate(
        &self,
        key: &AgglomerateFileKey,
        element_class: ElementClass,
        data: Vec<u8>,
        token: Option<&str>,
    ) -> DsResult<Vec<u8>> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            return self.hdf5.apply(key, element_class, data, None).await;
        }
        let bytes = element_class.bytes_per_element();
        let signed = element_class.is_signed();
        let ids = collect_segment_ids(&data, bytes, signed)?;
        let array = self.array(key, KEY_SEGMENT_TO_AGGLOMERATE, token).await?;
        let mut mapped = Vec::with_capacity(ids.len());
        for id in &ids {
            mapped.push(Self::map_single_segment(&array, *id, token).await?);
        }
        apply_segment_id_mapping(&data, bytes, signed, &ids, &mapped)
    }

    /// (offset, count) of an agglomerate in an offsets array.
    async fn range(
        &self,
        key: &AgglomerateFileKey,
        offsets: &str,
        agglomerate_id: i64,
        token: Option<&str>,
    ) -> DsResult<(i64, i64)> {
        let array = self.array(key, offsets, token).await?;
        let range = Self::read_longs(&array, &[agglomerate_id], &[2], token).await?;
        match range.as_slice() {
            [start, end] if *start >= 0 && *end >= *start => Ok((
                *start,
                end.checked_sub(*start)
                    .ok_or_else(|| DsError::failure("Agglomerate offsets overflow."))?,
            )),
            _ => Err(DsError::failure("java.lang.ArrayIndexOutOfBoundsException")),
        }
    }

    async fn positions(
        &self,
        key: &AgglomerateFileKey,
        start: i64,
        count: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<pb::Vec3IntProto>> {
        let count = i32::try_from(count)
            .map_err(|_| DsError::failure("Agglomerate position range overflow."))?;
        let array = self.array(key, KEY_AGGLOMERATE_TO_POSITIONS, token).await?;
        let values = Self::read_longs(&array, &[start, 0], &[count, 3], token).await?;
        Ok(values
            .as_chunks::<3>()
            .0
            .iter()
            .map(|[x, y, z]| pb::Vec3IntProto {
                x: *x as i32,
                y: *y as i32,
                z: *z as i32,
            })
            .collect())
    }

    async fn edges(
        &self,
        key: &AgglomerateFileKey,
        start: i64,
        count: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<(i32, i32)>> {
        let count = i32::try_from(count)
            .map_err(|_| DsError::failure("Agglomerate edge range overflow."))?;
        let array = self.array(key, KEY_AGGLOMERATE_TO_EDGES, token).await?;
        let values = Self::read_longs(&array, &[start, 0], &[count, 2], token).await?;
        Ok(values
            .as_chunks::<2>()
            .0
            .iter()
            .map(|[s, t]| (*s as i32, *t as i32))
            .collect())
    }

    fn check_limits(nodes: i64, edges: i64, limit: u64) -> DsResult<()> {
        let limit = limit as i64;
        if nodes > limit {
            return Err(DsError::failure(format!(
                "Agglomerate has too many nodes ({nodes} > {limit})"
            )));
        }
        if edges > limit {
            return Err(DsError::failure(format!(
                "Agglomerate has too many edges ({edges} > {limit})"
            )));
        }
        Ok(())
    }

    /// Scala `generateTree` (Zarr3).
    pub async fn generate_tree(
        &self,
        key: &AgglomerateFileKey,
        agglomerate_id: i64,
        token: Option<&str>,
    ) -> DsResult<SkeletonTracing> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            let data =
                Hdf5AgglomerateService::tree(key, agglomerate_id, self.tree_max_edges).await?;
            return Ok(Self::build_tree(
                key,
                agglomerate_id,
                data.positions,
                data.edges,
            ));
        }
        let (node_start, node_count) = self
            .range(
                key,
                KEY_AGGLOMERATE_TO_SEGMENTS_OFFSETS,
                agglomerate_id,
                token,
            )
            .await?;
        let (edge_start, edge_count) = self
            .range(key, KEY_AGGLOMERATE_TO_EDGES_OFFSETS, agglomerate_id, token)
            .await?;
        Self::check_limits(node_count, edge_count, self.tree_max_edges)?;
        let positions = self.positions(key, node_start, node_count, token).await?;
        let edges = self.edges(key, edge_start, edge_count, token).await?;
        Ok(Self::build_tree(key, agglomerate_id, positions, edges))
    }
    fn build_tree(
        key: &AgglomerateFileKey,
        agglomerate_id: i64,
        positions: Vec<pb::Vec3IntProto>,
        edges: Vec<(i32, i32)>,
    ) -> SkeletonTracing {
        let created = now_millis();
        let nodes = positions
            .into_iter()
            .enumerate()
            .map(|(i, position)| pb::Node {
                id: i as i32 + 1,
                position,
                rotation: pb::Vec3DoubleProto {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                radius: 1.0,
                viewport: 1,
                mag: 1,
                bit_depth: 0,
                interpolation: false,
                created_timestamp: created,
                additional_coordinates: Vec::new(),
            })
            .collect();
        let tree = pb::Tree {
            tree_id: (agglomerate_id as i32).wrapping_abs(),
            created_timestamp: created,
            nodes,
            edges: edges
                .into_iter()
                .map(|(s, t)| pb::Edge {
                    source: s.wrapping_add(1),
                    target: t.wrapping_add(1),
                })
                .collect(),
            name: format!("agglomerate {agglomerate_id} ({})", key.attachment.name),
            r#type: Some(pb::TreeTypeProto::Agglomerate as i32),
            agglomerate_info: Some(pb::TreeAgglomerateInfoProto {
                agglomerate_id,
                tracing_id: None,
                mapping_name: Some(key.attachment.name.clone()),
            }),
            ..Default::default()
        };
        SkeletonTracing {
            dataset_name: String::new(),
            trees: vec![tree],
            created_timestamp: created,
            edit_position: pb::Vec3IntProto { x: 0, y: 0, z: 0 },
            edit_rotation: pb::Vec3DoubleProto {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            zoom_level: 2.0,
            version: 0,
            ..Default::default()
        }
    }

    /// Scala `largestAgglomerateId` (Zarr3: first dimension of the offsets array).
    pub async fn largest_agglomerate_id(
        &self,
        key: &AgglomerateFileKey,
        token: Option<&str>,
    ) -> DsResult<i64> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            return Hdf5AgglomerateService::largest(key).await;
        }
        let array = self
            .array(key, KEY_AGGLOMERATE_TO_SEGMENTS_OFFSETS, token)
            .await?;
        array
            .dataset_shape()
            .and_then(|s| s.first().copied())
            .ok_or_else(|| DsError::failure("Could not determine array shape"))
    }

    /// Scala `generateAgglomerateGraph` (Zarr3).
    pub async fn generate_agglomerate_graph(
        &self,
        key: &AgglomerateFileKey,
        agglomerate_id: i64,
        token: Option<&str>,
    ) -> DsResult<AgglomerateGraph> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            return Hdf5AgglomerateService::graph(key, agglomerate_id, self.graph_max_edges).await;
        }
        let (node_start, node_count) = self
            .range(
                key,
                KEY_AGGLOMERATE_TO_SEGMENTS_OFFSETS,
                agglomerate_id,
                token,
            )
            .await?;
        let (edge_start, edge_count) = self
            .range(key, KEY_AGGLOMERATE_TO_EDGES_OFFSETS, agglomerate_id, token)
            .await?;
        Self::check_limits(node_count, edge_count, self.graph_max_edges)?;
        let positions = self.positions(key, node_start, node_count, token).await?;
        let segments_array = self.array(key, KEY_AGGLOMERATE_TO_SEGMENTS, token).await?;
        let segments =
            Self::read_longs(&segments_array, &[node_start], &[node_count as i32], token).await?;
        let edges = self.edges(key, edge_start, edge_count, token).await?;
        let affinities_array = self
            .array(key, KEY_AGGLOMERATE_TO_AFFINITIES, token)
            .await?;
        let affinities = floats(
            &affinities_array
                .read_as_multi_array(&[edge_start], &[edge_count as i32], token)
                .await?,
        )?;
        let segment = |i: i32| {
            usize::try_from(i)
                .ok()
                .and_then(|i| segments.get(i))
                .map(|s| *s as u64)
                .ok_or_else(|| {
                    DsError::failure(format!(
                        "java.lang.ArrayIndexOutOfBoundsException: Index {i}"
                    ))
                })
        };
        let edges = edges
            .into_iter()
            .map(|(s, t)| {
                Ok(AgglomerateEdge {
                    source: segment(s)?,
                    target: segment(t)?,
                })
            })
            .collect::<DsResult<Vec<_>>>()?;
        Ok(AgglomerateGraph {
            segments: segments.iter().map(|s| *s as u64).collect(),
            edges,
            positions,
            affinities,
        })
    }

    /// Scala `segmentIdsForAgglomerateId` (Zarr3).
    pub async fn segment_ids_for_agglomerate_id(
        &self,
        key: &AgglomerateFileKey,
        agglomerate_id: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            return Hdf5AgglomerateService::segments(key, agglomerate_id).await;
        }
        let (start, count) = self
            .range(
                key,
                KEY_AGGLOMERATE_TO_SEGMENTS_OFFSETS,
                agglomerate_id,
                token,
            )
            .await?;
        if count == 0 {
            return Ok(Vec::new());
        }
        let count = i32::try_from(count)
            .map_err(|_| DsError::failure("Agglomerate segment range overflow."))?;
        let array = self.array(key, KEY_AGGLOMERATE_TO_SEGMENTS, token).await?;
        Self::read_longs(&array, &[start], &[count], token).await
    }

    /// Scala `agglomerateIdsForSegmentIds` (Zarr3, 30 lookups in parallel, order kept).
    pub async fn agglomerate_ids_for_segment_ids(
        &self,
        key: &AgglomerateFileKey,
        segment_ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            return self.hdf5.agglomerate_ids(key, segment_ids).await;
        }
        let array = self.array(key, KEY_SEGMENT_TO_AGGLOMERATE, token).await?;
        let results: Vec<DsResult<i64>> = stream::iter(segment_ids.iter().copied())
            .map(|id| {
                let array = Arc::clone(&array);
                async move { Self::map_single_segment(&array, id, token).await }
            })
            .buffered(30)
            .collect()
            .await;
        results.into_iter().collect()
    }

    /// Scala `positionForSegmentId` (Zarr3, unsigned binary search within the agglomerate).
    pub async fn position_for_segment_id(
        &self,
        key: &AgglomerateFileKey,
        segment_id: i64,
        token: Option<&str>,
    ) -> DsResult<Vec3Int> {
        Self::supports(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            return Hdf5AgglomerateService::position(key, segment_id).await;
        }
        let mapping = self.array(key, KEY_SEGMENT_TO_AGGLOMERATE, token).await?;
        let agglomerate_id = Self::map_single_segment(&mapping, segment_id, token).await?;
        let offsets = self
            .array(key, KEY_AGGLOMERATE_TO_SEGMENTS_OFFSETS, token)
            .await?;
        let range = Self::read_longs(&offsets, &[agglomerate_id], &[2], token).await?;
        let [mut low, mut high] = range[..] else {
            return Err(DsError::failure("java.lang.ArrayIndexOutOfBoundsException"));
        };
        let segments = self.array(key, KEY_AGGLOMERATE_TO_SEGMENTS, token).await?;
        let index = loop {
            if low > high {
                return Err(DsError::failure(
                    "Could not find segmentId in agglomerate file",
                ));
            }
            let middle = low + (high - low) / 2;
            let value = Self::map_single_segment(&segments, middle, token).await?;
            match (value as u64).cmp(&(segment_id as u64)) {
                std::cmp::Ordering::Equal => break middle,
                std::cmp::Ordering::Less => low = middle + 1,
                std::cmp::Ordering::Greater => high = middle - 1,
            }
        };
        let positions = self.array(key, KEY_AGGLOMERATE_TO_POSITIONS, token).await?;
        let p = Self::read_longs(&positions, &[index, 0], &[1, 3], token).await?;
        Ok(Vec3Int::new(p[0] as i32, p[1] as i32, p[2] as i32))
    }
}

/// The agglomerate service as `BinaryDataService`'s mapper (Scala `applyAgglomerate`).
pub struct AgglomerateDataMapper(pub Arc<AgglomerateService>);

impl AgglomerateMapper for AgglomerateDataMapper {
    fn apply<'a>(
        &'a self,
        request: &'a DataServiceDataRequest,
        input: Vec<u8>,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<u8>>> {
        Box::pin(async move {
            let mapping = request
                .settings
                .applied_agglomerate
                .as_deref()
                .ok_or(VaultError::NotFound)?;
            let id = request.data_source_id_or_volume_dummy();
            let key = AgglomerateService::look_up(&id, &request.data_layer, mapping)?;
            if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
                return Ok(self
                    .0
                    .hdf5
                    .apply(&key, request.data_layer.element_class, input, Some(request))
                    .await?);
            }
            Ok(self
                .0
                .apply_agglomerate(&key, request.data_layer.element_class, input, token)
                .await?)
        })
    }

    fn clear_caches(&self, id: &DataSourceId, layer: Option<&str>) -> usize {
        self.0.clear_caches(id, layer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_segment_ids_like_the_native_scanner() {
        let data: Vec<u8> = [5u16, 7, 5, 0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let mut ids = collect_segment_ids(&data, 2, false).unwrap();
        ids.sort_unstable();
        assert_eq!(ids, [0, 5, 7]);
        let mapped = apply_segment_id_mapping(&data, 2, false, &[5, 7], &[70000, 9]).unwrap();
        let values: Vec<u16> = mapped
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        // 70000 truncated to 16 bits; unmapped 0 stays 0.
        assert_eq!(values, [70000u32 as u16, 9, 70000u32 as u16, 0]);
        assert!(collect_segment_ids(&[1, 2, 3], 2, false).is_err());
    }
}
