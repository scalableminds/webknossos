//! Scala SegmentIndexFileService's volume/bounding-box caches and NativeBucketScanner.
use super::{
    BinaryDataService,
    agglomerate::{AgglomerateFileKey, AgglomerateService, segment_id_at},
    segment_index::{SegmentIndexFileKey, SegmentIndexService},
};
use crate::{
    datareaders::RequestedAdditionalCoordinate,
    datavault::VaultError,
    error::{DsError, DsResult},
    models::{
        BUCKET_LENGTH, BoundingBox, DataSourceId, StaticLayer, Vec3Int,
        data_requests::{
            Cuboid, DataServiceDataRequest, DataServiceRequestSettings, VoxelPosition,
        },
    },
    wk_client::AlfuCache,
};
use std::{collections::HashSet, sync::Arc};
type CacheKey = (DataSourceId, String, String, Option<String>, i64, Vec3Int);
pub struct IndexStatisticsService {
    index: Arc<SegmentIndexService>,
    agglomerates: Arc<AgglomerateService>,
    binary: Arc<BinaryDataService>,
    volumes: AlfuCache<CacheKey, i64>,
    boxes: AlfuCache<CacheKey, BoundingBox>,
}
impl IndexStatisticsService {
    pub fn new(
        index: Arc<SegmentIndexService>,
        agglomerates: Arc<AgglomerateService>,
        binary: Arc<BinaryDataService>,
    ) -> Self {
        let ttl = std::time::Duration::from_secs(2 * 3600);
        let idle = std::time::Duration::from_secs(3600);
        Self {
            index,
            agglomerates,
            binary,
            volumes: AlfuCache::new(10000, ttl, idle),
            boxes: AlfuCache::new(10000, ttl, idle),
        }
    }
    pub fn clear_caches(&self, id: &DataSourceId, layer: Option<&str>) -> usize {
        let matches = |(s, l, _, _, _, _): &CacheKey| s == id && layer.is_none_or(|name| name == l);
        self.volumes.clear_matching(matches) + self.boxes.clear_matching(matches)
    }
    fn cache_key(
        index: &SegmentIndexFileKey,
        mapping: Option<&AgglomerateFileKey>,
        id: i64,
        mag: Vec3Int,
    ) -> DsResult<CacheKey> {
        VoxelPosition::new(Vec3Int::zeros(), mag)?;
        Ok((
            index.data_source_id.clone(),
            index.layer_name.clone(),
            serde_json::to_string(&index.attachment).map_err(DsError::from_exception)?,
            mapping
                .map(|k| serde_json::to_string(&k.attachment))
                .transpose()
                .map_err(DsError::from_exception)?,
            id,
            mag,
        ))
    }
    async fn positions(
        &self,
        index: &SegmentIndexFileKey,
        mapping: Option<&AgglomerateFileKey>,
        id: i64,
        mag: Vec3Int,
        token: Option<&str>,
    ) -> DsResult<Vec<Vec3Int>> {
        let ids = if let Some(key) = mapping {
            let largest = self.agglomerates.largest_agglomerate_id(key, token).await?;
            if id as u64 > largest as u64 {
                Vec::new()
            } else {
                self.agglomerates
                    .segment_ids_for_agglomerate_id(key, id, token)
                    .await?
            }
        } else {
            vec![id]
        };
        let mut seen = HashSet::new();
        let mut positions = Vec::new();
        for id in ids {
            for point in self.index.read_segment_index(index, id, token).await? {
                let point = point / mag;
                if seen.insert(point) {
                    positions.push(point);
                }
            }
        }
        Ok(positions)
    }
    fn requests(
        dataset: &str,
        index: &SegmentIndexFileKey,
        layer: &Arc<StaticLayer>,
        mapping: Option<&AgglomerateFileKey>,
        mag: Vec3Int,
        positions: &[Vec3Int],
    ) -> DsResult<Vec<DataServiceDataRequest>> {
        positions
            .iter()
            .map(|point| {
                Ok(DataServiceDataRequest {
                    dataset_id: Some(dataset.into()),
                    data_source_id: Some(index.data_source_id.clone()),
                    data_layer: Arc::clone(layer),
                    cuboid: Cuboid::new(
                        VoxelPosition::new((*point * mag).scale(BUCKET_LENGTH), mag)?,
                        Vec3Int::full(BUCKET_LENGTH),
                    ),
                    settings: DataServiceRequestSettings {
                        applied_agglomerate: mapping.map(|k| k.attachment.name.clone()),
                        additional_coordinates: None::<Vec<RequestedAdditionalCoordinate>>,
                        ..Default::default()
                    },
                })
            })
            .collect()
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn volume(
        &self,
        dataset: &str,
        layer: &Arc<StaticLayer>,
        index: &SegmentIndexFileKey,
        mapping: Option<&AgglomerateFileKey>,
        id: i64,
        mag: Vec3Int,
        token: Option<&str>,
    ) -> DsResult<i64> {
        self.volumes
            .get_or_load(Self::cache_key(index, mapping, id, mag)?, || async {
                let positions = self.positions(index, mapping, id, mag, token).await?;
                let mut count = 0i64;
                // Bound live bucket buffers; preserve Scala's missing=0 / failure=error semantics.
                for batch in positions.chunks(32) {
                    let requests = Self::requests(dataset, index, layer, mapping, mag, batch)?;
                    for result in self
                        .binary
                        .handle_multiple_bucket_requests(&requests, token)
                        .await?
                    {
                        match result {
                            Ok(bytes) => {
                                count = count.wrapping_add(count_voxels(
                                    &bytes,
                                    layer.bytes_per_element(),
                                    layer.element_class.is_signed(),
                                    id,
                                )?)
                            }
                            Err(VaultError::NotFound) => {}
                            Err(error) => return Err(error.into()),
                        }
                    }
                }
                Ok(count)
            })
            .await
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn bounding_box(
        &self,
        dataset: &str,
        layer: &Arc<StaticLayer>,
        index: &SegmentIndexFileKey,
        mapping: Option<&AgglomerateFileKey>,
        id: i64,
        mag: Vec3Int,
        token: Option<&str>,
    ) -> DsResult<BoundingBox> {
        self.boxes
            .get_or_load(Self::cache_key(index, mapping, id, mag)?, || async {
                let positions =
                    outer_positions(&self.positions(index, mapping, id, mag, token).await?);
                let mut bounds = [i32::MAX, i32::MAX, i32::MAX, i32::MIN, i32::MIN, i32::MIN];
                for batch in positions.chunks(32) {
                    let requests = Self::requests(dataset, index, layer, mapping, mag, batch)?;
                    for (point, result) in batch.iter().zip(
                        self.binary
                            .handle_multiple_bucket_requests(&requests, token)
                            .await?,
                    ) {
                        match result {
                            Ok(bytes) => extend_bounds(
                                &bytes,
                                layer.bytes_per_element(),
                                layer.element_class.is_signed(),
                                id,
                                point.scale(BUCKET_LENGTH),
                                &mut bounds,
                            )?,
                            Err(VaultError::NotFound) => {}
                            Err(error) => return Err(error.into()),
                        }
                    }
                }
                Ok(if bounds.iter().any(|n| *n == i32::MAX || *n == i32::MIN) {
                    BoundingBox::empty()
                } else {
                    BoundingBox::new(
                        Vec3Int::new(bounds[0], bounds[1], bounds[2]),
                        bounds[3].wrapping_sub(bounds[0]).wrapping_add(1),
                        bounds[4].wrapping_sub(bounds[1]).wrapping_add(1),
                        bounds[5].wrapping_sub(bounds[2]).wrapping_add(1),
                    )
                })
            })
            .await
    }
}
fn element_count(data: &[u8], width: usize) -> DsResult<usize> {
    if !matches!(width, 1 | 2 | 4 | 8) || !data.len().is_multiple_of(width) {
        return Err(DsError::failure(
            "Native Exception in BucketScanner: unsupported element width or byte count",
        ));
    }
    Ok(data.len() / width)
}
pub fn count_voxels(data: &[u8], width: usize, signed: bool, id: i64) -> DsResult<i64> {
    let count = element_count(data, width)?;
    Ok((0..count)
        .filter(|index| segment_id_at(data, *index, width, signed) == id)
        .count() as i64)
}
pub fn extend_bounds(
    data: &[u8],
    width: usize,
    signed: bool,
    id: i64,
    origin: Vec3Int,
    bounds: &mut [i32; 6],
) -> DsResult<()> {
    if element_count(data, width)? != (BUCKET_LENGTH as usize).pow(3) {
        return Err(DsError::failure(
            "Native Exception in BucketScanner: elementCount must match exactly one bucket.",
        ));
    }
    for index in 0..(BUCKET_LENGTH as usize).pow(3) {
        if segment_id_at(data, index, width, signed) == id {
            let point = origin
                + Vec3Int::new(
                    (index % 32) as i32,
                    ((index / 32) % 32) as i32,
                    (index / 1024) as i32,
                );
            for (dim, value) in point.to_array().into_iter().enumerate() {
                bounds[dim] = bounds[dim].min(value);
                bounds[dim + 3] = bounds[dim + 3].max(value);
            }
        }
    }
    Ok(())
}
fn outer_positions(points: &[Vec3Int]) -> Vec<Vec3Int> {
    let Some(first) = points.first() else {
        return Vec::new();
    };
    let mut min = first.to_array();
    let mut max = min;
    for point in points {
        for (dim, n) in point.to_array().into_iter().enumerate() {
            min[dim] = min[dim].min(n);
            max[dim] = max[dim].max(n);
        }
    }
    points
        .iter()
        .filter(|p| {
            p.to_array()
                .into_iter()
                .enumerate()
                .any(|(dim, n)| n == min[dim] || n == max[dim])
        })
        .copied()
        .collect()
}
