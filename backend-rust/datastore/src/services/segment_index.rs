//! Scala `SegmentIndexFileService` + `ZarrSegmentIndexFileService` and `MeshMappingHelper`.
//!
//! A segment index file maps segment ids (through a hash table) to the mag-1 top-left corners of
//! the buckets containing them. Zarr3 and local HDF5 attachments share the Scala hash contract.
use std::{collections::HashSet, sync::Arc};

use futures::{StreamExt, stream};
use serde_json::Value;

use crate::{
    access::TokenContext,
    datareaders::{
        ChunkContentsCache, DatasetArray, hdf5::Hdf5Reader, nd_array::NdArray,
        zarr3::open_zarr3_array,
    },
    datavault::{ByteRange, DataVaultService},
    error::{DsError, DsResult},
    models::{
        BUCKET_LENGTH, DataSourceId, LayerAttachment, StaticLayer, UPath, Vec3Int,
        enums::LayerAttachmentDataformat,
    },
    services::agglomerate::AgglomerateService,
    tracingstore_client::TracingstoreClient,
    wk_client::{AlfuCache, WkClient},
};

/// Apache commons-codec `MurmurHash3.hash128x64(data)` (seed 0), both 64-bit halves.
pub fn murmur3_x64_128(data: &[u8]) -> (i64, i64) {
    const C1: u64 = 0x87c3_7b91_1142_53d5;
    const C2: u64 = 0x4cf5_ad43_2745_937f;
    fn fmix(mut k: u64) -> u64 {
        k ^= k >> 33;
        k = k.wrapping_mul(0xff51_afd7_ed55_8ccd);
        k ^= k >> 33;
        k = k.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
        k ^ (k >> 33)
    }
    let (mut h1, mut h2) = (0u64, 0u64);
    let blocks = data.len() / 16;
    for i in 0..blocks {
        let b = &data[i * 16..i * 16 + 16];
        let mut k1 = u64::from_le_bytes(b[..8].try_into().expect("8 bytes"));
        let mut k2 = u64::from_le_bytes(b[8..].try_into().expect("8 bytes"));
        k1 = k1.wrapping_mul(C1).rotate_left(31).wrapping_mul(C2);
        h1 ^= k1;
        h1 = h1
            .rotate_left(27)
            .wrapping_add(h2)
            .wrapping_mul(5)
            .wrapping_add(0x52dc_e729);
        k2 = k2.wrapping_mul(C2).rotate_left(33).wrapping_mul(C1);
        h2 ^= k2;
        h2 = h2
            .rotate_left(31)
            .wrapping_add(h1)
            .wrapping_mul(5)
            .wrapping_add(0x3849_5ab5);
    }
    let tail = &data[blocks * 16..];
    let (mut k1, mut k2) = (0u64, 0u64);
    for (i, byte) in tail.iter().enumerate() {
        if i < 8 {
            k1 ^= u64::from(*byte) << (8 * i);
        } else {
            k2 ^= u64::from(*byte) << (8 * (i - 8));
        }
    }
    if tail.len() > 8 {
        k2 = k2.wrapping_mul(C2).rotate_left(33).wrapping_mul(C1);
        h2 ^= k2;
    }
    if !tail.is_empty() {
        k1 = k1.wrapping_mul(C1).rotate_left(31).wrapping_mul(C2);
        h1 ^= k1;
    }
    let len = data.len() as u64;
    h1 ^= len;
    h2 ^= len;
    h1 = h1.wrapping_add(h2);
    h2 = h2.wrapping_add(h1);
    h1 = fmix(h1);
    h2 = fmix(h2);
    h1 = h1.wrapping_add(h2);
    h2 = h2.wrapping_add(h1);
    (h1 as i64, h2 as i64)
}

/// Scala `ArrayArtifactHashing.getHashFunction`.
pub fn hash_function(name: &str) -> DsResult<fn(i64) -> i64> {
    match name {
        "identity" => Ok(|x| x),
        // `Math.abs` of the second half of the big-endian encoding's hash.
        "murmurhash3_x64_128" => Ok(|x| murmur3_x64_128(&x.to_be_bytes()).1.wrapping_abs()),
        other => Err(DsError::failure(format!(
            "scala.MatchError: {other} (of class java.lang.String)"
        ))),
    }
}

