//! Binary cuboid → mapped segment membership → MarchingCubes, with the Scala actor pool limit.
use crate::{
    datareaders::RequestedAdditionalCoordinate,
    error::{DsError, DsResult},
    models::{
        DataSourceId, StaticLayer, Vec3Double,
        data_requests::{Cuboid, DataServiceDataRequest, DataServiceRequestSettings},
    },
    services::{
        BinaryDataService,
        agglomerate::{AgglomerateDataMapper, AgglomerateService},
        binary_data::AgglomerateMapper,
        mapping::{MappingService, integer_width, narrow_id},
        marching_cubes::marching_cubes,
    },
};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum MappingType {
    Json,
    Agglomerate,
}
impl MappingType {
    pub fn from_json(value: &serde_json::Value) -> crate::models::JsResult<Self> {
        use crate::models::json::{JsError, read_string};
        match read_string(value)?.as_str() {
            "JSON" => Ok(Self::Json),
            "AGGLOMERATE" | "HDF5" => Ok(Self::Agglomerate),
            other => Err(JsError::new(format!(
                "Error. Expected a enum valid value but got {other}."
            ))),
        }
    }
}
#[derive(Clone)]
pub struct AdHocMeshRequest {
    pub dataset_id: Option<String>,
    pub data_source_id: Option<DataSourceId>,
    pub layer: Arc<StaticLayer>,
    pub cuboid: Cuboid,
    pub segment_id: u64,
    pub voxel_size_factor: Vec3Double,
    pub mapping: Option<String>,
    pub mapping_type: Option<MappingType>,
    pub additional_coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
    pub annotation_version: Option<i64>,
    pub find_neighbors: bool,
}
pub struct AdHocMeshService {
    binary: Arc<BinaryDataService>,
    agglomerates: Arc<AgglomerateService>,
    mappings: Arc<MappingService>,
    pool: Arc<Semaphore>,
    timeout: Duration,
}
impl AdHocMeshService {
    pub fn new(
        binary: Arc<BinaryDataService>,
        agglomerates: Arc<AgglomerateService>,
        mappings: Arc<MappingService>,
        timeout: Duration,
        pool_size: usize,
    ) -> Self {
        Self {
            binary,
            agglomerates,
            mappings,
            pool: Arc::new(Semaphore::new(pool_size.max(1))),
            timeout,
        }
    }
    pub async fn generate(
        &self,
        request: AdHocMeshRequest,
        token: Option<&str>,
    ) -> DsResult<(Vec<f32>, Vec<i32>)> {
        tokio::time::timeout(self.timeout, self.generate_inner(request, token))
            .await
            .map_err(|_| DsError::failure("Ad-hoc mesh request timed out."))?
    }
    async fn generate_inner(
        &self,
        request: AdHocMeshRequest,
        token: Option<&str>,
    ) -> DsResult<(Vec<f32>, Vec<i32>)> {
        let permit = Arc::clone(&self.pool)
            .acquire_owned()
            .await
            .map_err(DsError::from_exception)?;
        if !request.layer.is_segmentation() {
            return Err(DsError::failure("Data layer must be a segmentation layer."));
        }
        let width = integer_width(request.layer.element_class)?;
        let count = request.cuboid.volume()?;
        request.cuboid.bottom_right()?;
        let mut data_request = DataServiceDataRequest {
            dataset_id: request.dataset_id,
            data_source_id: request.data_source_id,
            data_layer: request.layer,
            cuboid: request.cuboid,
            settings: DataServiceRequestSettings {
                version: request.annotation_version,
                additional_coordinates: request.additional_coordinates,
                ..Default::default()
            },
        };
        let mut data = self.binary.read(&data_request, token).await?;
        if request.mapping_type == Some(MappingType::Agglomerate) && request.mapping.is_some() {
            // Explicit meshing mappings also apply above BinaryDataService's automatic mag16 limit.
            data_request.settings.applied_agglomerate = request.mapping.clone();
            data = AgglomerateDataMapper(Arc::clone(&self.agglomerates))
                .apply(&data_request, data, token)
                .await
                .map_err(|e| {
                    DsError::from(e).wrap("failed to apply agglomerate for ad-hoc meshing")
                })?;
        }
        if data.len()
            != count
                .checked_mul(width)
                .ok_or_else(|| DsError::failure("Mesh data size overflow."))?
        {
            return Err(DsError::failure(
                "Mesh data does not match cuboid dimensions.",
            ));
        }
        let mapping = if request.mapping_type == Some(MappingType::Json) {
            if let Some(name) = request.mapping.as_deref() {
                let source = data_request
                    .data_source_id
                    .as_ref()
                    .ok_or_else(DsError::empty)?;
                Some(
                    self.mappings
                        .load(source, &data_request.data_layer.name, name, width)
                        .await?,
                )
            } else {
                None
            }
        } else {
            None
        };
        let segment = narrow_id(request.segment_id, width);
        let segment = mapping
            .as_ref()
            .and_then(|m| m.get(&segment))
            .copied()
            .unwrap_or(segment);
        let position = request.cuboid.top_left.in_mag();
        let mag = request.cuboid.mag();
        let scale = [
            mag.x as f32 * request.voxel_size_factor.x as f32,
            mag.y as f32 * request.voxel_size_factor.y as f32,
            mag.z as f32 * request.voxel_size_factor.z as f32,
        ];
        let dimensions = [
            request.cuboid.width as usize,
            request.cuboid.height as usize,
            request.cuboid.depth as usize,
        ];
        tokio::task::spawn_blocking(move || {
            // Keep the pool slot until CPU work finishes, including after the waiting caller times out.
            let _permit = permit;
            let mut membership = Vec::new();
            membership
                .try_reserve_exact(count)
                .map_err(DsError::from_exception)?;
            for bytes in data.chunks_exact(width) {
                let mut word = [0; 8];
                word[..width].copy_from_slice(bytes);
                let id = u64::from_le_bytes(word);
                membership.push(
                    mapping
                        .as_ref()
                        .and_then(|m| m.get(&id))
                        .copied()
                        .unwrap_or(id)
                        == segment,
                );
            }
            marching_cubes(
                &membership,
                dimensions,
                [position.x as f32, position.y as f32, position.z as f32],
                scale,
                request.find_neighbors,
            )
        })
        .await
        .map_err(DsError::from_exception)?
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AppState,
        config::DatastoreConfig,
        models::{Vec3Int, data_requests::VoxelPosition},
    };
    #[tokio::test]
    async fn queue_timeout_keeps_pool_bounded_and_never_starts_a_read() {
        let state = AppState::new(DatastoreConfig::defaults(std::path::Path::new("/srv/wk")));
        let service = AdHocMeshService::new(
            Arc::clone(&state.binary_data),
            Arc::clone(&state.agglomerates),
            Arc::clone(&state.mappings),
            Duration::from_millis(10),
            1,
        );
        let permit = service.pool.acquire().await.unwrap();
        let layer=StaticLayer::from_json(&serde_json::json!({"name":"seg","category":"segmentation","dataFormat":"zarr","elementClass":"uint8","largestSegmentId":1,"boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":"/not-read"}]})).unwrap();
        let request = AdHocMeshRequest {
            dataset_id: None,
            data_source_id: None,
            layer: Arc::new(layer),
            cuboid: Cuboid::new(
                VoxelPosition::new(Vec3Int::zeros(), Vec3Int::ones()).unwrap(),
                Vec3Int::full(2),
            ),
            segment_id: 1,
            voxel_size_factor: Vec3Double::new(1., 1., 1.),
            mapping: None,
            mapping_type: None,
            additional_coordinates: None,
            annotation_version: None,
            find_neighbors: true,
        };
        let error = service.generate(request, None).await.unwrap_err();
        assert_eq!(error.message, "Ad-hoc mesh request timed out.");
        assert_eq!(service.pool.available_permits(), 0);
        assert_eq!(state.binary_data.cached_provider_count(), 0);
        drop(permit);
        assert_eq!(service.pool.available_permits(), 1);
    }
}
