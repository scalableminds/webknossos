//! Segment index routes with a hand-built Zarr3 segment index file (identity hash).
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
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    models::{DataSourceId, LayerAttachment},
    router,
    services::segment_index::SegmentIndexFileKey,
};

const ID: &str = "0123456789abcdef01234567";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-segment-index-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p.canonicalize().unwrap()
}

fn zarr3_array(dir: &Path, shape: &[usize], data_type: &str, bytes: Vec<u8>) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("zarr.json"),
        serde_json::to_vec(&json!({"zarr_format":3,"node_type":"array","shape":shape,
            "data_type":data_type,
            "chunk_grid":{"name":"regular","configuration":{"chunk_shape":shape}},
            "chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},
            "fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}],
            "attributes":{}}))
        .unwrap(),
    )
    .unwrap();
    let key: PathBuf = std::iter::once("c".to_owned())
        .chain(shape.iter().map(|_| "0".to_owned()))
        .collect();
    let chunk = dir.join(key);
    std::fs::create_dir_all(chunk.parent().unwrap()).unwrap();
    std::fs::write(chunk, bytes).unwrap();
}

fn u64s(values: &[u64]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Two hash buckets (even / odd ids): 2 → mag-1 buckets (0,0,0),(1,0,0); 4 → (2,3,0); 3 → (5,5,5).
fn segment_index(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("zarr.json"),
        serde_json::to_vec(&json!({"zarr_format":3,"node_type":"group","attributes":{
            "voxelytics":{"artifact_schema_version":1,"artifact_attributes":{
                "n_hash_buckets":2,"hash_function":"identity","dtype_bucket_entries":"uint16"}}}}))
        .unwrap(),
    )
    .unwrap();
    zarr3_array(
        &dir.join("hash_bucket_offsets"),
        &[3],
        "uint64",
        u64s(&[0, 2, 3]),
    );
    // Scala reads one row past each bucket, hence the padding row.
    zarr3_array(
        &dir.join("hash_buckets"),
        &[4, 3],
        "uint64",
        u64s(&[2, 0, 2, 4, 2, 3, 3, 3, 4, 0, 0, 0]),
    );
    let top_lefts: Vec<u8> = [0u16, 0, 0, 1, 0, 0, 2, 3, 0, 5, 5, 5]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    zarr3_array(&dir.join("top_lefts"), &[4, 3], "uint16", top_lefts);
}

/// Agglomerate 1 = segments {2, 4}.
fn agglomerates(dir: &Path) {
    zarr3_array(
        &dir.join("agglomerate_to_segments_offsets"),
        &[3],
        "uint64",
        u64s(&[0, 0, 2]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_segments"),
        &[2],
        "uint64",
        u64s(&[2, 4]),
    );
}

async fn start(with_index: bool) -> (MockWk, Router) {
    let root = temp();
    segment_index(&root.join("segment_index"));
    agglomerates(&root.join("agg"));
    let mut attachments = json!({"agglomerates":[
        {"name":"agg","path":root.join("agg").to_str().unwrap(),"dataFormat":"zarr3"}]});
    if with_index {
        attachments["segmentIndex"] = json!({"name":"idx","path":root.join("segment_index").to_str().unwrap(),"dataFormat":"zarr3"});
    } else {
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/segment_index/contiguous.hdf5"),
            root.join("idx.hdf5"),
        )
        .unwrap();
        attachments["segmentIndex"] = json!({"name":"idx","path":root.join("idx.hdf5").to_str().unwrap(),"dataFormat":"hdf5"});
    }
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr",
        "largestSegmentId":5,
        "boundingBox":{"topLeft":[0,0,0],"width":256,"height":256,"depth":256},
        "mags":[{"mag":[1,1,1],"path":root.join("seg").to_str().unwrap()}],
        "attachments":attachments},
        {"name":"color","category":"color","elementClass":"uint8","dataFormat":"zarr",
        "boundingBox":{"topLeft":[0,0,0],"width":1,"height":1,"depth":1},
        "mags":[{"mag":[1,1,1],"path":root.join("color").to_str().unwrap()}]}]});
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(StatusCode::OK, json!({"granted":true}))
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let app = router(AppState::new(wk.config()));
    (wk, app)
}

async fn call(app: &Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/data/datasets/{ID}/layers/{path}"))
        .header("x-auth-token", "t");
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).unwrap())
        }
        None => Body::empty(),
    };
    let (status, _, bytes) = send(app.clone(), request.body(body).unwrap()).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn reports_segment_index_presence() {
    let (_wk, app) = start(true).await;
    assert_eq!(
        call(&app, "GET", "seg/hasSegmentIndex", None).await,
        (StatusCode::OK, json!(true))
    );
    assert_eq!(
        call(&app, "GET", "color/hasSegmentIndex", None).await,
        (StatusCode::OK, json!(false))
    );
}

