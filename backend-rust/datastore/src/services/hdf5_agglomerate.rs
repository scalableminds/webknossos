//! Hdf5AgglomerateService: cached mapping blocks/cumsum and fresh graph/tree readers.
use super::{
    agglomerate::{AgglomerateFileKey, apply_segment_id_mapping, collect_segment_ids},
    cumsum::Cumsum,
};
use crate::{
    config::AgglomerateFileCacheConfig,
    datareaders::hdf5::Hdf5Reader,
    error::{DsError, DsResult},
    models::{DataSourceId, ElementClass, UPath, Vec3Int, data_requests::DataServiceDataRequest},
    proto::{AgglomerateEdge, AgglomerateGraph, datastore::Vec3IntProto},
    wk_client::AlfuCache,
};
use lru::LruCache;
use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex},
};
type FileKey = (DataSourceId, String, String, UPath);
struct CachedFile {
    reader: Hdf5Reader,
    ids: Mutex<LruCache<i64, i64>>,
    cumsum: Option<Cumsum>,
}
pub struct Hdf5AgglomerateService {
    files: AlfuCache<FileKey, Arc<CachedFile>>,
    config: AgglomerateFileCacheConfig,
}
pub struct TreeData {
    pub positions: Vec<Vec3IntProto>,
    pub edges: Vec<(i32, i32)>,
}
const ROW_BATCH: u64 = 32768;
fn key(k: &AgglomerateFileKey) -> FileKey {
    (
        k.data_source_id.clone(),
        k.layer_name.clone(),
        k.attachment.name.clone(),
        k.attachment.path.clone(),
    )
}
impl Hdf5AgglomerateService {
    pub fn new(config: AgglomerateFileCacheConfig) -> Self {
        Self {
            files: AlfuCache::new(
                config.max_file_handle_entries as usize,
                std::time::Duration::MAX,
                std::time::Duration::MAX,
            ),
            config,
        }
    }
    pub fn clear_caches(&self, id: &DataSourceId, layer: Option<&str>) -> usize {
        self.files.clear_matching(|(source, name, _, _)| {
            source == id && layer.is_none_or(|layer| layer == name)
        })
    }
    async fn cached(&self, k: &AgglomerateFileKey) -> DsResult<Arc<CachedFile>> {
        let path = k.attachment.local_path()?;
        let entries = self.config.max_segment_id_entries;
        self.files
            .get_or_load(key(k), || async move {
                tokio::task::spawn_blocking(move || {
                    let reader = Hdf5Reader::open(&path)?;
                    let cumsum = path
                        .parent()
                        .map(|p| p.join("cumsum.json"))
                        .filter(|p| p.exists())
                        .map(|p| Cumsum::read(&p))
                        .transpose()?;
                    let capacity = NonZeroUsize::new(entries as usize).ok_or_else(|| {
                        DsError::failure("Invalid agglomerate id cache capacity.")
                    })?;
                    // Keep the configured bound without preallocating 625,000 entries per file.
                    let mut ids = LruCache::unbounded();
                    ids.resize(capacity);
                    Ok(Arc::new(CachedFile {
                        reader,
                        cumsum,
                        ids: Mutex::new(ids),
                    }))
                })
                .await
                .map_err(DsError::from_exception)?
            })
            .await
    }
    async fn fresh<T: Send + 'static>(
        k: &AgglomerateFileKey,
        f: impl FnOnce(&Hdf5Reader) -> DsResult<T> + Send + 'static,
    ) -> DsResult<T> {
        let path = k.attachment.local_path()?;
        tokio::task::spawn_blocking(move || f(&Hdf5Reader::open(&path)?))
            .await
            .map_err(DsError::from_exception)?
    }
    fn map_id(
        file: &CachedFile,
        cache: &mut LruCache<i64, i64>,
        id: i64,
        block: u64,
    ) -> DsResult<i64> {
        if let Some(value) = cache.get(&id) {
            return Ok(*value);
        }
        let start = (id as u64).saturating_sub(block / 2);
        let values = file
            .reader
            .uint64_values("segment_to_agglomerate", start, block, None)?;
        let index = (id as u64) - start;
        let mapped = values
            .get(index as usize)
            .copied()
            .ok_or_else(|| DsError::failure("Segment id exceeds agglomerate mapping."))?
            as i64;
        for (index, value) in values.into_iter().enumerate() {
            cache.put((start + index as u64) as i64, value as i64);
        }
        Ok(mapped)
    }
    pub async fn agglomerate_ids(&self, k: &AgglomerateFileKey, ids: &[i64]) -> DsResult<Vec<i64>> {
        let file = self.cached(k).await?;
        let ids = ids.to_vec();
        let block = self.config.block_size;
        tokio::task::spawn_blocking(move || {
            let mut cache = file.ids.lock().unwrap_or_else(|e| e.into_inner());
            ids.into_iter()
                .map(|id| Self::map_id(&file, &mut cache, id, block))
                .collect()
        })
        .await
        .map_err(DsError::from_exception)?
    }
    pub async fn apply(
        &self,
        k: &AgglomerateFileKey,
        class: ElementClass,
        data: Vec<u8>,
        request: Option<&DataServiceDataRequest>,
    ) -> DsResult<Vec<u8>> {
        if matches!(class, ElementClass::Float | ElementClass::Double) {
            return Ok(data);
        }
        let width = class.bytes_per_element();
        // Scala's HDF5 DataConverter widens byte/short/int as unsigned regardless of class.
        let ids = collect_segment_ids(&data, width, false)?;
        let file = self.cached(k).await?;
        let block = self.config.block_size;
        let range = if let (Some(cumsum), Some(request)) = (&file.cumsum, request) {
            Some(cumsum.range(request)?)
        } else {
            None
        };
        let max_range = self.config.cumsum_max_reader_range;
        tokio::task::spawn_blocking(move || {
            let mapped = if let Some((start, end)) = range {
                let mut mapped = vec![0i64; ids.len()];
                if end.wrapping_sub(start) < max_range {
                    let values = file.reader.uint64_values(
                        "segment_to_agglomerate",
                        start,
                        end - start + 1,
                        None,
                    )?;
                    for (index, id) in ids.iter().enumerate() {
                        if *id != 0 {
                            let offset = (*id as u64)
                                .checked_sub(start)
                                .and_then(|n| usize::try_from(n).ok())
                                .ok_or_else(|| {
                                    DsError::failure("Segment id is outside cumsum range.")
                                })?;
                            mapped[index] = values.get(offset).copied().ok_or_else(|| {
                                DsError::failure("Segment id is outside cumsum range.")
                            })? as i64;
                        }
                    }
                } else {
                    let mut offset = start;
                    let mut done = vec![false; ids.len()];
                    while offset <= end {
                        let values = file.reader.uint64_values(
                            "segment_to_agglomerate",
                            offset,
                            max_range.min(end - offset) + 1,
                            None,
                        )?;
                        for (index, id) in ids.iter().enumerate() {
                            let id = *id as u64;
                            if !done[index] && id >= offset && id < offset.saturating_add(max_range)
                            {
                                mapped[index] = if id == 0 {
                                    0
                                } else {
                                    values.get((id - offset) as usize).copied().ok_or_else(
                                        || {
                                            DsError::failure(
                                                "Cumsum range exceeds agglomerate mapping.",
                                            )
                                        },
                                    )? as i64
                                };
                                done[index] = true;
                            }
                        }
                        offset = offset
                            .checked_add(max_range)
                            .ok_or_else(|| DsError::failure("Cumsum range overflow."))?;
                    }
                }
                mapped
            } else {
                let mut cache = file.ids.lock().unwrap_or_else(|e| e.into_inner());
                ids.iter()
                    .map(|id| Self::map_id(&file, &mut cache, *id, block))
                    .collect::<DsResult<Vec<_>>>()?
            };
            apply_segment_id_mapping(&data, width, false, &ids, &mapped)
        })
        .await
        .map_err(DsError::from_exception)?
    }
    pub async fn largest(k: &AgglomerateFileKey) -> DsResult<i64> {
        Self::fresh(k, |reader| {
            let shape = reader.dataset_shape("agglomerate_to_segments_offsets")?;
            if shape.len() != 1 || shape[0] == 0 {
                return Err(DsError::failure("Invalid agglomerate offsets shape."));
            }
            Ok((shape[0] - 1) as i64)
        })
        .await
    }
    pub async fn segments(k: &AgglomerateFileKey, id: i64) -> DsResult<Vec<i64>> {
        Self::fresh(k, move |reader| {
            let (start, count) = range(reader, "agglomerate_to_segments_offsets", id)?;
            Ok(
                uint_table(reader, "agglomerate_to_segments", start, count, None)?
                    .into_iter()
                    .map(|n| n as i64)
                    .collect(),
            )
        })
        .await
    }
    pub async fn tree(k: &AgglomerateFileKey, id: i64, limit: u64) -> DsResult<TreeData> {
        Self::fresh(k, move |reader| {
            let (node_start, nodes) = range(reader, "agglomerate_to_segments_offsets", id)?;
            let (edge_start, edges) = range(reader, "agglomerate_to_edges_offsets", id)?;
            check_limits(nodes, edges, limit)?;
            Ok(TreeData {
                positions: positions(reader, node_start, nodes)?,
                edges: edges_table(reader, edge_start, edges)?,
            })
        })
        .await
    }
    pub async fn graph(k: &AgglomerateFileKey, id: i64, limit: u64) -> DsResult<AgglomerateGraph> {
        Self::fresh(k, move |reader| {
            let (node_start, nodes) = range(reader, "agglomerate_to_segments_offsets", id)?;
            let (edge_start, edges) = range(reader, "agglomerate_to_edges_offsets", id)?;
            check_limits(nodes, edges, limit)?;
            let segments = uint_table(reader, "agglomerate_to_segments", node_start, nodes, None)?;
            let positions = positions(reader, node_start, nodes)?;
            let mut proto_edges = Vec::new();
            for (s, t) in edges_table(reader, edge_start, edges)? {
                let get = |index: i32| {
                    usize::try_from(index)
                        .ok()
                        .and_then(|i| segments.get(i))
                        .copied()
                        .ok_or_else(|| {
                            DsError::failure("Agglomerate edge index exceeds segment list.")
                        })
                };
                proto_edges.push(AgglomerateEdge {
                    source: get(s)?,
                    target: get(t)?,
                });
            }
            let mut affinities = Vec::new();
            let mut cursor = 0;
            while cursor < edges {
                let count = ROW_BATCH.min(edges - cursor);
                affinities.extend(reader.float32_values(
                    "agglomerate_to_affinities",
                    edge_start + cursor,
                    count,
                )?);
                cursor += count;
            }
            Ok(AgglomerateGraph {
                segments,
                positions,
                edges: proto_edges,
                affinities,
            })
        })
        .await
    }
    pub async fn position(k: &AgglomerateFileKey, id: i64) -> DsResult<Vec3Int> {
        Self::fresh(k, move |reader| {
            let mapping = reader.uint64_values("segment_to_agglomerate", id as u64, 1, None)?;
            let agglomerate = *mapping
                .first()
                .ok_or_else(|| DsError::failure("Segment id exceeds mapping."))?;
            let (mut low, count) = range(
                reader,
                "agglomerate_to_segments_offsets",
                agglomerate as i64,
            )?;
            let mut high = low + count;
            loop {
                if low > high {
                    return Err(DsError::failure(
                        "Could not find segmentId in agglomerate file",
                    ));
                }
                let middle = low + (high - low) / 2;
                let values = reader.uint64_values("agglomerate_to_segments", middle, 1, None)?;
                let value = *values.first().ok_or_else(|| {
                    DsError::failure("Could not find segmentId in agglomerate file")
                })?;
                match value.cmp(&(id as u64)) {
                    std::cmp::Ordering::Equal => {
                        let p =
                            reader.uint64_values("agglomerate_to_positions", middle, 1, Some(3))?;
                        return Ok(Vec3Int::new(p[0] as i32, p[1] as i32, p[2] as i32));
                    }
                    std::cmp::Ordering::Less => low = middle + 1,
                    std::cmp::Ordering::Greater => {
                        if middle == 0 {
                            return Err(DsError::failure(
                                "Could not find segmentId in agglomerate file",
                            ));
                        }
                        high = middle - 1;
                    }
                }
            }
        })
        .await
    }
}
fn range(reader: &Hdf5Reader, name: &str, id: i64) -> DsResult<(u64, u64)> {
    let offsets = reader.uint64_values(name, id as u64, 2, None)?;
    let [start, end] = offsets[..] else {
        return Err(DsError::failure("Invalid agglomerate offsets."));
    };
    Ok((
        start,
        end.checked_sub(start)
            .ok_or_else(|| DsError::failure("Inverted agglomerate offsets."))?,
    ))
}
fn check_limits(nodes: u64, edges: u64, limit: u64) -> DsResult<()> {
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
fn uint_table(
    reader: &Hdf5Reader,
    name: &str,
    start: u64,
    count: u64,
    columns: Option<u64>,
) -> DsResult<Vec<u64>> {
    if count == 0 {
        return Ok(Vec::new());
    }
    if count > i32::MAX as u64 {
        return Err(DsError::failure(
            "Agglomerate table read exceeds Int.MaxValue.",
        ));
    }
    let shape = reader.dataset_shape(name)?;
    if shape.is_empty() || start >= shape[0] {
        return Err(DsError::failure(
            "Agglomerate table offset exceeds dataset.",
        ));
    }
    let count = count.min(shape[0] - start);
    let mut values = Vec::new();
    let mut cursor = 0;
    while cursor < count {
        let rows = ROW_BATCH.min(count - cursor);
        values.extend(
            reader.uint64_values(
                name,
                start
                    .checked_add(cursor)
                    .ok_or_else(|| DsError::failure("Agglomerate range overflow."))?,
                rows,
                columns,
            )?,
        );
        cursor += rows;
    }
    Ok(values)
}
fn positions(reader: &Hdf5Reader, start: u64, count: u64) -> DsResult<Vec<Vec3IntProto>> {
    Ok(
        uint_table(reader, "agglomerate_to_positions", start, count, Some(3))?
            .as_chunks::<3>()
            .0
            .iter()
            .map(|[x, y, z]| Vec3IntProto {
                x: *x as i32,
                y: *y as i32,
                z: *z as i32,
            })
            .collect(),
    )
}
fn edges_table(reader: &Hdf5Reader, start: u64, count: u64) -> DsResult<Vec<(i32, i32)>> {
    Ok(
        uint_table(reader, "agglomerate_to_edges", start, count, Some(2))?
            .as_chunks::<2>()
            .0
            .iter()
            .map(|[s, t]| (*s as i32, *t as i32))
            .collect(),
    )
}
