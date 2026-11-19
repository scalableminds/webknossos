//! Scala `SegmentIndexFileService` + `ZarrSegmentIndexFileService` and `MeshMappingHelper`.
//!
//! A segment index file maps segment ids (through a hash table) to the mag-1 top-left corners of
//! the buckets containing them. Zarr3 and local HDF5 attachments share the Scala hash contract.
use std::{collections::HashSet, sync::Arc};

use futures::{StreamExt, stream};

use crate::{
    access::TokenContext,
    cache::AlfuCache,
    clients::tracingstore::TracingstoreClient,
    clients::wk::WkClient,
    datareaders::{ChunkContentsCache, DatasetArray, hdf5::Hdf5Reader, nd_array::NdArray},
    datavault::DataVaultService,
    error::{DsError, DsResult, blocking},
    models::{BUCKET_LENGTH, DataSourceId, StaticLayer, Vec3Int, enums::LayerAttachmentDataformat},
    services::agglomerate::AgglomerateService,
    services::attachment::{AttachmentArrays, AttachmentFileKey, AttachmentId},
};

/// Scala `ArrayArtifactHashing.getHashFunction`.
pub fn hash_function(name: &str) -> DsResult<fn(i64) -> i64> {
    match name {
        "identity" => Ok(|x| x),
        // Apache commons-codec `Math.abs(MurmurHash3.hash128x64(bigEndianBytes(x))[1])` (seed 0):
        // the second 64-bit half is the high half of the crate's `u128`.
        "murmurhash3_x64_128" => Ok(|x| {
            let hash = murmur3::murmur3_x64_128(&mut &x.to_be_bytes()[..], 0)
                .expect("reading from a slice cannot fail");
            ((hash >> 64) as u64 as i64).wrapping_abs()
        }),
        other => Err(DsError::failure(format!(
            "scala.MatchError: {other} (of class java.lang.String)"
        ))),
    }
}

/// Scala `SegmentIndexFileAttributes` (voxelytics artifact attributes of the group `zarr.json`).
#[derive(Debug, Clone, Copy)]
struct Attributes {
    n_hash_buckets: i64,
    hash: fn(i64) -> i64,
    uint16_entries: bool,
}

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
    zarr: AttachmentArrays,
    attributes: AlfuCache<AttachmentId, Arc<Attributes>>,
    /// Keyed by `AttachmentFileKey::local_id`.
    hdf5: Arc<AlfuCache<AttachmentId, Arc<Hdf5Index>>>,
}

impl SegmentIndexService {
    pub fn new(vaults: DataVaultService, chunks: Arc<ChunkContentsCache>) -> Self {
        Self {
            zarr: AttachmentArrays::new(vaults, chunks),
            attributes: AlfuCache::with_defaults(),
            hdf5: Arc::new(AlfuCache::new(
                100,
                std::time::Duration::MAX,
                std::time::Duration::MAX,
            )),
        }
    }

    /// Scala `lookUpAttachmentFileKey` (no attachment: `Empty`).
    pub fn look_up(
        data_source_id: &DataSourceId,
        layer: &StaticLayer,
    ) -> DsResult<AttachmentFileKey> {
        let attachment = layer
            .attachments
            .as_ref()
            .and_then(|a| a.segment_index.clone())
            .ok_or_else(DsError::empty)?;
        AttachmentFileKey::new(data_source_id, layer, attachment, "segment index")
    }

    pub fn clear_caches(&self, id: &DataSourceId, layer: Option<&str>) -> usize {
        let matches = |key: &AttachmentId| key.belongs_to(id, layer);
        self.attributes.clear_matching(matches)
            + self.hdf5.clear_matching(matches)
            + self.zarr.clear(id, layer)
    }

    async fn read_attributes(
        &self,
        key: &AttachmentFileKey,
        token: Option<&str>,
    ) -> DsResult<Arc<Attributes>> {
        self.attributes
            .get_or_load(key.id(), || async {
                let parse_failed =
                    "Could not parse segment index file attributes from zarr group file.";
                let vx = self
                    .zarr
                    .voxelytics_attributes(
                        &key.attachment,
                        token,
                        |e| {
                            e.wrap("Could not read segment index file zarr group file")
                                .into()
                        },
                        |e| DsError::failure(e.to_string()).wrap(parse_failed),
                    )
                    .await?;
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

    async fn read_hdf5(&self, key: &AttachmentFileKey, segment: i64) -> DsResult<Vec<Vec3Int>> {
        let path = key.attachment.local_path()?;
        let file = self
            .hdf5
            .get_or_load(key.local_id(), || async move {
                blocking(move || {
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
            })
            .await?;
        blocking(move || {
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
        }).await
    }

    /// Scala `readSegmentIndex`: mag-1 bucket top-lefts (as bucket indices); missing segments
    /// give an empty list.
    pub async fn read_segment_index(
        &self,
        key: &AttachmentFileKey,
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
        let offsets = self.zarr.get(key, "hash_bucket_offsets", token).await?;
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
        let buckets = self.zarr.get(key, "hash_buckets", token).await?;
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
        let top_lefts = self.zarr.get(key, "top_lefts", token).await?;
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
        key: &AttachmentFileKey,
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
mod services_index_tests;