/// Scala `SegmentIndexFileKey`.
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentIndexFileKey {
    pub data_source_id: DataSourceId,
    pub layer_name: String,
    pub attachment: LayerAttachment,
}

/// Scala `SegmentIndexFileAttributes` (voxelytics artifact attributes of the group `zarr.json`).
#[derive(Debug, Clone, Copy)]
struct Attributes {
    n_hash_buckets: i64,
    hash: fn(i64) -> i64,
    uint16_entries: bool,
}

type FileKey = (DataSourceId, String, String, UPath, Option<String>);
type ArrayKey = (FileKey, String);

type Hdf5Key = (DataSourceId, String, String, UPath);
struct Hdf5Index {
    reader: Hdf5Reader,
    buckets: u64,
    hash: fn(i64) -> i64,
}

fn longs(array: &NdArray) -> DsResult<Vec<i64>> {
    crate::services::agglomerate::nd_longs(array)
}

/// Validate table ranges before DatasetArray allocates a hyperslab.
fn check_range(array: &DatasetArray, start: i64, end: i64, columns: Option<i64>) -> DsResult<()> {
    let shape = array
        .header()
        .dataset_shape()
        .ok_or_else(|| DsError::failure("Segment-index table shape is missing."))?;
    if shape.len() != if columns.is_some() { 2 } else { 1 }
        || start < 0
        || end < start
        || end > shape[0]
        || columns.is_some_and(|n| shape[1] != n)
        || (end - start)
            .checked_mul(columns.unwrap_or(1))
            .and_then(|n| n.checked_mul(8))
            .is_none_or(|n| n > 64 * 1024 * 1024)
    {
        return Err(DsError::failure(
            "Invalid or excessive segment-index table range.",
        ));
    }
    Ok(())
}

pub struct SegmentIndexService {
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    arrays: AlfuCache<ArrayKey, Arc<DatasetArray>>,
    attributes: AlfuCache<FileKey, Arc<Attributes>>,
    hdf5: Arc<AlfuCache<Hdf5Key, Arc<Hdf5Index>>>,
}

impl SegmentIndexService {
    pub fn new(vaults: DataVaultService, chunks: Arc<ChunkContentsCache>) -> Self {
        Self {
            vaults,
            chunks,
            arrays: AlfuCache::with_defaults(),
            attributes: AlfuCache::with_defaults(),
            hdf5: Arc::new(AlfuCache::new(
                100,
                std::time::Duration::MAX,
                std::time::Duration::MAX,
            )),
        }
    }

    /// Scala `lookUpSegmentIndexFileKey` (no attachment: `Empty`).
    pub fn look_up(
        data_source_id: &DataSourceId,
        layer: &StaticLayer,
    ) -> DsResult<SegmentIndexFileKey> {
        let attachment = layer
            .attachments
            .as_ref()
            .and_then(|a| a.segment_index.clone())
            .ok_or_else(DsError::empty)?;
        if !attachment.path.is_absolute() {
            return Err(DsError::failure(
                "Path of segment index file is ambiguous, must be absolute.",
            ));
        }
        Ok(SegmentIndexFileKey {
            data_source_id: data_source_id.clone(),
            layer_name: layer.name.clone(),
            attachment,
        })
    }

    pub fn clear_caches(&self, id: &DataSourceId, layer: Option<&str>) -> usize {
        let matches = |(s, l, _, _, _): &FileKey| s == id && layer.is_none_or(|layer| layer == l);
        self.attributes.clear_matching(matches)
            + self.arrays.clear_matching(|(file, _)| matches(file))
            + self
                .hdf5
                .clear_matching(|(s, l, _, _)| s == id && layer.is_none_or(|name| name == l))
            + self.chunks.clear_for_source(id, layer)
    }

    fn file_id(key: &SegmentIndexFileKey) -> FileKey {
        (
            key.data_source_id.clone(),
            key.layer_name.clone(),
            key.attachment.name.clone(),
            key.attachment.path.clone(),
            key.attachment.credential_id.clone(),
        )
    }

