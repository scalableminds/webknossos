mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::send;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{AppState, models::DataSourceId, router};
const ID: &str = "0123456789abcdef01234567";
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-statistics-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p.canonicalize().unwrap()
}
fn array(dir: &Path, shape: &[usize], dtype: &str, data: Vec<u8>) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("zarr.json"),serde_json::to_vec(&json!({"zarr_format":3,"node_type":"array","shape":shape,"data_type":dtype,"chunk_grid":{"name":"regular","configuration":{"chunk_shape":shape}},"chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}],"attributes":{}})).unwrap()).unwrap();
    let chunk = dir.join(
        std::iter::once("c")
            .chain(shape.iter().map(|_| "0"))
            .collect::<PathBuf>(),
    );
    std::fs::create_dir_all(chunk.parent().unwrap()).unwrap();
    std::fs::write(chunk, data).unwrap();
}
fn integers(values: &[u64]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}
fn floats(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}
fn statistics_file(root: &Path) {
    std::fs::create_dir_all(root).unwrap();
    std::fs::write(root.join("zarr.json"),serde_json::to_vec(&json!({"zarr_format":3,"node_type":"group","attributes":{"voxelytics":{"artifact_schema_version":11,"artifact_attributes":{"mag":[2,1,1],"mapping_name":""}}}})).unwrap()).unwrap();
    array(&root.join("ids"), &[4], "uint64", integers(&[0, 1, 2, 3]));
    array(
        &root.join("volumes"),
        &[4],
        "uint64",
        integers(&[0, 8, 24, 0]),
    );
    array(
        &root.join("center_of_mass"),
        &[4, 3],
        "float32",
        floats(&[0., 0., 0., 0., 0., 0., 4., 0., 0., 0., 0., 0.]),
    );
    let matrices = (0..4)
        .flat_map(|_| [1., 0., 0., 0., 1., 0., 0., 0., 1.])
        .collect::<Vec<_>>();
    array(
        &root.join("covariance_matrix"),
        &[4, 3, 3],
        "float32",
        floats(&matrices),
    );
    array(
        &root.join("max_distances"),
        &[4],
        "float64",
        [0f64, 10., 20., 0.]
            .into_iter()
            .flat_map(f64::to_le_bytes)
            .collect(),
    );
    array(
        &root.join("sphericities"),
        &[4],
        "float32",
        floats(&[0., 0.5, 0.75, 0.]),
    );
    array(
        &root.join("surfaces"),
        &[4],
        "float32",
        floats(&[0., 4., 12., 0.]),
    );
}
fn index(root: &Path) {
    std::fs::create_dir_all(root).unwrap();
    std::fs::write(root.join("zarr.json"),serde_json::to_vec(&json!({"zarr_format":3,"node_type":"group","attributes":{"voxelytics":{"artifact_schema_version":1,"artifact_attributes":{"n_hash_buckets":1,"hash_function":"identity","dtype_bucket_entries":"uint16"}}}})).unwrap()).unwrap();
    array(
        &root.join("hash_bucket_offsets"),
        &[2],
        "uint64",
        integers(&[0, 4]),
    );
    array(
        &root.join("hash_buckets"),
        &[5, 3],
        "uint64",
        integers(&[1, 0, 2, 2, 0, 2, 3, 2, 3, 4, 3, 4, 0, 0, 0]),
    );
    array(
        &root.join("top_lefts"),
        &[4, 3],
        "uint16",
        [0u16, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect(),
    );
}
fn segmentation(root: &Path, coarse: bool) {
    std::fs::create_dir_all(root).unwrap();
    std::fs::write(root.join(".zarray"),serde_json::to_vec(&json!({"zarr_format":2,"shape":if coarse{vec![64,16,16]}else{vec![128,32,32]},"chunks":[32,32,32],"dtype":"|u1","order":"F","compressor":null,"fill_value":0})).unwrap()).unwrap();
    let mut first = vec![0u8; 32768];
    let mut second = first.clone();
    if coarse {
        first[2 + 32 * 3 + 1024 * 4] = 1;
    } else {
        for (x, y, z) in [(1, 2, 3), (2, 4, 5)] {
            first[x + 32 * y + 1024 * z] = 1;
        }
        first[3 + 32 + 1024] = 2;
        for (x, y, z) in [(4, 6, 7), (31, 8, 9)] {
            second[x + 32 * y + 1024 * z] = 1;
        }
        second[10 + 32 * 2 + 1024 * 2] = 2;
        std::fs::write(root.join("1.0.0"), second).unwrap();
        std::fs::write(root.join("3.0.0"), [1, 2, 3]).unwrap();
    }
    std::fs::write(root.join("0.0.0"), first).unwrap();
}
async fn start(with_stats: bool) -> (MockWk, Router, AppState, PathBuf) {
    start_with_mapping(with_stats, false).await
}
async fn start_with_mapping(with_stats: bool, hdf5: bool) -> (MockWk, Router, AppState, PathBuf) {
    let root = temp();
    statistics_file(&root.join("stats"));
    index(&root.join("index"));
    segmentation(&root.join("seg/1"), false);
    segmentation(&root.join("seg/2"), true);
    array(
        &root.join("agg/agglomerate_to_segments_offsets"),
        &[3],
        "uint64",
        integers(&[0, 0, 2]),
    );
    array(
        &root.join("agg/agglomerate_to_segments"),
        &[2],
        "uint64",
        integers(&[1, 2]),
    );
    array(
        &root.join("agg/segment_to_agglomerate"),
        &[5],
        "uint64",
        integers(&[0, 1, 1, 0, 0]),
    );
    let mut attachments = json!({"segmentIndex":{"name":"idx","path":root.join("index"),"dataFormat":"zarr3"},"agglomerates":[{"name":"agg","path":root.join("agg"),"dataFormat":"zarr3"}]});
    if with_stats {
        attachments["segmentStatistics"] =
            json!({"name":"stats","path":root.join("stats"),"dataFormat":"zarr3"});
    }
    if hdf5 {
        let file = root.join("agglomerates.hdf5");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/agglomerates/contiguous.hdf5"),
            &file,
        )
        .unwrap();
        attachments["agglomerates"] = json!([{"name":"agg","path":file,"dataFormat":"hdf5"}]);
    }
    let mut source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr","largestSegmentId":4,"boundingBox":{"topLeft":[0,0,0],"width":128,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":root.join("seg/1")},{"mag":[2,2,2],"path":root.join("seg/2")}],"attachments":attachments}]});
    for mag in source["dataLayers"][0]["mags"].as_array_mut().unwrap() {
        mag["axisOrder"] = json!({"x":0,"y":1,"z":2});
    }
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref()!=Some("denied")}),
            )
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let state = AppState::new(wk.config());
    (wk, router(state.clone()), state, root)
}
async fn call_token(
    app: &Router,
    metric: &str,
    body: Option<Value>,
    token: &str,
) -> (StatusCode, Value) {
    let suffix = if metric == "file" {
        "segmentStatisticsFile".into()
    } else {
        format!("segmentStatistics/{metric}")
    };
    let mut request = Request::builder()
        .method(if body.is_some() { "POST" } else { "GET" })
        .uri(format!("/data/datasets/{ID}/layers/seg/{suffix}"))
        .header("x-auth-token", token);
    let bytes = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        serde_json::to_vec(&body).unwrap()
    } else {
        vec![]
    };
    let (status, _, bytes) = send(app.clone(), request.body(Body::from(bytes)).unwrap()).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn call(
    app: &Router,
    metric: &str,
    ids: &[u64],
    mag: [i32; 3],
    mapping: Option<&str>,
) -> (StatusCode, Value) {
    call_token(app,metric,Some(json!({"mag":mag,"segmentIds":ids,"mappingName":mapping,"additionalCoordinates":[{"name":"t","value":42}]})),"t").await
}
async fn invalidate(app: &Router) {
    let request = Request::builder()
        .method("DELETE")
        .uri(format!("/data/datasets/{ID}"))
        .header("x-auth-token", "t")
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(app.clone(), request).await.0, StatusCode::OK);
}

