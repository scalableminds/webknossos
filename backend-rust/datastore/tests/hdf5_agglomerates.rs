use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    datareaders::hdf5::Hdf5Reader,
    models::{DataSourceId, ElementClass, LayerAttachment},
    services::agglomerate::{AgglomerateFileKey, AgglomerateService},
};
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/agglomerates")
        .join(format!("{name}.hdf5"))
}
fn key(path: PathBuf) -> AgglomerateFileKey {
    AgglomerateFileKey {
        data_source_id: DataSourceId::new("ds", "org"),
        layer_name: "seg".into(),
        attachment: LayerAttachment::from_json(
            &json!({"name":"agg","path":path,"dataFormat":"hdf5"}),
        )
        .unwrap(),
    }
}
fn service() -> Arc<AgglomerateService> {
    AppState::new(DatastoreConfig::defaults(Path::new("/tmp"))).agglomerates
}
#[test]
fn numeric_conversions_match_actual_jhdf5_unsigned_and_float_readers() {
    let oracle: Value = serde_json::from_str(include_str!(
        "fixtures/agglomerates/jhdf5_numeric_oracle.json"
    ))
    .unwrap();
    for name in ["contiguous", "chunked_v1", "chunked_v4"] {
        let reader = Hdf5Reader::open(&fixture(name)).unwrap();
        for case in oracle.as_array().unwrap() {
            let dataset = case["name"].as_str().unwrap();
            if case["target"] == "float32" {
                let actual = reader.float32_values(dataset, 0, 999);
                assert_eq!(
                    actual.is_ok(),
                    case["ok"].as_bool().unwrap(),
                    "{name}: {case}"
                );
                if let Ok(actual) = actual {
                    assert_eq!(
                        actual,
                        serde_json::from_value::<Vec<f32>>(case["values"].clone()).unwrap()
                    );
                }
            } else {
                let actual = reader.uint64_values(dataset, 0, 999, None);
                assert_eq!(
                    actual.is_ok(),
                    case["ok"].as_bool().unwrap(),
                    "{name}: {case}"
                );
                if let Ok(actual) = actual {
                    assert_eq!(
                        actual,
                        case["values"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|v| v.as_str().unwrap().parse::<u64>().unwrap())
                            .collect::<Vec<_>>()
                    );
                }
            }
        }
    }
}
#[tokio::test]
async fn real_files_match_independent_h5py_graph_and_mapping_oracles() {
    let svc = service();
    for name in ["real_70", "real_100"] {
        let oracle: Value = serde_json::from_slice(
            &std::fs::read(fixture(name).with_file_name(format!("{name}_oracle.json"))).unwrap(),
        )
        .unwrap();
        let key = key(fixture(name));
        assert_eq!(
            svc.largest_agglomerate_id(&key, None).await.unwrap(),
            oracle["largest_id"].as_i64().unwrap()
        );
        let ids = (0..oracle["mapping"].as_array().unwrap().len() as i64).collect::<Vec<_>>();
        let mapped = svc
            .agglomerate_ids_for_segment_ids(&key, &ids, None)
            .await
            .unwrap();
        assert_eq!(
            mapped,
            oracle["mapping"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().parse::<i64>().unwrap())
                .collect::<Vec<_>>()
        );
        for query in oracle["queries"].as_array().unwrap() {
            let id = query["id"].as_i64().unwrap();
            let expected = query["segments"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().parse::<u64>().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                svc.segment_ids_for_agglomerate_id(&key, id, None)
                    .await
                    .unwrap(),
                expected.iter().map(|v| *v as i64).collect::<Vec<_>>()
            );
            let graph = svc
                .generate_agglomerate_graph(&key, id, None)
                .await
                .unwrap();
            assert_eq!(graph.segments, expected);
            assert_eq!(
                json!(
                    graph
                        .positions
                        .iter()
                        .map(|p| [p.x, p.y, p.z])
                        .collect::<Vec<_>>()
                ),
                query["positions"]
            );
            assert_eq!(
                json!(
                    graph
                        .edges
                        .iter()
                        .map(|e| [e.source.to_string(), e.target.to_string()])
                        .collect::<Vec<_>>()
                ),
                query["edges"]
            );
            assert_eq!(
                graph.affinities,
                serde_json::from_value::<Vec<f32>>(query["affinities"].clone()).unwrap()
            );
            let tree = svc.generate_tree(&key, id, None).await.unwrap();
            assert_eq!(tree.trees[0].nodes.len(), graph.positions.len());
            if let Some(segment) = expected.first() {
                let position = svc
                    .position_for_segment_id(&key, *segment as i64, None)
                    .await
                    .unwrap();
                assert_eq!(json!(position), query["positions"][0]);
            }
        }
    }
}
#[tokio::test]
async fn generated_layouts_and_cached_id_blocks_preserve_mapping_and_empty_graphs() {
    let svc = service();
    for name in ["contiguous", "chunked_v1", "chunked_v4"] {
        let key = key(fixture(name));
        assert_eq!(
            svc.agglomerate_ids_for_segment_ids(&key, &[5, 1, 2, 0], None)
                .await
                .unwrap(),
            [2, 1, 1, 0]
        );
        assert_eq!(
            svc.apply_agglomerate(&key, ElementClass::Uint8, vec![0, 1, 2, 3, 4, 5], None)
                .await
                .unwrap(),
            [0, 1, 1, 1, 2, 2]
        );
        let graph = svc.generate_agglomerate_graph(&key, 1, None).await.unwrap();
        assert_eq!(graph.segments, [1, 2, 3]);
        assert_eq!(graph.affinities, [0.5, 0.25]);
        assert!(
            svc.generate_agglomerate_graph(&key, 0, None)
                .await
                .unwrap()
                .segments
                .is_empty()
        );
        assert_eq!(
            svc.position_for_segment_id(&key, 5, None).await.unwrap().x,
            21
        );
        assert!(
            svc.agglomerate_ids_for_segment_ids(&key, &[u64::MAX as i64], None)
                .await
                .is_err()
        );
        assert!(
            svc.segment_ids_for_agglomerate_id(&key, 3, None)
                .await
                .is_err()
        );
    }
}

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "wk-hdf-agg-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}
fn request(
    path: &Path,
    x: i32,
) -> webknossos_datastore::models::data_requests::DataServiceDataRequest {
    use webknossos_datastore::models::{
        StaticLayer, Vec3Int,
        data_requests::{
            Cuboid, DataServiceDataRequest, DataServiceRequestSettings, VoxelPosition,
        },
    };
    let layer=StaticLayer::from_json(&json!({"name":"seg","category":"segmentation","dataFormat":"zarr","elementClass":"uint8","largestSegmentId":5,"boundingBox":{"topLeft":[0,0,0],"width":64,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":"/tmp/seg"}],"attachments":{"agglomerates":[{"name":"agg","path":path,"dataFormat":"hdf5"}]}})).unwrap();
    DataServiceDataRequest {
        dataset_id: None,
        data_source_id: Some(DataSourceId::new("ds", "org")),
        data_layer: Arc::new(layer),
        cuboid: Cuboid::new(
            VoxelPosition::new(Vec3Int::new(x, 0, 0), Vec3Int::ones()).unwrap(),
            Vec3Int::full(32),
        ),
        settings: DataServiceRequestSettings {
            applied_agglomerate: Some("agg".into()),
            ..Default::default()
        },
    }
}
#[tokio::test]
async fn cumsum_single_split_spatial_and_empty_ranges_map_like_scala() {
    use webknossos_datastore::services::{
        agglomerate::AgglomerateDataMapper, binary_data::AgglomerateMapper,
    };
    for max_range in [2, 1310720] {
        let root = temp();
        let file = root.join("agg.hdf5");
        std::fs::copy(fixture("contiguous"), &file).unwrap();
        std::fs::write(
            root.join("cumsum.json"),
            serde_json::to_vec(
                &json!({"cumsum":[3,5],"max_ids":{"32_0_0_32_32_32":5,"0_0_0_32_32_32":3}}),
            )
            .unwrap(),
        )
        .unwrap();
        let mut config = DatastoreConfig::defaults(&root);
        config.cache.agglomerate_file.cumsum_max_reader_range = max_range;
        let state = AppState::new(config);
        let mapper = AgglomerateDataMapper(Arc::clone(&state.agglomerates));
        assert_eq!(
            mapper
                .apply(&request(&file, 0), vec![0, 1, 2, 3], None)
                .await
                .unwrap(),
            [0, 1, 1, 1]
        );
        assert_eq!(
            mapper
                .apply(&request(&file, 32), vec![0, 4, 5], None)
                .await
                .unwrap(),
            [0, 2, 2]
        );
        // A request covering both spatial boxes expands the id range to1..5.
        let mut both = request(&file, 0);
        both.cuboid.width = 64;
        assert_eq!(
            mapper
                .apply(&both, vec![0, 1, 2, 3, 4, 5], None)
                .await
                .unwrap(),
            [0, 1, 1, 1, 2, 2]
        );
        // cumsum also gets parsed for direct id cache lookups, which remain spatially independent.
        assert_eq!(
            state
                .agglomerates
                .agglomerate_ids_for_segment_ids(&key(file.clone()), &[5, 1], None)
                .await
                .unwrap(),
            [2, 1]
        );
        std::fs::write(
            root.join("cumsum.json"),
            serde_json::to_vec(&json!({"max_ids":{"0_0_0_64_32_32":0},"cumsum":[0]})).unwrap(),
        )
        .unwrap();
        state
            .agglomerates
            .clear_caches(&DataSourceId::new("ds", "org"), None);
        assert_eq!(
            mapper
                .apply(&request(&file, 0), vec![0, 0], None)
                .await
                .unwrap(),
            [0, 0]
        );
    }
}
#[tokio::test]
async fn handle_and_id_cache_eviction_reload_and_limits_are_enforced() {
    let root = temp();
    let file = root.join("agg.hdf5");
    std::fs::copy(fixture("contiguous"), &file).unwrap();
    let mut config = DatastoreConfig::defaults(&root);
    config.cache.agglomerate_file.max_file_handle_entries = 1;
    config.cache.agglomerate_file.max_segment_id_entries = 1;
    config.cache.agglomerate_file.block_size = 2;
    config.agglomerate_tree_max_edges = 2;
    config.agglomerate_graph_max_edges = 2;
    let svc = AppState::new(config).agglomerates;
    let k = key(file.clone());
    assert_eq!(
        svc.agglomerate_ids_for_segment_ids(&k, &[5, 1, 2, 0], None)
            .await
            .unwrap(),
        [2, 1, 1, 0]
    );
    assert!(
        svc.generate_tree(&k, 1, None)
            .await
            .unwrap_err()
            .to_string()
            .contains("too many nodes")
    );
    let replacement = root.join("replacement.hdf5");
    std::fs::copy(fixture("remapped"), &replacement).unwrap();
    std::fs::rename(replacement, &file).unwrap();
    assert_eq!(
        svc.agglomerate_ids_for_segment_ids(&k, &[1], None)
            .await
            .unwrap(),
        [1]
    );
    // Graph/tree readers reopen on every operation; id-mapping handles persist until reload.
    assert_eq!(
        svc.generate_tree(&k, 2, None).await.unwrap().trees[0].nodes[0]
            .position
            .x,
        120
    );
    assert_eq!(svc.clear_caches(&k.data_source_id, Some("other")), 0);
    assert_eq!(svc.clear_caches(&k.data_source_id, Some("seg")), 1);
    assert_eq!(
        svc.agglomerate_ids_for_segment_ids(&k, &[1], None)
            .await
            .unwrap(),
        [7]
    );
    assert_eq!(
        svc.agglomerate_ids_for_segment_ids(&key(fixture("contiguous")), &[1], None)
            .await
            .unwrap(),
        [1]
    );
    // The single file slot has evicted k, which now opens its current inode again.
    assert_eq!(
        svc.agglomerate_ids_for_segment_ids(&k, &[1], None)
            .await
            .unwrap(),
        [7]
    );
}
#[tokio::test]
async fn malformed_cumsum_does_not_poison_loads_or_uncached_graph_reads() {
    let root = temp();
    let file = root.join("agg.hdf5");
    std::fs::copy(fixture("contiguous"), &file).unwrap();
    let svc = service();
    let k = key(file);
    std::fs::write(root.join("cumsum.json"), b"not json").unwrap();
    assert!(
        svc.agglomerate_ids_for_segment_ids(&k, &[1], None)
            .await
            .is_err()
    );
    assert_eq!(
        svc.generate_agglomerate_graph(&k, 1, None)
            .await
            .unwrap()
            .segments,
        [1, 2, 3]
    );
    std::fs::write(
        root.join("cumsum.json"),
        serde_json::to_vec(&json!({"max_ids":{"0_0_0_64_32_32":5},"cumsum":[5]})).unwrap(),
    )
    .unwrap();
    assert_eq!(
        svc.agglomerate_ids_for_segment_ids(&k, &[1], None)
            .await
            .unwrap(),
        [1]
    );
}