    async fn read_attributes(
        &self,
        key: &SegmentIndexFileKey,
        token: Option<&str>,
    ) -> DsResult<Arc<Attributes>> {
        let cache_key = Self::file_id(key);
        self.attributes
            .get_or_load(cache_key, || async {
                let group = self
                    .vaults
                    .vault_path_for_attachment(&key.attachment)
                    .await?;
                let bytes = group
                    .join("zarr.json")
                    .read_bytes(ByteRange::Complete, token)
                    .await
                    .map_err(|e| {
                        DsError::from(e.wrap("Could not read segment index file zarr group file"))
                    })?;
                let parse_failed =
                    "Could not parse segment index file attributes from zarr group file.";
                let json: Value = serde_json::from_slice(&bytes)
                    .map_err(|e| DsError::failure(e.to_string()).wrap(parse_failed))?;
                let vx = &json["attributes"]["voxelytics"];
                let attrs = &vx["artifact_attributes"];
                let parsed = (|| {
                    vx["artifact_schema_version"].as_i64()?;
                    Some((
                        attrs["n_hash_buckets"].as_i64()?,
                        attrs["hash_function"].as_str()?.to_owned(),
                        attrs["dtype_bucket_entries"].as_str()?.to_owned(),
                    ))
                })();
                let (n_hash_buckets, hash_name, dtype) = parsed
                    .ok_or_else(|| DsError::failure("error.path.missing").wrap(parse_failed))?;
                Ok(Arc::new(Attributes {
                    n_hash_buckets,
                    hash: hash_function(&hash_name)?,
                    uint16_entries: dtype == "uint16",
                }))
            })
            .await
    }