#[tokio::test]
async fn file_info_and_all_nonmesh_metrics_preserve_units_and_shapes() {
    let (_wk, app, _, _) = start(true).await;
    assert_eq!(
        call_token(&app, "file", None, "t").await,
        (
            StatusCode::OK,
            json!([serde_json::from_str::<Value>(include_str!(
                "fixtures/segment_index/statistics_info_oracle.json"
            ))
            .unwrap()])
        )
    );
    assert_eq!(
        call(&app, "volume", &[1, 2, 3], [2, 2, 1], None).await,
        (StatusCode::OK, json!([4, 12, 0]))
    );
    assert_eq!(
        call(&app, "centerOfMass", &[2, 1], [2, 2, 1], None).await,
        (StatusCode::OK, json!([[4, 0, 0], [0, 0, 0]]))
    );
    assert_eq!(
        call(&app, "covarianceMatrix", &[2], [2, 2, 1], None).await,
        (StatusCode::OK, json!([[[1, 0, 0], [0, 1, 0], [0, 0, 1]]]))
    );
    assert_eq!(
        call(&app, "maxDistance", &[2, 1], [2, 2, 1], None).await,
        (StatusCode::OK, json!([20, 10]))
    );
    assert_eq!(
        call(&app, "sphericity", &[2, 1], [2, 2, 1], None).await,
        (StatusCode::OK, json!([0.75, 0.5]))
    );
    assert_eq!(
        call(&app, "volume", &[], [2, 1, 1], None).await,
        (StatusCode::OK, json!([]))
    );
}
#[tokio::test]
async fn exact_agglomerate_center_covariance_and_volume_combination() {
    let (_wk, app, _, _) = start(true).await;
    assert_eq!(
        call(&app, "volume", &[1], [2, 1, 1], Some("agg")).await,
        (StatusCode::OK, json!([32]))
    );
    assert_eq!(
        call(&app, "centerOfMass", &[1], [2, 1, 1], Some("agg")).await,
        (StatusCode::OK, json!([[3, 0, 0]]))
    );
    assert_eq!(
        call(&app, "covarianceMatrix", &[1], [2, 1, 1], Some("agg")).await,
        (StatusCode::OK, json!([[[4, 0, 0], [0, 1, 0], [0, 0, 1]]]))
    );
    assert_eq!(
        call(&app, "sphericity", &[1], [2, 1, 1], Some("agg"))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, error) = call(&app, "centerOfMass", &[0], [2, 1, 1], Some("agg")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error.to_string().contains("total volume"));
}
#[tokio::test]
async fn index_fallback_scans_real_buckets_counts_missing_and_propagates_failures() {
    let (_wk, app, _, _) = start(false).await;
    assert_eq!(
        call_token(&app, "file", None, "t").await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        call(&app, "volume", &[1, 2, 3, 5], [1, 1, 1], None).await,
        (StatusCode::OK, json!([4, 2, 0, 0]))
    );
    assert_eq!(
        call(&app, "boundingBox", &[1, 3, 5], [1, 1, 1], None).await,
        (
            StatusCode::OK,
            json!([{"topLeft":[1,2,3],"width":63,"height":7,"depth":7},{"topLeft":[0,0,0],"width":0,"height":0,"depth":0},{"topLeft":[0,0,0],"width":0,"height":0,"depth":0}])
        )
    );
    assert_eq!(
        call(&app, "volume", &[1], [2, 2, 2], None).await,
        (StatusCode::OK, json!([1]))
    );
    assert_eq!(
        call(&app, "boundingBox", &[1], [2, 2, 2], None).await,
        (
            StatusCode::OK,
            json!([{"topLeft":[2,3,4],"width":1,"height":1,"depth":1}])
        )
    );
    assert_eq!(
        call(&app, "volume", &[1, 99], [1, 1, 1], Some("agg")).await,
        (StatusCode::OK, json!([6, 0]))
    );
    assert_ne!(
        call(&app, "volume", &[4], [1, 1, 1], None).await.0,
        StatusCode::OK
    );
    assert_ne!(
        call(&app, "boundingBox", &[4], [1, 1, 1], None).await.0,
        StatusCode::OK
    );
}
#[tokio::test]
async fn finer_mag_falls_back_and_statistic_caches_reload_actual_changed_bytes() {
    let (_wk, app, state, root) = start(true).await;
    assert_eq!(
        call(&app, "volume", &[1], [1, 1, 1], None).await,
        (StatusCode::OK, json!([4]))
    );
    assert_eq!(
        call(&app, "centerOfMass", &[1], [1, 1, 1], None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, "volume", &[1], [2, 1, 1], None).await,
        (StatusCode::OK, json!([8]))
    );
    std::fs::write(root.join("stats/volumes/c/0"), integers(&[0, 16, 24, 0])).unwrap();
    assert_eq!(
        call(&app, "volume", &[1], [2, 1, 1], None).await,
        (StatusCode::OK, json!([8]))
    );
    let source = DataSourceId::new("ds", "org");
    assert_eq!(
        state.statistics_file.clear_caches(&source, Some("other")),
        0
    );
    invalidate(&app).await;
    assert_eq!(
        call(&app, "volume", &[1], [2, 1, 1], None).await,
        (StatusCode::OK, json!([16]))
    );
    assert_eq!(
        call(&app, "volume", &[1], [1, 1, 1], None).await,
        (StatusCode::OK, json!([4]))
    );
    std::fs::write(root.join("seg/1/0.0.0"), vec![0u8; 32768]).unwrap();
    assert_eq!(
        call(&app, "volume", &[1], [1, 1, 1], None).await,
        (StatusCode::OK, json!([4]))
    );
    invalidate(&app).await;
    assert_eq!(
        call(&app, "volume", &[1], [1, 1, 1], None).await,
        (StatusCode::OK, json!([2]))
    );
}
#[tokio::test]
async fn schema_and_auth_are_enforced_before_warm_statistic_caches() {
    let (wk, app, _, _) = start(true).await;
    assert_eq!(
        call_token(
            &app,
            "centerOfMass",
            Some(json!({"mag":[0,1,1],"segmentIds":[1]})),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(wk.calls().is_empty());
    assert_eq!(
        call(&app, "volume", &[1], [2, 1, 1], None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call_token(
            &app,
            "volume",
            Some(json!({"mag":[2,1,1],"segmentIds":[1]})),
            "denied"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn malformed_statistics_fall_back_for_volume_and_fail_for_file_metrics() {
    for problem in [
        "version",
        "dense",
        "metric",
        "mapping",
        "shape",
        "nonfinite",
    ] {
        let (_wk, app, _, root) = start(true).await;
        let path = root.join("stats/zarr.json");
        let mut group: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        match problem {
            "version" => group["attributes"]["voxelytics"]["artifact_schema_version"] = json!(10),
            "dense" => {
                std::fs::write(root.join("stats/ids/c/0"), integers(&[0, 1, 2, 99])).unwrap()
            }
            "mapping" => {
                group["attributes"]["voxelytics"]["artifact_attributes"]["mapping_name"] =
                    json!("other")
            }
            "metric" => {
                std::fs::write(root.join("stats/center_of_mass/zarr.json"), b"invalid").unwrap()
            }
            "shape" => array(
                &root.join("stats/center_of_mass"),
                &[4, 2],
                "float32",
                floats(&[0.; 8]),
            ),
            "nonfinite" => std::fs::write(
                root.join("stats/center_of_mass/c/0/0"),
                floats(&[0., 0., 0., f32::NAN, 0., 0., 4., 0., 0., 0., 0., 0.]),
            )
            .unwrap(),
            _ => unreachable!(),
        }
        std::fs::write(path, serde_json::to_vec(&group).unwrap()).unwrap();
        assert_eq!(
            call(&app, "centerOfMass", &[1], [2, 1, 1], None).await.0,
            StatusCode::BAD_REQUEST,
            "{problem}"
        );
        // Requesting a finer mag forces the same volume fallback in all cases.
        assert_eq!(
            call(&app, "volume", &[1], [1, 1, 1], None).await,
            (StatusCode::OK, json!([4])),
            "{problem}"
        );
    }
}

#[tokio::test]
async fn optional_mag_mapping_and_metric_dtype_conversion_follow_scala() {
    let (_wk, app, _, root) = start(true).await;
    let path = root.join("stats/zarr.json");
    let mut group: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    group["attributes"]["voxelytics"]["artifact_attributes"]
        .as_object_mut()
        .unwrap()
        .remove("mag");
    std::fs::write(path, serde_json::to_vec(&group).unwrap()).unwrap();
    array(
        &root.join("stats/volumes"),
        &[4],
        "float64",
        [0f64, 8.9, 24.7, 0.]
            .into_iter()
            .flat_map(f64::to_le_bytes)
            .collect(),
    );
    let (status, info) = call_token(&app, "file", None, "t").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(info[0]["mag"], json!([1, 1, 1]));
    assert_eq!(
        call(&app, "volume", &[1, 2], [1, 1, 1], Some("")).await,
        (StatusCode::OK, json!([8, 24]))
    );
}

#[test]
fn scanner_matches_actual_repository_jni_oracle() {
    use base64::Engine;
    use webknossos_datastore::{
        models::Vec3Int,
        services::index_statistics::{count_voxels, extend_bounds},
    };
    let oracle: Value = serde_json::from_str(include_str!(
        "fixtures/segment_index/bucket_scanner_oracle.json"
    ))
    .unwrap();
    for case in oracle.as_array().unwrap() {
        let width = case["width"].as_u64().unwrap() as usize;
        let signed = case["signed"].as_bool().unwrap();
        let id = case["id"].as_str().unwrap().parse().unwrap();
        if case["kind"] == "count" {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(case["bytes"].as_str().unwrap())
                .unwrap();
            assert_eq!(
                count_voxels(&bytes, width, signed, id).unwrap(),
                case["expected"].as_i64().unwrap(),
                "{case}"
            );
        } else {
            let mut bytes = vec![0u8; 32768 * width];
            for (x, y, z) in [(0, 1, 2), (31, 30, 29), (5, 6, 7)] {
                let index = width * (x + 32 * y + 1024 * z);
                bytes[index..index + width].fill(255);
            }
            let mut bounds = [i32::MAX, i32::MAX, i32::MAX, i32::MIN, i32::MIN, i32::MIN];
            extend_bounds(
                &bytes,
                width,
                signed,
                id,
                Vec3Int::new(-32, 64, 96),
                &mut bounds,
            )
            .unwrap();
            assert_eq!(json!(bounds), case["expected"], "{case}");
        }
    }
    assert!(count_voxels(&[1, 2, 3], 2, false, 1).is_err());
    assert!(count_voxels(&[], 0, false, 1).is_err());
    assert!(extend_bounds(&[], 1, false, 1, Vec3Int::zeros(), &mut [0; 6]).is_err());
}

#[test]
fn remapping_math_matches_actual_compiled_scala_oracle() {
    use webknossos_datastore::{
        models::Vec3Int,
        services::segment_statistics_file::{combined_covariance, rescale_volume, weighted_center},
    };
    let oracle: Value = serde_json::from_str(include_str!(
        "fixtures/segment_index/statistics_math_oracle.json"
    ))
    .unwrap();
    let centers: Vec<Vec<f32>> = serde_json::from_value(oracle["centers"].clone()).unwrap();
    let volumes: Vec<i64> = serde_json::from_value(oracle["volumes"].clone()).unwrap();
    let matrices: Vec<Vec<Vec<f32>>> = serde_json::from_value(oracle["matrices"].clone()).unwrap();
    let matrices = matrices
        .into_iter()
        .map(|m| m.into_iter().flatten().collect())
        .collect::<Vec<_>>();
    let expected: [f64; 3] = serde_json::from_value(oracle["center"].clone()).unwrap();
    assert_eq!(weighted_center(&centers, &volumes).unwrap(), expected);
    let expected: [[f32; 3]; 3] = serde_json::from_value(oracle["covariance"].clone()).unwrap();
    assert_eq!(
        combined_covariance(&matrices, &centers, &volumes).unwrap(),
        expected
    );
    assert!(weighted_center(&centers, &[0, 0, 0]).is_err());
    assert!(combined_covariance(&matrices, &centers, &[0, 0, 0]).is_err());
    assert!(weighted_center(&[vec![1.]], &[1]).is_err());
    for case in oracle["rescale"].as_array().unwrap() {
        let mag = |name: &str| {
            let a = case[name].as_array().unwrap();
            Vec3Int::new(
                a[0].as_i64().unwrap() as i32,
                a[1].as_i64().unwrap() as i32,
                a[2].as_i64().unwrap() as i32,
            )
        };
        let volume = case["volume"].as_str().unwrap().parse().unwrap();
        let expected = case["expected"].as_str().unwrap().parse::<i64>().unwrap();
        assert_eq!(
            rescale_volume(volume, mag("file_mag"), mag("requested_mag")).unwrap(),
            expected
        );
    }
}

#[tokio::test]
async fn hdf5_agglomerates_expand_index_queries_and_both_statistics_paths() {
    for with_stats in [true, false] {
        let (_wk, app, _, _) = start_with_mapping(with_stats, true).await;
        let result = call(&app, "volume", &[1], [1, 1, 1], Some("agg")).await;
        assert_eq!(result, (StatusCode::OK, json!([6])));
        if with_stats {
            assert_eq!(
                call(&app, "volume", &[1], [2, 1, 1], Some("agg")).await,
                (StatusCode::OK, json!([32]))
            );
            assert_eq!(
                call(&app, "centerOfMass", &[1], [2, 1, 1], Some("agg")).await,
                (StatusCode::OK, json!([[3, 0, 0]]))
            );
        }
        let request = Request::builder()
            .method("POST")
            .uri(format!("/data/datasets/{ID}/layers/seg/segmentIndex/1"))
            .header("x-auth-token", "t")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(
                    &json!({"mag":[1,1,1],"cubeSize":[32,32,32],"mappingName":"agg"}),
                )
                .unwrap(),
            ))
            .unwrap();
        let (status, _, bytes) = send(app.clone(), request).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!([[0, 0, 0], [32, 0, 0], [64, 0, 0]])
        );
    }
}
#[tokio::test]
async fn surface_statistics_file_precedes_mesh_lookup_and_does_not_remap() {
    let (_wk, app, _, _) = start(true).await;
    let body = json!({"mag":[2,2,2],"segmentIds":[2,1,3],"meshFileName":"not-present","annotationVersion":99});
    let (status, value) = call_token(&app, "surfaceArea", Some(body), "t").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value, json!([12., 4., 0.]));
    let (status, value) = call_token(
        &app,
        "surfaceArea",
        Some(json!({"mag":[2,2,2],"segmentIds":[1],"mappingName":"no-such-agg"})),
        "t",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{value}");
}
