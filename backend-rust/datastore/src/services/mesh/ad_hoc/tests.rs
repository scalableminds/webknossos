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
    let layer = StaticLayer::from_json(&serde_json::json!({
        "name":"seg",
        "category":"segmentation",
        "dataFormat":"zarr",
        "elementClass":"uint8",
        "largestSegmentId":1,
        "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":"/not-read"}]
    }))
    .unwrap();
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