    async fn array(
        &self,
        key: &SegmentIndexFileKey,
        name: &str,
        token: Option<&str>,
    ) -> DsResult<Arc<DatasetArray>> {
        let cache_key = (Self::file_id(key), name.to_owned());
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

    async fn read_hdf5(&self, key: &SegmentIndexFileKey, segment: i64) -> DsResult<Vec<Vec3Int>> {
        let path = key.attachment.local_path()?;
        let cache_key = (
            key.data_source_id.clone(),
            key.layer_name.clone(),
            key.attachment.name.clone(),
            key.attachment.path.clone(),
        );
        let file = self
            .hdf5
            .get_or_load(cache_key, || async move {
                tokio::task::spawn_blocking(move || {
                    let reader = Hdf5Reader::open(&path)?;
                    let buckets = reader.root_u64("n_hash_buckets")?;
                    if buckets == 0 {
                        return Err(DsError::failure(
                            "Segment index n_hash_buckets must be positive.",
                        ));
                    }
                    let hash = hash_function(&reader.root_string("hash_function")?)?;
                    Ok(Arc::new(Hdf5Index {
                        reader,
                        buckets,
                        hash,
                    }))
                })
                .await
                .map_err(DsError::from_exception)?
            })
            .await?;
        tokio::task::spawn_blocking(move || {
            let bucket = (file.hash)(segment) as u64 % file.buckets;
            let offsets = file.reader.u64_slice("hash_bucket_offsets", bucket, 2, false)?;
            let [start, end] = offsets[..] else {
                return Err(DsError::failure("Invalid segment-index bucket offsets."));
            };
            if end < start {
                return Err(DsError::failure("Inverted segment-index bucket offsets."));
            }
            if start == end {
                return Ok(Vec::new());
            }
            let shape = file.reader.dataset_shape("hash_buckets")?;
            if shape.len() != 2 || end > shape[0] {
                return Err(DsError::failure("Segment-index bucket range exceeds matrix."));
            }
            let rows = (end - start).checked_add(1)
                .ok_or_else(|| DsError::failure("Segment-index bucket range overflow."))?;
            let buckets = file.reader.u64_slice("hash_buckets", start, rows, true)?;
            let Some([_, top_start, top_end]) = buckets.as_chunks::<3>().0.iter()
                .find(|row| row[0] == segment as u64) else {
                return Ok(Vec::new());
            };
            if file.reader.root_string("dtype_bucket_entries")? != "uint16" {
                return Err(DsError::failure(
                    "value for dtype_bucket_entries in segment index file is not supported, only uint16 is supported",
                ));
            }
            let shape = file.reader.dataset_shape("top_lefts")?;
            if top_end < top_start || shape.len() != 2 || *top_end > shape[0] {
                return Err(DsError::failure("Invalid segment-index top-left range."));
            }
            let values = file.reader.u16_matrix("top_lefts", *top_start, top_end - top_start)?;
            Ok(values.as_chunks::<3>().0.iter()
                .map(|[x, y, z]| Vec3Int::new(*x as i16 as i32, *y as i16 as i32, *z as i16 as i32))
                .collect())
        })
        .await
        .map_err(DsError::from_exception)?
    }

    /// Scala `readSegmentIndex`: mag-1 bucket top-lefts (as bucket indices); missing segments
    /// give an empty list.
    pub async fn read_segment_index(
        &self,
        key: &SegmentIndexFileKey,
        segment_id: i64,
        token: Option<&str>,
    ) -> DsResult<Vec<Vec3Int>> {
        match key.attachment.data_format {
            LayerAttachmentDataformat::Zarr3 => {}
            LayerAttachmentDataformat::Hdf5 => return self.read_hdf5(key, segment_id).await,
            other => {
                return Err(DsError::failure(format!(
                    "Trying to load segment index file with unsupported data format {other}"
                )));
            }
        }
        let attributes = self.read_attributes(key, token).await?;
        if attributes.n_hash_buckets == 0 {
            return Err(DsError::failure(
                "Segment index n_hash_buckets must be positive.",
            ));
        }
        let offsets = self.array(key, "hash_bucket_offsets", token).await?;
        let bucket_index =
            ((attributes.hash)(segment_id) as u64 % attributes.n_hash_buckets as u64) as i64;
        check_range(
            &offsets,
            bucket_index,
            bucket_index
                .checked_add(2)
                .ok_or_else(|| DsError::failure("Segment-index offset overflow."))?,
            None,
        )?;
        let range = longs(
            &offsets
                .read_as_multi_array(&[bucket_index], &[2], token)
                .await?,
        )?;
        let [start, end] = range[..] else {
            return Err(DsError::failure("java.lang.ArrayIndexOutOfBoundsException"));
        };
        if start == end {
            return Ok(Vec::new());
        }
        let buckets = self.array(key, "hash_buckets", token).await?;
        check_range(&buckets, start, end, Some(3))?;
        // Scala reads one row past the bucket end.
        let rows = i32::try_from(end - start + 1)
            .map_err(|_| DsError::failure("Segment-index bucket range overflow."))?;
        let bucket = longs(
            &buckets
                .read_as_multi_array(&[start, 0], &[rows, 3], token)
                .await?,
        )?;
        let Some(entry) = bucket
            .as_chunks::<3>()
            .0
            .iter()
            .find(|row| row[0] == segment_id)
        else {
            return Ok(Vec::new());
        };
        let (top_left_start, top_left_end) = (entry[1], entry[2]);
        if !attributes.uint16_entries {
            return Err(DsError::failure(
                "value for dtype_bucket_entries in segment index file is not supported, only uint16 is supported",
            ));
        }
        let top_lefts = self.array(key, "top_lefts", token).await?;
        check_range(&top_lefts, top_left_start, top_left_end, Some(3))?;
        let count = i32::try_from(top_left_end - top_left_start)
            .map_err(|_| DsError::failure("Segment-index top-left range overflow."))?;
        if count == 0 {
            return Ok(Vec::new());
        }
        let values = longs(
            &top_lefts
                .read_as_multi_array(&[top_left_start, 0], &[count, 3], token)
                .await?,
        )?;
        // `getShort` of the stored values.
        Ok(values
            .as_chunks::<3>()
            .0
            .iter()
            .map(|[x, y, z]| Vec3Int::new(*x as i16 as i32, *y as i16 as i32, *z as i16 as i32))
            .collect())
    }

    /// Scala `combinedOverSegmentIdsWithAutoBatching` + `readSegmentIndex`.
    pub async fn read_segment_indices(
        &self,
        key: &SegmentIndexFileKey,
        segment_ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<Vec<Vec3Int>> {
        let parallelity = if key.attachment.path.is_remote() {
            32
        } else {
            1
        };
        let results: Vec<DsResult<Vec<Vec3Int>>> = stream::iter(segment_ids.iter().copied())
            .map(|id| self.read_segment_index(key, id, token))
            .buffered(parallelity)
            .collect()
            .await;
        Ok(results
            .into_iter()
            .collect::<DsResult<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect())
    }
}

/// Scala `topLeftsToDistinctTargetMagBucketPositions` (bucket indices in the target mag).
pub fn top_lefts_to_target_mag_buckets(top_lefts: &[Vec3Int], mag: Vec3Int) -> Vec<Vec3Int> {
    let mut out: Vec<Vec3Int> = Vec::new();
    let mut seen = HashSet::new();
    for top_left in top_lefts {
        let index = top_left.scale(BUCKET_LENGTH) / mag / Vec3Int::full(BUCKET_LENGTH);
        if seen.insert(index) {
            out.push(index);
        }
    }
    out
}

/// Scala `MeshMappingHelper.segmentIdsForAgglomerateIdIfNeeded`.
#[allow(clippy::too_many_arguments)]
pub async fn segment_ids_for_agglomerate_id_if_needed(
    agglomerates: &AgglomerateService,
    wk_client: &WkClient,
    tracingstore: &TracingstoreClient,
    data_source_id: &DataSourceId,
    layer: &StaticLayer,
    target_mapping: Option<&str>,
    editable_mapping_tracing_id: Option<&str>,
    annotation_version: Option<i64>,
    agglomerate_id: i64,
    mapping_name_for_mesh_file: Option<&str>,
    omit_missing: bool,
    tc: &TokenContext,
) -> DsResult<Vec<i64>> {
    let token = tc.user_token.as_deref();
    match (target_mapping, editable_mapping_tracing_id) {
        (None, None) => Ok(vec![agglomerate_id]),
        (Some(mapping), None) if mapping_name_for_mesh_file == Some(mapping) => {
            Ok(vec![agglomerate_id])
        }
        (Some(mapping), None) => {
            let key = AgglomerateService::look_up(data_source_id, layer, mapping)?;
            match agglomerates
                .segment_ids_for_agglomerate_id(&key, agglomerate_id, token)
                .await
            {
                Ok(ids) => Ok(ids),
                Err(_) if omit_missing => Ok(Vec::new()),
                Err(e) => Err(e),
            }
        }
        (Some(mapping), Some(tracing_id)) => {
            let uri = wk_client.get_tracingstore_uri().await?;
            let result = tracingstore
                .editable_mapping_segment_ids(
                    &uri,
                    tracing_id,
                    annotation_version,
                    agglomerate_id,
                    tc,
                )
                .await?;
            if result.agglomerate_id_is_present {
                Ok(result.segment_ids)
            } else {
                let key = AgglomerateService::look_up(data_source_id, layer, mapping)?;
                agglomerates
                    .segment_ids_for_agglomerate_id(&key, agglomerate_id, token)
                    .await
            }
        }
        (None, Some(_)) => Err(DsError::failure(
            "Cannot determine segment ids for editable mapping without base mapping",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn murmur_hash_matches_commons_codec() {
        // Java oracle: Math.abs(MurmurHash3.hash128x64(ByteBuffer.allocate(8).putLong(x).array())(1)).
        let hash = hash_function("murmurhash3_x64_128").unwrap();
        for (x, expected) in [
            (0i64, 984742418921750958i64),
            (1, 9164143957834486442u64 as i64),
            (2, 2983188039803277069),
            (42, 4652386224612382441),
            (123456789, 1106643466084692845),
            (-1, 7575356704511641263),
            (i64::MAX, 5541611926769433220),
            (i64::MIN, 332970308327370340),
            (9007199254740993, 7009409829992723470),
        ] {
            assert_eq!(hash(x), expected, "{x}");
        }
        assert_eq!(hash_function("identity").unwrap()(7), 7);
    }

    #[test]
    fn maps_top_lefts_to_target_mag_buckets() {
        let buckets = top_lefts_to_target_mag_buckets(
            &[
                Vec3Int::new(0, 0, 0),
                Vec3Int::new(1, 0, 0),
                Vec3Int::new(2, 3, 0),
            ],
            Vec3Int::new(2, 2, 1),
        );
        assert_eq!(buckets, [Vec3Int::new(0, 0, 0), Vec3Int::new(1, 1, 0)]);
    }
}
