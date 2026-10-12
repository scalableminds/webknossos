//! Scala SegmentStatisticsFileService: dense Zarr3 metric tables and exact remapping math.
use crate::{
    datareaders::{
        ChunkContentsCache, DatasetArray,
        nd_array::{MaDataType, NdArray},
        zarr3::open_zarr3_array,
    },
    datavault::{ByteRange, DataVaultService},
    error::{DsError, DsResult},
    models::{
        DataSourceId, LayerAttachment, StaticLayer, UPath, Vec3Int,
        json::{Fields, read_i64, read_string},
    },
    wk_client::AlfuCache,
};
use futures::{StreamExt, stream};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

pub const METRICS: [&str; 7] = [
    "positions",
    "max_distances",
    "volumes",
    "center_of_mass",
    "covariance_matrix",
    "surfaces",
    "sphericities",
];
type CacheKey = (DataSourceId, String, String, UPath, Option<String>);
#[derive(Clone)]
pub struct StatisticsFileKey {
    pub source: DataSourceId,
    pub layer: String,
    pub attachment: LayerAttachment,
}
impl StatisticsFileKey {
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
#[derive(Clone)]
struct Attributes {
    mag: Option<Vec3Int>,
    mapping: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsFileInfos {
    pub mag: Vec3Int,
    pub available_metrics: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_name: Option<String>,
}
pub struct StatisticsFileService {
    vaults: DataVaultService,
    chunks: Arc<ChunkContentsCache>,
    attributes: AlfuCache<CacheKey, Arc<Attributes>>,
    arrays: AlfuCache<(CacheKey, String), Arc<DatasetArray>>,
    metrics: AlfuCache<CacheKey, Arc<Vec<String>>>,
    dense: AlfuCache<CacheKey, bool>,
}
impl StatisticsFileService {
    pub fn new(vaults: DataVaultService, chunks: Arc<ChunkContentsCache>) -> Self {
        Self {
            vaults,
            chunks,
            attributes: AlfuCache::with_defaults(),
            arrays: AlfuCache::with_defaults(),
            metrics: AlfuCache::with_defaults(),
            dense: AlfuCache::with_defaults(),
        }
    }
    pub fn look_up(source: &DataSourceId, layer: &StaticLayer) -> DsResult<StatisticsFileKey> {
        let attachment = layer
            .attachments
            .as_ref()
            .and_then(|a| a.segment_statistics.clone())
            .ok_or_else(|| {
                DsError::failure(
                    "Could not find a registered segment statistics file for this layer.",
                )
                .with_status(axum::http::StatusCode::NOT_FOUND)
            })?;
        if !attachment.path.is_absolute() {
            return Err(DsError::failure(
                "Path of segment statistics file is ambiguous, must be absolute.",
            ));
        }
        Ok(StatisticsFileKey {
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
            + self.metrics.clear_matching(matches)
            + self.dense.clear_matching(matches)
            + self.chunks.clear_for_source(source, layer)
    }
    async fn attributes(
        &self,
        key: &StatisticsFileKey,
        token: Option<&str>,
    ) -> DsResult<Arc<Attributes>> {
        self.attributes.get_or_load(key.cache_key(), || async {
            let group=self.vaults.vault_path_for_attachment(&key.attachment).await?;
            let bytes=group.join("zarr.json").read_bytes(ByteRange::Complete,token).await.map_err(|e|DsError::from(e.wrap("Could not read segment statistics file zarr group file.")))?;
            let parse_error="Could not parse segment statistics file attributes from zarr group file.";
            let json: Value=serde_json::from_slice(&bytes).map_err(|e|DsError::from_exception(e).wrap(parse_error))?;
            let vx=&json["attributes"]["voxelytics"];
            let mut f=Fields::new(&vx["artifact_attributes"]);
            let mag=f.opt("mag",Vec3Int::from_json);
            let mapping=f.opt("mapping_name",read_string);
            f.finish().map_err(|e|DsError::failure(e.to_string()).wrap(parse_error))?;
            let version=read_i64(&vx["artifact_schema_version"]).map_err(|e|DsError::failure(e.to_string()).wrap(parse_error))?;
            if version<11 {return Err(DsError::failure(format!("Segment statistics file has format version {version}, but at least 11 is required.")));}
            let mag=mag.map_err(|e|DsError::failure(e.to_string()).wrap(parse_error))?;
            if mag.is_some_and(|m|m.x<=0 || m.y<=0 || m.z<=0) {return Err(DsError::failure("Invalid segment statistics file mag."));}
            Ok(Arc::new(Attributes {mag,mapping: mapping.map_err(|e|DsError::failure(e.to_string()).wrap(parse_error))?.filter(|s|!s.is_empty())}))
        }).await
    }
    async fn array(
        &self,
        key: &StatisticsFileKey,
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
    async fn metrics(
        &self,
        key: &StatisticsFileKey,
        token: Option<&str>,
    ) -> DsResult<Arc<Vec<String>>> {
        self.metrics
            .get_or_load(key.cache_key(), || async {
                let mut metrics = Vec::new();
                for name in METRICS {
                    if self.array(key, name, token).await.is_ok() {
                        metrics.push(name.into());
                    }
                }
                Ok(Arc::new(metrics))
            })
            .await
    }
    async fn check_metric(
        &self,
        key: &StatisticsFileKey,
        name: &str,
        token: Option<&str>,
    ) -> DsResult<()> {
        if !self.metrics(key, token).await?.iter().any(|m| m == name) {
            return Err(DsError::failure(format!(
                "Segment statistics file does not contain the metric “{name}”."
            )));
        }
        Ok(())
    }
    async fn check_dense(&self, key: &StatisticsFileKey, token: Option<&str>) -> DsResult<()> {
        let dense = self
            .dense
            .get_or_load(key.cache_key(), || async {
                let array = self.array(key, "ids", token).await?;
                let length = array
                    .dataset_shape()
                    .and_then(|s| s.first().copied())
                    .ok_or_else(|| {
                        DsError::failure(
                            "Could not determine length of ids array in segment statistics file",
                        )
                    })?;
                if length == 0 {
                    return Ok(false);
                }
                let first = integer_values(&array.read_as_multi_array(&[0], &[1], token).await?)?;
                let last = integer_values(
                    &array
                        .read_as_multi_array(&[length - 1], &[1], token)
                        .await?,
                )?;
                Ok(first.first() == Some(&0) && last.first() == Some(&(length - 1)))
            })
            .await?;
        if !dense {
            return Err(DsError::failure(
                "Segment statistics file does not have dense ids. Only files with dense ids are supported.",
            ));
        }
        Ok(())
    }
    pub async fn mag_and_mapping(
        &self,
        key: &StatisticsFileKey,
        layer: &StaticLayer,
        token: Option<&str>,
    ) -> DsResult<(Vec3Int, Option<String>)> {
        let attrs = self.attributes(key, token).await?;
        let mag = attrs.mag.or_else(|| layer.finest_mag()).ok_or_else(|| {
            DsError::failure(
                "Could not determine mag for segment statistics file, layer has no mags.",
            )
        })?;
        Ok((mag, attrs.mapping.clone()))
    }
    /// Returns whether oversegmentation values need to be combined for the requested mapping.
    pub async fn check_compatible(
        &self,
        key: &StatisticsFileKey,
        layer: &StaticLayer,
        mag: Vec3Int,
        mapping: Option<&str>,
        allow_remapping: bool,
        token: Option<&str>,
    ) -> DsResult<bool> {
        self.check_dense(key, token).await?;
        let (file_mag, file_mapping) = self.mag_and_mapping(key, layer, token).await?;
        if file_mag.x > mag.x || file_mag.y > mag.y || file_mag.z > mag.z {
            return Err(DsError::failure(format!(
                "Requested mag {} is finer than mag {} of segment statistics file. Only the same mag or coarser mags are supported.",
                mag.to_mag_literal(true),
                file_mag.to_mag_literal(true)
            )));
        }
        let mapping = mapping.filter(|s| !s.is_empty());
        let remap = file_mapping.as_deref() != mapping;
        if remap {
            if !allow_remapping {
                return Err(DsError::failure(format!(
                    "Requested mapping name “{}” does not match mapping name “{}” of segment statistics file.",
                    mapping.unwrap_or("(none)"),
                    file_mapping.as_deref().unwrap_or("(none)")
                )));
            }
            if let Some(file_mapping) = file_mapping {
                return Err(DsError::failure(format!(
                    "Requesting a different mapping is only supported for segment statistics files calculated on unmapped data, but this file was computed for mapping “{file_mapping}”."
                )));
            }
        }
        Ok(remap)
    }
    pub async fn infos(
        &self,
        key: &StatisticsFileKey,
        layer: &StaticLayer,
        token: Option<&str>,
    ) -> DsResult<StatisticsFileInfos> {
        let (mag, mapping_name) = self.mag_and_mapping(key, layer, token).await?;
        self.check_dense(key, token).await?;
        Ok(StatisticsFileInfos {
            mag,
            mapping_name,
            available_metrics: (*self.metrics(key, token).await?).clone(),
        })
    }
    async fn read_row(
        &self,
        key: &StatisticsFileKey,
        name: &str,
        id: i64,
        tail: &[i32],
        token: Option<&str>,
    ) -> DsResult<NdArray> {
        let array = self.array(key, name, token).await?;
        let shape = array
            .dataset_shape()
            .ok_or_else(|| DsError::failure("Metric shape is missing."))?;
        if shape.len() != tail.len() + 1
            || !shape[1..]
                .iter()
                .zip(tail)
                .all(|(a, b)| *a == i64::from(*b))
        {
            return Err(DsError::failure("Invalid segment statistics metric shape."));
        }
        let offset = std::iter::once(id)
            .chain(tail.iter().map(|_| 0))
            .collect::<Vec<_>>();
        let shape = std::iter::once(1)
            .chain(tail.iter().copied())
            .collect::<Vec<_>>();
        array.read_as_multi_array(&offset, &shape, token).await
    }
    pub async fn volumes(
        &self,
        key: &StatisticsFileKey,
        ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<Vec<i64>> {
        self.check_metric(key, "volumes", token).await?;
        let results = stream::iter(ids.iter().copied())
            .map(|id| async move {
                integer_values(&self.read_row(key, "volumes", id, &[], token).await?)?
                    .first()
                    .copied()
                    .ok_or_else(|| DsError::failure("Volume row is empty."))
            })
            .buffered(if key.attachment.path.is_remote() {
                32
            } else {
                1
            })
            .collect::<Vec<_>>()
            .await;
        results.into_iter().collect()
    }
    pub async fn float_rows(
        &self,
        key: &StatisticsFileKey,
        name: &str,
        ids: &[i64],
        token: Option<&str>,
    ) -> DsResult<Vec<Vec<f32>>> {
        self.check_metric(key, name, token).await?;
        let tail = match name {
            "center_of_mass" => vec![3],
            "covariance_matrix" => vec![3, 3],
            _ => vec![],
        };
        let futures = ids
            .iter()
            .map(|id| async { float_values(&self.read_row(key, name, *id, &tail, token).await?) })
            .collect::<Vec<_>>();
        let results = stream::iter(futures)
            .buffered(if key.attachment.path.is_remote() {
                32
            } else {
                1
            })
            .collect::<Vec<_>>()
            .await;
        results.into_iter().collect()
    }
}
fn integer_values(array: &NdArray) -> DsResult<Vec<i64>> {
    match array.data_type() {
        MaDataType::Float => Ok(array
            .storage()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b) as i64)
            .collect()),
        MaDataType::Double => Ok(array
            .storage()
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| f64::from_le_bytes(*b) as i64)
            .collect()),
        _ => super::agglomerate::nd_longs(array),
    }
}
fn float_values(array: &NdArray) -> DsResult<Vec<f32>> {
    let values = match array.data_type() {
        MaDataType::Float => array
            .storage()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect::<Vec<_>>(),
        MaDataType::Double => array
            .storage()
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| f64::from_le_bytes(*b) as f32)
            .collect(),
        _ => integer_values(array)?
            .into_iter()
            .map(|v| v as f32)
            .collect(),
    };
    if values.iter().any(|v| !v.is_finite()) {
        return Err(DsError::failure("Segment statistic is not finite."));
    }
    Ok(values)
}
pub fn rescale_volume(volume: i64, file_mag: Vec3Int, requested_mag: Vec3Int) -> DsResult<i64> {
    if file_mag == requested_mag {
        return Ok(volume);
    }
    let divisor = i64::from(requested_mag.product());
    if divisor == 0 {
        return Err(DsError::failure("Invalid magnification volume."));
    }
    Ok(volume
        .wrapping_mul(i64::from(file_mag.product()))
        .wrapping_div(divisor))
}
pub fn weighted_center(centers: &[Vec<f32>], volumes: &[i64]) -> DsResult<[f64; 3]> {
    if centers.len() != volumes.len() || centers.iter().any(|row| row.len() != 3) {
        return Err(DsError::failure("Invalid center-of-mass dimensions."));
    }
    let total = volumes.iter().fold(0i64, |n, v| n.wrapping_add(*v));
    if total <= 0 {
        return Err(DsError::failure(
            "Cannot compute combined center of mass, total volume of segments is zero.",
        ));
    }
    Ok(std::array::from_fn(|dim| {
        centers
            .iter()
            .zip(volumes)
            .map(|(c, v)| f64::from(c[dim]) * (*v as f64))
            .sum::<f64>()
            / (total as f64)
    }))
}
pub fn combined_covariance(
    matrices: &[Vec<f32>],
    centers: &[Vec<f32>],
    volumes: &[i64],
) -> DsResult<[[f32; 3]; 3]> {
    if matrices.len() != volumes.len() || matrices.iter().any(|row| row.len() != 9) {
        return Err(DsError::failure("Invalid covariance dimensions."));
    }
    let total = volumes.iter().fold(0i64, |n, v| n.wrapping_add(*v));
    if total <= 0 {
        return Err(DsError::failure(
            "Cannot compute combined covariance matrix, total volume of segments is zero.",
        ));
    }
    let center = weighted_center(centers, volumes)?;
    Ok(std::array::from_fn(|i| {
        std::array::from_fn(|j| {
            (matrices
                .iter()
                .zip(centers)
                .zip(volumes)
                .map(|((m, c), v)| {
                    (*v as f64)
                        * (f64::from(m[i * 3 + j])
                            + (f64::from(c[i]) - center[i]) * (f64::from(c[j]) - center[j]))
                })
                .sum::<f64>()
                / (total as f64)) as f32
        })
    }))
}
