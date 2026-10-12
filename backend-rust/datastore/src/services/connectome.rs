//! Scala connectome readers: CSR/CSC agglomerate pairs and ordered synapse attributes.
use crate::{
    datareaders::{
        ChunkContentsCache, DatasetArray,
        hdf5::Hdf5Reader,
        nd_array::{MaDataType, NdArray},
        zarr3::open_zarr3_array,
    },
    datavault::{ByteRange, DataVaultService},
    error::{DsError, DsResult},
    models::{
        DataSourceId, LayerAttachment, LayerAttachmentDataformat, StaticLayer, UPath,
        json::{Fields, read_i64, read_list, read_string},
    },
    wk_client::AlfuCache,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
type CacheKey = (DataSourceId, String, String, UPath, Option<String>);
#[derive(Clone)]
pub struct ConnectomeFileKey {
    pub source: DataSourceId,
    pub layer: String,
    pub attachment: LayerAttachment,
}
impl ConnectomeFileKey {
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
pub struct ConnectomeFileInfo {
    pub connectome_file_name: String,
    pub mapping_name: String,
}
#[derive(Clone, Default, Serialize, Debug, PartialEq, Eq)]
pub struct DirectedSynapseList {
    pub r#in: Vec<i64>,
    pub out: Vec<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynapseTypes {
    pub synapse_types: Vec<i64>,
    pub type_to_string: Vec<String>,
}
#[derive(Clone, Copy)]
pub enum Direction {
    Src,
    Dst,
}
impl Direction {
    fn key(self) -> &'static str {
        match self {
            Self::Src => "synapse_to_src_agglomerate",
            Self::Dst => "synapse_to_dst_agglomerate",
        }
    }
}
#[derive(Clone)]
struct Attributes {
    mapping: String,
    types: Vec<String>,
}
enum TableShape {
    NumericVector,
    Positions,
    LongVector,
}
pub struct ConnectomeService {
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    hdf5: AlfuCache<CacheKey, Arc<Hdf5Reader>>,
    attributes: AlfuCache<CacheKey, Arc<Attributes>>,
    arrays: AlfuCache<(CacheKey, String), Arc<DatasetArray>>,
}
impl ConnectomeService {
    pub fn new(vaults: DataVaultService, chunks: Arc<ChunkContentsCache>) -> Self {
        Self {
            vaults,
            chunks,
            hdf5: AlfuCache::new(30, Duration::from_secs(7200), Duration::from_secs(3600)),
            attributes: AlfuCache::with_defaults(),
            arrays: AlfuCache::with_defaults(),
        }
    }
    pub fn look_up(
        source: &DataSourceId,
        layer: &StaticLayer,
        name: &str,
    ) -> DsResult<ConnectomeFileKey> {
        let attachment = layer
            .attachments
            .as_ref()
            .and_then(|a| a.connectomes.iter().find(|a| a.name == name))
            .cloned()
            .ok_or_else(DsError::empty)?;
        if !attachment.path.is_absolute() {
            return Err(DsError::failure(
                "Path of connectome file is ambiguous, must be absolute.",
            ));
        }
        Ok(ConnectomeFileKey {
            source: source.clone(),
            layer: layer.name.clone(),
            attachment,
        })
    }
    pub fn clear_caches(&self, source: &DataSourceId, layer: Option<&str>) -> usize {
        let matches =
            |(s, l, _, _, _): &CacheKey| s == source && layer.is_none_or(|name| name == l);
        self.hdf5.clear_matching(matches)
            + self.attributes.clear_matching(matches)
            + self.arrays.clear_matching(|(key, _)| matches(key))
            + self.chunks.clear_for_source(source, layer)
    }
    fn supported(key: &ConnectomeFileKey) -> DsResult<()> {
        if matches!(
            key.attachment.data_format,
            LayerAttachmentDataformat::Hdf5 | LayerAttachmentDataformat::Zarr3
        ) {
            Ok(())
        } else {
            Err(DsError::failure(format!(
                "Trying to load connectome file with unsupported data format {}",
                key.attachment.data_format
            )))
        }
    }
    async fn hdf5(&self, key: &ConnectomeFileKey) -> DsResult<Arc<Hdf5Reader>> {
        self.hdf5
            .get_or_load(key.cache_key(), || async {
                let path = key
                    .attachment
                    .path
                    .to_local_path()
                    .map_err(|_| DsError::failure("HDF5 connectomes require a local file."))?;
                tokio::task::spawn_blocking(move || Hdf5Reader::open(&path).map(Arc::new))
                    .await
                    .map_err(DsError::from_exception)?
            })
            .await
            .map_err(|e| e.wrap("Could not open connectome file for reading."))
    }
    async fn array(
        &self,
        key: &ConnectomeFileKey,
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
    async fn attributes(
        &self,
        key: &ConnectomeFileKey,
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
                        DsError::from(e).wrap("Could not read connectome file zarr group file.")
                    })?;
                let error = "Could not parse connectome file attributes from zarr group file.";
                let json: Value = serde_json::from_slice(&bytes)
                    .map_err(|e| DsError::from_exception(e).wrap(error))?;
                let vx = &json["attributes"]["voxelytics"];
                read_i64(&vx["artifact_schema_version"])
                    .map_err(|e| DsError::failure(e.to_string()).wrap(error))?;
                let mut f = Fields::new(&vx["artifact_attributes"]);
                let mapping = f.req("mapping_name", read_string);
                let types = f.req("synapse_type_names", |v| read_list(v, read_string));
                f.finish()
                    .map_err(|e| DsError::failure(e.to_string()).wrap(error))?;
                Ok(Arc::new(Attributes {
                    mapping: mapping.map_err(|e| DsError::failure(e.to_string()).wrap(error))?,
                    types: types.map_err(|e| DsError::failure(e.to_string()).wrap(error))?,
                }))
            })
            .await
    }
    pub async fn mapping_name(
        &self,
        key: &ConnectomeFileKey,
        token: Option<&str>,
    ) -> DsResult<String> {
        Self::supported(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            let file = self.hdf5(key).await?;
            tokio::task::spawn_blocking(move || file.root_string("metadata/mapping_name"))
                .await
                .map_err(DsError::from_exception)?
                .map_err(|e| {
                    e.wrap(format!(
                        "Could not read encoding from connectome file “{}”.",
                        key.attachment.name
                    ))
                })
        } else {
            Ok(self.attributes(key, token).await?.mapping.clone())
        }
    }
    pub async fn list(
        &self,
        source: &DataSourceId,
        layer: &StaticLayer,
        token: Option<&str>,
    ) -> Vec<ConnectomeFileInfo> {
        let mut infos = Vec::new();
        for attachment in layer
            .attachments
            .as_ref()
            .map(|a| a.connectomes.as_slice())
            .unwrap_or(&[])
        {
            let result = async {
                let key = Self::look_up(source, layer, &attachment.name)?;
                let mapping = self.mapping_name(&key, token).await?;
                Ok::<_, DsError>(ConnectomeFileInfo {
                    connectome_file_name: attachment.name.clone(),
                    mapping_name: mapping,
                })
            }
            .await;
            match result {
                Ok(info) => infos.push(info),
                Err(e) => {
                    tracing::warn!(source=%source,attachment=%attachment.name,error=%e,"Failed to list a connectome file")
                }
            }
        }
        infos
    }
    // Zarr eagerly opens the named array even for an empty query; HDF5 opens only the handle.
    async fn prepare(
        &self,
        key: &ConnectomeFileKey,
        name: &str,
        token: Option<&str>,
    ) -> DsResult<()> {
        Self::supported(key)?;
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            self.hdf5(key).await?;
        } else {
            self.array(key, name, token).await?;
        }
        Ok(())
    }
    async fn read(
        &self,
        key: &ConnectomeFileKey,
        name: &str,
        start: i64,
        count: i32,
        kind: TableShape,
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        let columns = matches!(kind, TableShape::Positions).then_some(3);
        let long_storage = matches!(kind, TableShape::LongVector);
        Self::supported(key)?;
        if count < 0 {
            return Err(DsError::failure("Invalid connectome table range."));
        }
        if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            let file = self.hdf5(key).await?;
            let name = name.to_owned();
            tokio::task::spawn_blocking(move || {
                file.uint64_values(&name, start as u64, count as u64, columns.map(|c| c as u64))
                    .map(|v| v.into_iter().map(|v| v as i64).collect())
            })
            .await
            .map_err(DsError::from_exception)?
        } else {
            let array = self.array(key, name, token).await?;
            let (offset, shape) = if let Some(columns) = columns {
                (vec![start, 0], vec![count, columns])
            } else {
                (vec![start], vec![count])
            };
            let data = array.read_as_multi_array(&offset, &shape, token).await?;
            if long_storage && data.data_type() != MaDataType::Long {
                return Err(DsError::failure(
                    "Connectome index storage must be a Long array.",
                ));
            }
            get_longs(&data)
        }
    }
    async fn scalar(
        &self,
        key: &ConnectomeFileKey,
        name: &str,
        index: i64,
        token: Option<&str>,
    ) -> DsResult<i64> {
        self.read(key, name, index, 1, TableShape::NumericVector, token)
            .await?
            .first()
            .copied()
            .ok_or_else(DsError::empty)
    }
    async fn pointers(
        &self,
        key: &ConnectomeFileKey,
        name: &str,
        index: i64,
        token: Option<&str>,
    ) -> DsResult<(i64, i64)> {
        let values = self
            .read(key, name, index, 2, TableShape::NumericVector, token)
            .await
            .map_err(|e| e.wrap("Could not read offsets from connectome file"))?;
        let start = *values
            .first()
            .ok_or_else(|| DsError::failure("Could not read start offset from connectome file"))?;
        let end = *values
            .get(1)
            .ok_or_else(|| DsError::failure("Could not read end offset from connectome file"))?;
        Ok((start, end))
    }
    pub async fn partners(
        &self,
        key: &ConnectomeFileKey,
        ids: &[i64],
        direction: Direction,
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        self.prepare(key, direction.key(), token).await?;
        let mut values = Vec::new();
        for id in ids {
            values.push(self.scalar(key, direction.key(), *id, token).await?);
        }
        Ok(values)
    }
    pub async fn positions(
        &self,
        key: &ConnectomeFileKey,
        ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<Vec<Vec<i64>>> {
        self.prepare(key, "synapse_positions", token).await?;
        let mut values = Vec::new();
        for id in ids {
            let row = self
                .read(
                    key,
                    "synapse_positions",
                    *id,
                    1,
                    TableShape::Positions,
                    token,
                )
                .await?;
            if row.len() != 3 {
                return Err(DsError::failure(
                    "Could not read synapse position from connectome file.",
                ));
            }
            values.push(row);
        }
        Ok(values)
    }
    pub async fn types(
        &self,
        key: &ConnectomeFileKey,
        ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<SynapseTypes> {
        self.prepare(key, "synapse_types", token).await?;
        let types = if key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            vec![
                "dendritic-shaft-synapse".into(),
                "spine-head-synapse".into(),
                "soma-synapse".into(),
            ]
        } else {
            self.attributes(key, token).await?.types.clone()
        };
        let mut values = Vec::new();
        for id in ids {
            values.push(self.scalar(key, "synapse_types", *id, token).await?);
        }
        Ok(SynapseTypes {
            synapse_types: values,
            type_to_string: types,
        })
    }
    async fn incoming(
        &self,
        key: &ConnectomeFileKey,
        id: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        let (start, end) = self.pointers(key, "CSC_indptr", id, token).await?;
        if start > end {
            return Err(DsError::failure(format!(
                "Agglomerate {id} not present in agglomerate file"
            )));
        }
        let count = range_count(start, end)?;
        let pairs = if count == 0 && key.attachment.data_format == LayerAttachmentDataformat::Hdf5 {
            Vec::new()
        } else {
            self.read(
                key,
                "CSC_agglomerate_pair",
                start,
                count,
                TableShape::LongVector,
                token,
            )
            .await?
        };
        let mut synapses = Vec::new();
        for pair in pairs {
            let (a, b) = self
                .pointers(key, "agglomerate_pair_offsets", pair, token)
                .await?;
            append_range(&mut synapses, a, b)?;
        }
        Ok(synapses)
    }
    async fn outgoing(
        &self,
        key: &ConnectomeFileKey,
        id: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        let (start, end) = self.pointers(key, "CSR_indptr", id, token).await?;
        let a = self
            .scalar(key, "agglomerate_pair_offsets", start, token)
            .await?;
        let b = self
            .scalar(key, "agglomerate_pair_offsets", end, token)
            .await?;
        let mut out = Vec::new();
        append_range(&mut out, a, b)?;
        Ok(out)
    }
    pub async fn synapses(
        &self,
        key: &ConnectomeFileKey,
        ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<Vec<DirectedSynapseList>> {
        if let [id] = ids {
            return Ok(vec![DirectedSynapseList {
                r#in: self
                    .incoming(key, *id, token)
                    .await
                    .map_err(|e| e.wrap("Failed to read ingoing synapses"))?,
                out: self
                    .outgoing(key, *id, token)
                    .await
                    .map_err(|e| e.wrap("Failed to read outgoing synapses"))?,
            }]);
        }
        let ordered = scala_set_order(ids);
        let mut results: HashMap<i64, DirectedSynapseList> = ordered
            .iter()
            .map(|id| (*id, DirectedSynapseList::default()))
            .collect();
        if ordered.len() > 1 {
            for src in &ordered {
                let (start, end) = self.pointers(key, "CSR_indptr", *src, token).await?;
                let count = range_count(start, end)?;
                let columns = if count == 0
                    && key.attachment.data_format == LayerAttachmentDataformat::Hdf5
                {
                    Vec::new()
                } else {
                    self.read(
                        key,
                        "CSR_indices",
                        start,
                        count,
                        TableShape::LongVector,
                        token,
                    )
                    .await?
                };
                for dst in &ordered {
                    if dst == src {
                        continue;
                    }
                    let Some(index) = search_sorted(&columns, *dst) else {
                        continue;
                    };
                    let pair = start
                        .checked_add(index as i64)
                        .ok_or_else(|| DsError::failure("Connectome pair index overflow."))?;
                    let (a, b) = self
                        .pointers(key, "agglomerate_pair_offsets", pair, token)
                        .await?;
                    append_range(&mut results.get_mut(src).expect("known id").out, a, b)?;
                    append_range(&mut results.get_mut(dst).expect("known id").r#in, a, b)?;
                }
            }
        }
        Ok(ids.iter().map(|id| results[id].clone()).collect())
    }
}
fn get_longs(array: &NdArray) -> DsResult<Vec<i64>> {
    match array.data_type() {
        MaDataType::Float => Ok(array
            .storage()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|v| f32::from_le_bytes(*v) as i64)
            .collect()),
        MaDataType::Double => Ok(array
            .storage()
            .as_chunks::<8>()
            .0
            .iter()
            .map(|v| f64::from_le_bytes(*v) as i64)
            .collect()),
        _ => super::agglomerate::nd_longs(array),
    }
}
fn range_count(start: i64, end: i64) -> DsResult<i32> {
    end.checked_sub(start)
        .and_then(|n| i32::try_from(n).ok())
        .filter(|n| *n >= 0)
        .ok_or_else(|| DsError::failure("Invalid connectome table range."))
}
fn append_range(out: &mut Vec<i64>, start: i64, end: i64) -> DsResult<()> {
    // Scala Seq.range yields empty for decreasing ranges; malformed offset arithmetic is bounded.
    if end <= start {
        return Ok(());
    }
    let count = range_count(start, end)? as usize;
    if out
        .len()
        .checked_add(count)
        .is_none_or(|n| n > 64 * 1024 * 1024 / 8)
    {
        return Err(DsError::failure("Connectome synapse list exceeds64 MiB."));
    }
    out.try_reserve(count).map_err(DsError::from_exception)?;
    out.extend(start..end);
    Ok(())
}
fn search_sorted(values: &[i64], needle: i64) -> Option<usize> {
    let mut low = 0;
    let mut high = values.len();
    while low < high {
        let mid = low + (high - low) / 2;
        match values[mid].cmp(&needle) {
            std::cmp::Ordering::Equal => return Some(mid),
            std::cmp::Ordering::Less => low = mid + 1,
            std::cmp::Ordering::Greater => high = mid,
        }
    }
    None
}
/// Scala immutable Set1–4 preserve insertion order; larger sets iterate CHAMP data then children.
pub fn scala_set_order(ids: &[i64]) -> Vec<i64> {
    let mut seen = HashSet::new();
    let values = ids
        .iter()
        .copied()
        .filter(|id| seen.insert(*id))
        .collect::<Vec<_>>();
    if values.len() <= 4 {
        return values;
    }
    fn hash(id: i64) -> u32 {
        let low = id as i32;
        let raw = if i64::from(low) == id {
            low as u32
        } else {
            (id as u64 ^ ((id as u64) >> 32)) as u32
        };
        let h = raw.wrapping_add(!(raw << 9));
        let h = h ^ (h >> 14);
        let h = h.wrapping_add(h << 4);
        h ^ (h >> 10)
    }
    fn visit(values: Vec<(i64, u32)>, shift: u32, out: &mut Vec<i64>) {
        if shift >= 32 {
            out.extend(values.into_iter().map(|v| v.0));
            return;
        }
        let mut groups: [Vec<(i64, u32)>; 32] = std::array::from_fn(|_| Vec::new());
        for v in values {
            groups[((v.1 >> shift) & 31) as usize].push(v);
        }
        for group in &groups {
            if group.len() == 1 {
                out.push(group[0].0);
            }
        }
        for group in groups {
            if group.len() > 1 {
                visit(group, shift + 5, out);
            }
        }
    }
    let mut out = Vec::new();
    visit(
        values.into_iter().map(|id| (id, hash(id))).collect(),
        0,
        &mut out,
    );
    out
}
