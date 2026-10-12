//! End-to-end service reads through real vaults, readers and bounded caches.
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    datareaders::{
        RequestedAdditionalCoordinate,
        bucket_provider::{BucketProvider, DatasetArrayBucketProvider},
    },
    datavault::VaultError,
    models::{
        BoundingBox, DataFormat, DataSourceId, StaticLayer, Vec3Int,
        data_requests::{
            Cuboid, DataReadInstruction, DataServiceDataRequest, DataServiceRequestSettings,
            VoxelPosition,
        },
    },
    services::{AgglomerateMapper, BinaryDataService, binary_data::convert_to_half_byte},
};
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-binary-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn fixtures(format: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(format)
}
fn state() -> AppState {
    AppState::new(DatastoreConfig::defaults(&temp()))
}
fn layer(
    format: &str,
    path: &Path,
    element: &str,
    bbox: BoundingBox,
    axis: serde_json::Value,
) -> Arc<StaticLayer> {
    Arc::new(serde_json::from_value(json!({"name":"color","category":"color","dataFormat":format,"elementClass":element,"boundingBox":bbox,"mags":[{"mag":[1,1,1],"path":path.to_str().unwrap(),"axisOrder":axis}]})).unwrap())
}
fn request(
    layer: Arc<StaticLayer>,
    position: Vec3Int,
    shape: Vec3Int,
    mag: Vec3Int,
) -> DataServiceDataRequest {
    DataServiceDataRequest {
        dataset_id: Some("dataset-id".into()),
        data_source_id: Some(DataSourceId::new("ds", "org")),
        data_layer: layer,
        cuboid: Cuboid::new(VoxelPosition::new(position, mag).unwrap(), shape),
        settings: DataServiceRequestSettings::default(),
    }
}
fn value(x: i32, y: i32, z: i32) -> u8 {
    (x + 13 * y + 37 * z) as u8
}
fn write_array(p: &Path, format: &str) {
    std::fs::create_dir_all(p).unwrap();
    if format == "zarr" {
        std::fs::write(p.join(".zarray"),serde_json::to_vec(&json!({"zarr_format":2,"shape":[35,35,35],"chunks":[32,32,32],"dtype":"|u1","order":"F","compressor":null,"filters":null,"fill_value":0})).unwrap()).unwrap();
    } else if format == "n5" {
        std::fs::write(
            p.join("attributes.json"),
            serde_json::to_vec(
                &json!({"dimensions":[35,35,35],"blockSize":[32,32,32],"dataType":"uint8"}),
            )
            .unwrap(),
        )
        .unwrap();
    } else {
        std::fs::write(p.parent().unwrap().join("info"),serde_json::to_vec(&json!({"type":"image","data_type":"uint8","num_channels":1,"scales":[{"key":"1","size":[35,35,35],"resolution":[1,1,1],"chunk_sizes":[[32,32,32]],"encoding":"raw"}]})).unwrap()).unwrap();
    }
    for bx in 0..2 {
        for by in 0..2 {
            for bz in 0..2 {
                let shape: [i32; 3] = if format == "zarr" {
                    [32; 3]
                } else {
                    [
                        32.min(35 - bx * 32),
                        32.min(35 - by * 32),
                        32.min(35 - bz * 32),
                    ]
                };
                let mut bytes = Vec::new();
                if format == "n5" {
                    bytes.extend([0, 0, 0, 3]);
                    for d in shape {
                        bytes.extend(d.to_be_bytes());
                    }
                }
                for z in 0..shape[2] {
                    for y in 0..shape[1] {
                        for x in 0..shape[0] {
                            bytes.push(value(bx * 32 + x, by * 32 + y, bz * 32 + z));
                        }
                    }
                }
                let name = match format {
                    "zarr" => format!("{bx}.{by}.{bz}"),
                    "n5" => format!("{bx}/{by}/{bz}"),
                    _ => format!(
                        "{}-{}_{}-{}_{}-{}",
                        bx * 32,
                        bx * 32 + shape[0],
                        by * 32,
                        by * 32 + shape[1],
                        bz * 32,
                        bz * 32 + shape[2]
                    ),
                };
                let target = p.join(name);
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(target, bytes).unwrap();
            }
        }
    }
}
#[test]
fn request_geometry_preserves_floor_alignment_order_and_overflow_limits() {
    let mag = Vec3Int::new(2, 4, 1);
    let p = VoxelPosition::new(Vec3Int::new(-1, 129, 31), mag).unwrap();
    let bucket = p.to_bucket();
    assert_eq!(bucket.bucket_index(), Vec3Int::new(0, 1, 0));
    assert_eq!(bucket.top_left().unwrap().mag1, Vec3Int::new(-64, 128, 0));
    let c = Cuboid::new(
        VoxelPosition::new(Vec3Int::new(31, 31, 31), Vec3Int::ones()).unwrap(),
        Vec3Int::full(2),
    );
    let buckets = c.all_buckets().unwrap();
    assert_eq!(buckets.len(), 8);
    assert_eq!(buckets[0].top_left().unwrap().mag1, Vec3Int::full(32));
    assert_eq!(buckets[7].top_left().unwrap().mag1, Vec3Int::zeros());
    assert!(VoxelPosition::new(Vec3Int::zeros(), Vec3Int::zeros()).is_err());
    let huge = Cuboid::new(
        VoxelPosition::new(Vec3Int::zeros(), Vec3Int::ones()).unwrap(),
        Vec3Int::full(65536),
    );
    assert!(huge.volume().is_err());
    let skinny = Cuboid::new(
        VoxelPosition::new(Vec3Int::zeros(), Vec3Int::ones()).unwrap(),
        Vec3Int::new(134217728, 1, 1),
    );
    assert!(skinny.volume().is_ok());
    assert_eq!(skinny.buckets().unwrap().take(2).count(), 2);
    assert_eq!(
        convert_to_half_byte(&[0x9f, 0x70, 0x55, 0xaf, 0xff]),
        vec![0x97, 0x5a, 0]
    );
}
#[tokio::test]
async fn cross_bucket_reads_clip_bounding_boxes_and_pad_n5_precomputed_edges() {
    for format in ["zarr", "n5", "neuroglancerPrecomputed"] {
        let p = temp();
        let path = if format == "neuroglancerPrecomputed" {
            p.join("1")
        } else {
            p.clone()
        };
        write_array(
            &path,
            if format == "neuroglancerPrecomputed" {
                "precomputed"
            } else {
                format
            },
        );
        let bbox = BoundingBox::new(Vec3Int::new(4, 5, 6), 30, 28, 26);
        let l = layer(format, &path, "uint8", bbox, json!({"x":0,"y":1,"z":2}));
        let s = state();
        let r = request(
            l,
            Vec3Int::new(29, 29, 30),
            Vec3Int::new(7, 6, 5),
            Vec3Int::ones(),
        );
        let actual = s.binary_data.read(&r, None).await.unwrap();
        let mut expected = Vec::new();
        for z in 30..35 {
            for y in 29..35 {
                for x in 29..36 {
                    expected.push(if x < 34 && y < 33 && z < 32 {
                        value(x, y, z)
                    } else {
                        0
                    });
                }
            }
        }
        assert_eq!(actual, expected, "{format}");
        assert_eq!(s.binary_data.cached_provider_count(), 1);
        let mut r = r;
        r.settings.half_byte = true;
        let actual = s.binary_data.read(&r, None).await.unwrap();
        assert_eq!(actual, convert_to_half_byte(&expected));
        let cleared = s.binary_data.clear_cache("org", "ds", Some("color"));
        assert_eq!(cleared.1, 1);
        assert!(cleared.2 > 0);
        assert!(s.chunk_contents_cache.is_empty());
    }
}
#[tokio::test]
async fn native_wkw_rgb_reader_is_connected_to_bucket_provider() {
    let path = fixtures("wkw/lz4hc");
    let l = layer(
        "wkw",
        &path,
        "uint24",
        BoundingBox::new(Vec3Int::zeros(), 16, 8, 8),
        serde_json::Value::Null,
    );
    let s = state();
    let r = request(l, Vec3Int::zeros(), Vec3Int::full(32), Vec3Int::ones());
    let actual = s.binary_data.read(&r, None).await.unwrap();
    let mut expected = Vec::new();
    for z in 0..32 {
        for y in 0..32 {
            for x in 0..32 {
                for c in 0..3 {
                    expected.push(if x < 16 && y < 8 && z < 8 {
                        (c + 3 * x + 11 * y + 37 * z) as u8
                    } else {
                        0
                    });
                }
            }
        }
    }
    assert_eq!(actual, expected);
}
#[tokio::test]
async fn zarr3_n5_and_sharded_precomputed_independent_oracles_through_service() {
    let s = state();
    let l = layer(
        "zarr3",
        &fixtures("zarr3/shard_end"),
        "uint16",
        BoundingBox::new(Vec3Int::zeros(), 7, 6, 5),
        json!({"c":0,"x":1,"y":2,"z":3}),
    );
    let r = request(
        l,
        Vec3Int::new(1, 1, 1),
        Vec3Int::new(6, 5, 4),
        Vec3Int::ones(),
    );
    let actual = s.binary_data.read(&r, None).await.unwrap();
    assert_eq!(
        actual,
        std::fs::read(fixtures("zarr3/shard_end/expected.bin")).unwrap()
    );
    let s = state();
    let l = layer(
        "n5",
        &fixtures("n5/real_gzip"),
        "uint16",
        BoundingBox::new(Vec3Int::new(1, 2, 3), 8, 8, 8),
        json!({"x":0,"y":1,"z":2}),
    );
    let r = request(l, Vec3Int::new(1, 2, 3), Vec3Int::full(8), Vec3Int::ones());
    assert_eq!(
        s.binary_data.read(&r, None).await.unwrap(),
        std::fs::read(fixtures("n5/real_gzip/expected.bin")).unwrap()
    );
    let s = state();
    let path = fixtures("precomputed/shard_murmur/1");
    let l = layer(
        "neuroglancerPrecomputed",
        &path,
        "uint16",
        BoundingBox::new(Vec3Int::new(5, 7, 11), 5, 4, 3),
        json!({"x":0,"y":1,"z":2}),
    );
    let r = request(
        l,
        Vec3Int::new(6, 8, 12),
        Vec3Int::new(4, 3, 2),
        Vec3Int::ones(),
    );
    assert_eq!(
        s.binary_data.read(&r, None).await.unwrap(),
        std::fs::read(fixtures("precomputed/shard_murmur/expected.bin")).unwrap()
    );
}