#[tokio::test]
async fn reads_single_segment_indices() {
    let (_wk, app) = start(true).await;
    let body = |cube: i32| json!({"mag":[1,1,1],"cubeSize":[cube,cube,cube]});
    assert_eq!(
        call(&app, "POST", "seg/segmentIndex/2", Some(body(32))).await,
        (StatusCode::OK, json!([[0, 0, 0], [32, 0, 0]]))
    );
    assert_eq!(
        call(&app, "POST", "seg/segmentIndex/2", Some(body(64))).await,
        (StatusCode::OK, json!([[0, 0, 0]]))
    );
    assert_eq!(
        call(&app, "POST", "seg/segmentIndex/3", Some(body(32))).await,
        (StatusCode::OK, json!([[160, 160, 160]]))
    );
    assert_eq!(
        call(&app, "POST", "seg/segmentIndex/6", Some(body(32))).await,
        (StatusCode::OK, json!([]))
    );
    // Agglomerate 1 of the "agg" mapping consists of segments 2 and 4.
    let (status, positions) = call(
        &app,
        "POST",
        "seg/segmentIndex/1",
        Some(json!({"mag":[1,1,1],"cubeSize":[32,32,32],"mappingName":"agg"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{positions}");
    assert_eq!(positions, json!([[0, 0, 0], [32, 0, 0], [64, 96, 0]]));
    let (status, _) = call(&app, "POST", "color/segmentIndex/2", Some(body(32))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn queries_multiple_segments() {
    let (_wk, app) = start(true).await;
    let (status, result) = call(
        &app,
        "POST",
        "seg/segmentIndex",
        Some(
            json!({"segmentIds":[2, 4, {"customJsonEncoding":"bigint","value":"6"}],"mag":[2,2,1]}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = |v: &str| json!({"customJsonEncoding":"bigint","value":v});
    assert_eq!(
        result,
        json!([
            {"segmentId":id("2"),"positions":[[0,0,0]]},
            {"segmentId":id("4"),"positions":[[1,1,0]]},
            {"segmentId":id("6"),"positions":[]}
        ])
    );
}

#[tokio::test]
async fn reads_hdf5_segment_indices() {
    let (_wk, app) = start(false).await;
    let (status, body) = call(
        &app,
        "POST",
        "seg/segmentIndex/2",
        Some(json!({"mag":[1,1,1],"cubeSize":[32,32,32]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!([[0, 0, 0], [32, 0, 0]]));
    let (status,result)=call(&app,"POST","seg/segmentIndex",Some(json!({"segmentIds":[{"customJsonEncoding":"bigint","value":"18446744073709551615"}],"mag":[1,1,1]}))).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(
        result,
        json!([{"segmentId":{"customJsonEncoding":"bigint","value":"18446744073709551615"},"positions":[[32767,-32768,-1]]}])
    );
}

#[tokio::test]
async fn rejects_invalid_geometry_and_additional_coordinates() {
    let (wk, app) = start(true).await;
    for body in [
        json!({"mag":[0,1,1],"cubeSize":[32,32,32]}),
        json!({"mag":[1,1,1],"cubeSize":[-1,32,32]}),
        json!({"mag":[1,1,1],"cubeSize":[32,32,32],"additionalCoordinates":{}}),
        json!({"mag":[1,1,1],"cubeSize":[32,32,32],"additionalCoordinates":[{"name":"t","value":"bad"}]}),
    ] {
        assert_eq!(
            call(&app, "POST", "seg/segmentIndex/2", Some(body)).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    assert!(wk.calls().is_empty());
}

#[tokio::test]
async fn zarr_index_reload_discards_shared_chunks_and_invalid_tables_fail() {
    let root = temp();
    segment_index(&root);
    let state = AppState::new(DatastoreConfig::defaults(&root));
    let key = SegmentIndexFileKey {
        data_source_id: DataSourceId::new("ds", "org"),
        layer_name: "seg".into(),
        attachment: LayerAttachment::from_json(
            &json!({"name":"idx","path":root.to_str().unwrap(),"dataFormat":"zarr3"}),
        )
        .unwrap(),
    };
    let query = || state.segment_index.read_segment_index(&key, 2, None);
    assert_eq!(
        serde_json::to_value(query().await.unwrap()).unwrap(),
        json!([[0, 0, 0], [1, 0, 0]])
    );
    let data = [9u16, 0, 0, 1, 0, 0, 2, 3, 0, 5, 5, 5]
        .into_iter()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    std::fs::write(root.join("top_lefts/c/0/0"), data).unwrap();
    assert_eq!(
        serde_json::to_value(query().await.unwrap()).unwrap(),
        json!([[0, 0, 0], [1, 0, 0]])
    );
    assert_eq!(
        state
            .segment_index
            .clear_caches(&key.data_source_id, Some("other")),
        0
    );
    assert!(
        state
            .segment_index
            .clear_caches(&key.data_source_id, Some("seg"))
            > 0
    );
    assert_eq!(
        serde_json::to_value(query().await.unwrap()).unwrap(),
        json!([[9, 0, 0], [1, 0, 0]])
    );
    // Previously these unchecked offsets could create invalid or enormous array requests.
    for offsets in [[2, 1, 3], [0, u64::MAX, 3], [0, 2000000, 3]] {
        std::fs::write(root.join("hash_bucket_offsets/c/0"), u64s(&offsets)).unwrap();
        state.segment_index.clear_caches(&key.data_source_id, None);
        assert!(query().await.is_err(), "{offsets:?}");
    }
    let path = root.join("zarr.json");
    let mut metadata: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    metadata["attributes"]["voxelytics"]["artifact_attributes"]["n_hash_buckets"] = json!(0);
    std::fs::write(path, serde_json::to_vec(&metadata).unwrap()).unwrap();
    state.segment_index.clear_caches(&key.data_source_id, None);
    assert!(query().await.is_err());
}