#[tokio::test]
async fn batch_missing_failures_partial_cuboids_and_reload_are_distinct() {
    let p = temp();
    write_array(&p, "zarr");
    let l = layer(
        "zarr",
        &p,
        "uint8",
        BoundingBox::new(Vec3Int::zeros(), 35, 35, 35),
        json!({"x":0,"y":1,"z":2}),
    );
    let s = state();
    // A corrupt second chunk is a failed bucket, not a missing magnification.
    std::fs::write(p.join("1.0.0"), [1u8]).unwrap();
    let good = request(
        l.clone(),
        Vec3Int::zeros(),
        Vec3Int::full(32),
        Vec3Int::ones(),
    );
    let failed = request(
        l.clone(),
        Vec3Int::new(32, 0, 0),
        Vec3Int::full(32),
        Vec3Int::ones(),
    );
    let missing = request(
        l.clone(),
        Vec3Int::zeros(),
        Vec3Int::full(32),
        Vec3Int::full(2),
    );
    let result = s
        .binary_data
        .handle_multiple_bucket_requests(&[good.clone(), missing.clone(), failed.clone()], None)
        .await
        .unwrap();
    assert!(result[0].is_ok());
    assert!(matches!(result[1], Err(VaultError::NotFound)));
    assert!(matches!(result[2], Err(VaultError::Failure(_))));
    let result = s
        .binary_data
        .handle_data_requests(&[good.clone(), missing.clone(), failed.clone()], None)
        .await;
    assert_eq!(result.missing_indices, vec![1]);
    assert_eq!(result.failed_indices, vec![2]);
    assert_eq!(result.data.len(), 32768);
    let partial = request(
        l.clone(),
        Vec3Int::new(31, 0, 0),
        Vec3Int::new(3, 1, 1),
        Vec3Int::ones(),
    );
    assert_eq!(
        s.binary_data.read(&partial, None).await.unwrap(),
        vec![value(31, 0, 0), 0, 0]
    );
    assert!(
        s.binary_data
            .errors
            .logged_error_count(&DataSourceId::new("ds", "org"))
            > 0
    );
    let instruction = DataReadInstruction {
        data_source_id: DataSourceId::new("ds", "org"),
        data_layer: l.clone(),
        bucket: good.cuboid.top_left.to_bucket(),
        version: Some(7),
    };
    let provider = DatasetArrayBucketProvider::new(
        l.clone(),
        instruction.data_source_id.clone(),
        s.data_vaults.clone(),
        s.chunk_contents_cache.clone(),
    );
    let (a, b) = tokio::join!(
        provider.load(&instruction, None),
        provider.load(&instruction, None)
    );
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(provider.cached_array_count(), 1);
    assert!(
        s.binary_data
            .handle_multiple_bucket_requests(&[partial], None)
            .await
            .is_err()
    );
    let mut extra = (*l).clone();
    extra.name = "color__extra".into();
    let extra = Arc::new(extra);
    let extra = request(extra, Vec3Int::zeros(), Vec3Int::full(32), Vec3Int::ones());
    s.binary_data.read(&extra, None).await.unwrap();
    let before = s.chunk_contents_cache.len();
    let cleared = s.binary_data.clear_cache("org", "ds", Some("color"));
    assert_eq!(cleared.1, 1);
    assert!(cleared.2 > 0 && cleared.2 < before);
    assert_eq!(s.binary_data.cached_provider_count(), 1);
    assert_eq!(
        s.binary_data
            .errors
            .logged_error_count(&DataSourceId::new("ds", "org")),
        0
    );
    // Reload discards the bad cached chunk and old array header. A repaired file reads normally.
    write_array(&p, "zarr");
    assert!(s.binary_data.read(&failed, None).await.is_ok());
    let mut unsupported = (*l).clone();
    unsupported.data_format = DataFormat::Tracing;
    let unsupported = request(
        Arc::new(unsupported),
        Vec3Int::zeros(),
        Vec3Int::new(3, 1, 1),
        Vec3Int::ones(),
    );
    assert!(s.binary_data.read(&unsupported, None).await.is_err());
}
struct MappingFixture;
impl AgglomerateMapper for MappingFixture {
    fn apply<'a>(
        &'a self,
        r: &'a DataServiceDataRequest,
        input: Vec<u8>,
        token: Option<&'a str>,
    ) -> webknossos_datastore::datavault::BoxFuture<
        'a,
        webknossos_datastore::datavault::VaultResult<Vec<u8>>,
    > {
        Box::pin(async move {
            assert_eq!(token, Some("mapping-token"));
            if r.settings.applied_agglomerate.as_deref() == Some("missing") {
                return Err(VaultError::NotFound);
            }
            // Cube is32³ but the layer covers x=1..3. Clipping must have happened already.
            assert!(
                input
                    .as_chunks::<32>()
                    .0
                    .iter()
                    .all(|row| row[0] == 0 && row[3..].iter().all(|b| *b == 0))
            );
            Ok(input
                .into_iter()
                .map(|b| if b == 0 { 0 } else { 0xb0 })
                .collect())
        })
    }
}
#[tokio::test]
async fn clipping_precedes_mapping_and_half_byte_and_missing_mapper_fails() {
    let p = temp();
    write_array(&p, "zarr");
    let l = layer(
        "zarr",
        &p,
        "uint8",
        BoundingBox::new(Vec3Int::new(1, 1, 1), 2, 2, 2),
        json!({"x":0,"y":1,"z":2}),
    );
    let mut seg = (*l).clone();
    seg.kind = webknossos_datastore::models::LayerKind::Segmentation {
        largest_segment_id: None,
        mappings: None,
    };
    let s = state();
    let mut r = request(
        Arc::new(seg),
        Vec3Int::zeros(),
        Vec3Int::full(32),
        Vec3Int::ones(),
    );
    r.settings.applied_agglomerate = Some("mapping".into());
    r.settings.half_byte = true;
    assert!(s.binary_data.read(&r, Some("mapping-token")).await.is_err());
    let service = BinaryDataService::new(
        s.data_vaults.clone(),
        s.chunk_contents_cache.clone(),
        s.health.clone(),
        Some(Arc::new(MappingFixture)),
    );
    let result = service.read(&r, Some("mapping-token")).await.unwrap();
    let mut expected = vec![0; 32768];
    for z in 1..3 {
        for y in 1..3 {
            for x in 1..3 {
                expected[(z * 32 + y) * 32 + x] = 0xb0;
            }
        }
    }
    assert_eq!(result, convert_to_half_byte(&expected));
    r.settings.applied_agglomerate = Some("missing".into());
    assert!(matches!(
        service.read(&r, Some("mapping-token")).await,
        Err(VaultError::NotFound)
    ));
}
#[tokio::test]
async fn batched_additional_axis_is_preserved_during_bbox_clipping() {
    let p = temp();
    let metadata = json!({"zarr_format":2,"shape":[40,1,1,32,32],"chunks":[32,1,1,32,32],"dtype":"|u1","order":"C","compressor":null,"filters":null,"fill_value":0});
    std::fs::write(p.join(".zarray"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    for t in 0..2 {
        let raw: Vec<u8> = (0..32)
            .flat_map(|local| std::iter::repeat_n((1 + t * 32 + local) as u8, 1024))
            .collect();
        std::fs::write(p.join(format!("{t}.0.0.0.0")), raw).unwrap();
    }
    let l = layer(
        "zarr",
        &p,
        "uint8",
        BoundingBox::new(Vec3Int::new(2, 3, 0), 28, 27, 1),
        json!({"c":1,"x":4,"y":3,"z":2}),
    );
    let mut l = (*l).clone();
    l.additional_axes = Some(vec![webknossos_datastore::models::AdditionalAxis {
        name: "t".into(),
        index: 0,
        bounds: vec![0, 40],
    }]);
    let mut r = request(
        Arc::new(l),
        Vec3Int::zeros(),
        Vec3Int::full(32),
        Vec3Int::ones(),
    );
    r.settings.additional_coordinates = Some(vec![RequestedAdditionalCoordinate {
        name: "t".into(),
        value: 4,
        length: Some(32),
    }]);
    let s = state();
    let actual = s.binary_data.read(&r, None).await.unwrap();
    let mut expected = Vec::new();
    for z in 0..32 {
        for y in 0..32 {
            for x in 0..32 {
                expected.push(if (2..30).contains(&x) && (3..30).contains(&y) {
                    (5 + z) as u8
                } else {
                    0
                });
            }
        }
    }
    assert_eq!(actual, expected);
}
#[test]
fn dataset_error_logging_enforces_limit_zero_length_and_internal_health() {
    let s = state();
    let id = DataSourceId::new("ds", "org");
    for _ in 0..10 {
        assert!(
            s.binary_data
                .errors
                .check(&id, None, "test", Err(VaultError::failure("bad")))
                .is_err()
        );
    }
    assert_eq!(s.binary_data.errors.logged_error_count(&id), 5);
    s.binary_data.errors.clear_for_dataset(&id);
    assert!(
        s.binary_data
            .errors
            .check(&id, None, "test", Ok(Vec::new()))
            .is_err()
    );
    assert_eq!(s.binary_data.errors.logged_error_count(&id), 1);
    let e = webknossos_datastore::error::DsError::from_exception("java.lang.InternalError: test");
    assert!(
        s.binary_data
            .errors
            .check(&id, None, "test", Err(VaultError::Failure(e)))
            .is_err()
    );
    assert!(
        s.health
            .recent_problem(std::time::Duration::from_secs(60))
            .is_some()
    );
}

#[tokio::test]
async fn current_token_reaches_http_chunks_after_mag_header_is_cached() {
    use axum::{
        Router,
        extract::{Path as RoutePath, State},
        http::HeaderMap,
        routing::get,
    };
    type Reads = Arc<std::sync::Mutex<Vec<(String, Option<String>)>>>;
    async fn serve(
        State(reads): State<Reads>,
        RoutePath(file): RoutePath<String>,
        headers: HeaderMap,
    ) -> Vec<u8> {
        let token = headers
            .get("X-Auth-Token")
            .map(|v| v.to_str().unwrap().to_owned());
        reads.lock().unwrap().push((file.clone(), token));
        if file == ".zarray" {
            serde_json::to_vec(&json!({"zarr_format":2,"shape":[32,32,64],"chunks":[32,32,32],"dtype":"|u1","order":"C","compressor":null,"filters":null,"fill_value":0})).unwrap()
        } else {
            vec![if file == "0.0.0" { 1 } else { 2 }; 32768]
        }
    }
    let reads: Reads = Arc::new(std::sync::Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route("/array/{file}", get(serve))
                .with_state(reads.clone()),
        )
        .into_future(),
    );
    let base = format!("http://{address}");
    let mut config = DatastoreConfig::defaults(&temp());
    config.http.uri = base.clone();
    let s = AppState::new(config);
    let l:StaticLayer=serde_json::from_value(json!({"name":"color","category":"color","dataFormat":"zarr","elementClass":"uint8","boundingBox":{"topLeft":[0,0,0],"width":64,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":format!("{base}/array")}]})).unwrap();
    let l = Arc::new(l);
    let a = request(
        l.clone(),
        Vec3Int::zeros(),
        Vec3Int::full(32),
        Vec3Int::ones(),
    );
    let b = request(
        l,
        Vec3Int::new(32, 0, 0),
        Vec3Int::full(32),
        Vec3Int::ones(),
    );
    assert_eq!(
        s.binary_data.read(&a, Some("token-a")).await.unwrap(),
        vec![1; 32768]
    );
    assert_eq!(
        s.binary_data.read(&b, Some("token-b")).await.unwrap(),
        vec![2; 32768]
    );
    assert_eq!(
        *reads.lock().unwrap(),
        vec![
            (".zarray".into(), Some("token-a".into())),
            ("0.0.0".into(), Some("token-a".into())),
            ("0.0.1".into(), Some("token-b".into()))
        ]
    );
    server.abort();
}
#[test]
fn frontend_request_json_uses_play_numeric_and_optional_rules() {
    use webknossos_datastore::models::data_requests::{RawCuboidRequest, WebknossosDataRequest};
    let req:WebknossosDataRequest=serde_json::from_value(json!({"position":[1,2,3],"mag":[1,1,1],"cubeSize":32.0,"fourBit":true,"applyAgglomerate":"mapping","additionalCoordinates":[{"name":"t","value":4.0,"length":32.0}],"version":3})).unwrap();
    assert!(req.settings().half_byte);
    assert_eq!(
        req.settings().additional_coordinates.unwrap()[0].length,
        Some(32)
    );
    assert_eq!(req.cuboid().unwrap().width, 32);
    let raw: RawCuboidRequest =
        serde_json::from_value(json!({"position":[0,0,0],"mag":[1,1,1],"cubeSize":[3,4,5]}))
            .unwrap();
    assert!(!raw.settings().half_byte);
    assert_eq!(raw.cuboid().unwrap().volume().unwrap(), 60);
    assert!(
        serde_json::from_value::<WebknossosDataRequest>(
            json!({"position":[1,2,3],"mag":[1,1,1],"cubeSize":1.5})
        )
        .is_err()
    );
}

#[tokio::test]
async fn unsupported_precomputed_encoding_is_not_reported_as_black_cuboid_data() {
    let p = temp();
    std::fs::create_dir_all(p.join("1")).unwrap();
    std::fs::write(p.join("info"),serde_json::to_vec(&json!({"type":"segmentation","data_type":"uint32","num_channels":1,"scales":[{"key":"1","size":[32,32,32],"resolution":[1,1,1],"chunk_sizes":[[32,32,32]],"encoding":"unsupported"}]})).unwrap()).unwrap();
    let l = layer(
        "neuroglancerPrecomputed",
        &p.join("1"),
        "uint32",
        BoundingBox::new(Vec3Int::zeros(), 32, 32, 32),
        json!({"x":0,"y":1,"z":2}),
    );
    let r = request(l, Vec3Int::zeros(), Vec3Int::full(2), Vec3Int::ones());
    let s = state();
    let Err(VaultError::Failure(error)) = s.binary_data.read(&r, None).await else {
        panic!("unsupported codec must fail the whole request")
    };
    assert_eq!(error.status, axum::http::StatusCode::NOT_IMPLEMENTED);
}
#[tokio::test]
async fn anisotropic_magnification_clips_in_mag_space_and_preserves_raw_mag1_origin() {
    let p = temp();
    write_array(&p, "zarr");
    let l = layer(
        "zarr",
        &p,
        "uint8",
        BoundingBox::new(Vec3Int::new(5, 9, 3), 7, 9, 4),
        json!({"x":0,"y":1,"z":2}),
    );
    let mut l = (*l).clone();
    let mut mag = l.mags[0].clone();
    mag.mag = Vec3Int::new(2, 4, 1);
    l.mags.push(mag);
    let r = request(
        Arc::new(l),
        Vec3Int::zeros(),
        Vec3Int::new(8, 8, 8),
        Vec3Int::new(2, 4, 1),
    );
    let s = state();
    let actual = s.binary_data.read(&r, None).await.unwrap();
    let mut expected = Vec::new();
    for z in 0..8 {
        for y in 0..8 {
            for x in 0..8 {
                expected.push(
                    if (2..6).contains(&x) && (2..5).contains(&y) && (3..7).contains(&z) {
                        value(x, y, z)
                    } else {
                        0
                    },
                );
            }
        }
    }
    assert_eq!(actual, expected);
    let r = Cuboid::new(
        VoxelPosition::new(Vec3Int::new(1, 3, 2), Vec3Int::new(2, 4, 1)).unwrap(),
        Vec3Int::new(2, 2, 2),
    );
    assert_eq!(
        r.mag1_bounding_box().unwrap().top_left,
        Vec3Int::new(1, 3, 2)
    );
}
