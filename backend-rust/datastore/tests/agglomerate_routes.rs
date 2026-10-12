//! Agglomerate-file routes and mapped data reads with a Zarr3 agglomerate attachment.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::send;
use mock_wk::{MockWk, Reply};
use prost::Message;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{
    AppState,
    proto::{AgglomerateGraph, ListOfLong, SkeletonTracing},
    router,
};

const ID: &str = "0123456789abcdef01234567";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-agglomerates-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p.canonicalize().unwrap()
}

/// One single-chunk Zarr3 array with default chunk keys.
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

/// Agglomerate 1 = segments {1, 2, 3}, agglomerate 2 = segments {4, 5}.
fn agglomerate_file(dir: &Path) {
    zarr3_array(
        &dir.join("segment_to_agglomerate"),
        &[6],
        "uint64",
        u64s(&[0, 1, 1, 1, 2, 2]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_segments_offsets"),
        &[4],
        "uint64",
        u64s(&[0, 0, 3, 5]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_segments"),
        &[5],
        "uint64",
        u64s(&[1, 2, 3, 4, 5]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_positions"),
        &[5, 3],
        "uint64",
        u64s(&[10, 0, 0, 11, 0, 0, 12, 0, 0, 20, 0, 0, 21, 0, 0]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_edges_offsets"),
        &[4],
        "uint64",
        u64s(&[0, 0, 2, 3]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_edges"),
        &[3, 2],
        "uint64",
        u64s(&[0, 1, 1, 2, 0, 1]),
    );
    zarr3_array(
        &dir.join("agglomerate_to_affinities"),
        &[3],
        "float32",
        [0.5f32, 0.25, 1.0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect(),
    );
}

/// A 32³ uint8 segmentation whose x-coordinate modulo 6 is the segment id.
fn segmentation(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join(".zarray"),
        serde_json::to_vec(
            &json!({"zarr_format":2,"shape":[32,32,32],"chunks":[32,32,32],
            "dtype":"|u1","order":"F","compressor":null,"fill_value":0}),
        )
        .unwrap(),
    )
    .unwrap();
    let mut data = Vec::new();
    for _z in 0..32 {
        for _y in 0..32 {
            for x in 0..32u8 {
                data.push(x % 6);
            }
        }
    }
    std::fs::write(dir.join("0.0.0"), data).unwrap();
}

async fn start() -> (MockWk, Router) {
    let root = temp();
    agglomerate_file(&root.join("agg"));
    segmentation(&root.join("seg"));
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/agglomerates/contiguous.hdf5"),
        root.join("legacy.hdf5"),
    )
    .unwrap();
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr",
        "largestSegmentId":5,
        "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":root.join("seg").to_str().unwrap(),
            "axisOrder":{"x":0,"y":1,"z":2}}],
        "attachments":{"agglomerates":[
            {"name":"agg","path":root.join("agg").to_str().unwrap(),"dataFormat":"zarr3"},
            {"name":"legacy","path":root.join("legacy.hdf5").to_str().unwrap(),"dataFormat":"hdf5"}]}}]});
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

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Vec<u8>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::builder()
            .method(method)
            .uri(path)
            .header("x-auth-token", "t")
            .body(Body::from(body))
            .unwrap(),
    )
    .await
}

fn base(rest: &str) -> String {
    format!("/data/datasets/{ID}/layers/seg/{rest}")
}

#[tokio::test]
async fn lists_and_looks_up_agglomerates() {
    let (_wk, app) = start().await;
    let (status, _, body) = request(&app, "GET", &base("agglomerates"), vec![]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!(["agg", "legacy"])
    );

    let (status, _, body) = request(
        &app,
        "GET",
        &base("agglomerates/agg/largestAgglomerateId"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"customJsonEncoding":"bigint","value":"4"})
    );

    let query = ListOfLong {
        items: vec![3, 5, 0, 1],
    }
    .encode_to_vec();
    let (status, _, body) = request(
        &app,
        "POST",
        &base("agglomerates/agg/agglomeratesForSegments"),
        query,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ListOfLong::decode(&body[..]).unwrap().items, [1, 2, 0, 1]);

    for (segment, position) in [(2, json!([11, 0, 0])), (5, json!([21, 0, 0]))] {
        let (status, _, body) = request(
            &app,
            "GET",
            &base(&format!(
                "agglomerates/agg/positionForSegment?segmentId={segment}"
            )),
            vec![],
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), position);
    }

    let (status, _, body) = request(
        &app,
        "POST",
        &base("agglomerates/agg/agglomeratesForSegments"),
        vec![0xff],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, b"Invalid protobuf request body");
}

#[tokio::test]
async fn builds_agglomerate_graphs_and_trees() {
    let (_wk, app) = start().await;
    let (status, headers, body) = request(
        &app,
        "GET",
        &base("agglomerates/agg/agglomerateGraph/1"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "application/x-protobuf");
    let graph = AgglomerateGraph::decode(&body[..]).unwrap();
    assert_eq!(graph.segments, [1, 2, 3]);
    assert_eq!(
        graph
            .edges
            .iter()
            .map(|e| (e.source, e.target))
            .collect::<Vec<_>>(),
        [(1, 2), (2, 3)]
    );
    assert_eq!(
        graph.positions.iter().map(|p| p.x).collect::<Vec<_>>(),
        [10, 11, 12]
    );
    assert_eq!(graph.affinities, [0.5, 0.25]);

    let (status, _, body) =
        request(&app, "GET", &base("agglomerates/agg/skeleton/2"), vec![]).await;
    assert_eq!(status, StatusCode::OK);
    let skeleton = SkeletonTracing::decode(&body[..]).unwrap();
    let tree = &skeleton.trees[0];
    assert_eq!(tree.tree_id, 2);
    assert_eq!(tree.name, "agglomerate 2 (agg)");
    assert_eq!(tree.r#type, Some(1));
    assert_eq!(
        tree.nodes
            .iter()
            .map(|n| (n.id, n.position.x))
            .collect::<Vec<_>>(),
        [(1, 20), (2, 21)]
    );
    assert_eq!(
        tree.edges
            .iter()
            .map(|e| (e.source, e.target))
            .collect::<Vec<_>>(),
        [(1, 2)]
    );
    let info = tree.agglomerate_info.as_ref().unwrap();
    assert_eq!(
        (info.agglomerate_id, info.mapping_name.as_deref()),
        (2, Some("agg"))
    );
    assert_eq!(skeleton.zoom_level, 2.0);
}

#[tokio::test]
async fn applies_zarr_and_hdf5_mappings_to_data() {
    let (_wk, app) = start().await;
    let (status, _, body) = request(
        &app,
        "GET",
        &base("data?x=0&y=0&z=0&width=8&height=1&depth=1&mag=1-1-1&mappingName=agg"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // x % 6 = 0 1 2 3 4 5 0 1 → agglomerates 0 1 1 1 2 2 0 1.
    assert_eq!(body, [0, 1, 1, 1, 2, 2, 0, 1]);

    let (status, _, body) =
        request(&app, "GET", &base("agglomerates/legacy/skeleton/1"), vec![]).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(
        SkeletonTracing::decode(&body[..]).unwrap().trees[0]
            .nodes
            .len(),
        3
    );
    let (status, _, body) = request(
        &app,
        "GET",
        &base("data?x=0&y=0&z=0&width=8&height=1&depth=1&mag=1-1-1&mappingName=legacy"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, [0, 1, 1, 1, 2, 2, 0, 1]);
    let (status, _, body) = request(
        &app,
        "GET",
        &base("agglomerates/legacy/largestAgglomerateId"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"customJsonEncoding":"bigint","value":"3"})
    );
    let (status, _, body) = request(
        &app,
        "GET",
        &base("agglomerates/legacy/agglomerateGraph/1"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        AgglomerateGraph::decode(&body[..]).unwrap().segments,
        [1, 2, 3]
    );
    let (status, _, body) = request(
        &app,
        "POST",
        &base("agglomerates/legacy/agglomeratesForSegments"),
        ListOfLong {
            items: vec![5, 3, 0],
        }
        .encode_to_vec(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ListOfLong::decode(&body[..]).unwrap().items, [2, 1, 0]);
    let (status, _, body) = request(
        &app,
        "GET",
        &base("agglomerates/legacy/positionForSegment?segmentId=2"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!([11, 0, 0])
    );

    let (status, _, _) = request(
        &app,
        "GET",
        &base("agglomerates/missing/skeleton/1"),
        vec![],
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = request(&app, "GET", &base("agglomerates/agg/skeleton/x"), vec![]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn zarr_agglomerate_reload_discards_shared_chunks_and_malformed_ranges_fail() {
    use webknossos_datastore::{
        config::DatastoreConfig,
        models::{DataSourceId, LayerAttachment},
        services::agglomerate::AgglomerateFileKey,
    };
    let root = temp();
    agglomerate_file(&root);
    let state = AppState::new(DatastoreConfig::defaults(&root));
    let key = AgglomerateFileKey {
        data_source_id: DataSourceId::new("ds", "org"),
        layer_name: "seg".into(),
        attachment: LayerAttachment::from_json(
            &json!({"name":"agg","path":root,"dataFormat":"zarr3"}),
        )
        .unwrap(),
    };
    assert_eq!(
        state
            .agglomerates
            .agglomerate_ids_for_segment_ids(&key, &[1], None)
            .await
            .unwrap(),
        [1]
    );
    std::fs::write(
        root.join("segment_to_agglomerate/c/0"),
        u64s(&[0, 2, 2, 2, 1, 1]),
    )
    .unwrap();
    assert_eq!(
        state
            .agglomerates
            .agglomerate_ids_for_segment_ids(&key, &[1], None)
            .await
            .unwrap(),
        [1]
    );
    assert_eq!(
        state
            .agglomerates
            .clear_caches(&key.data_source_id, Some("other")),
        0
    );
    state
        .agglomerates
        .clear_caches(&key.data_source_id, Some("seg"));
    assert_eq!(
        state
            .agglomerates
            .agglomerate_ids_for_segment_ids(&key, &[1], None)
            .await
            .unwrap(),
        [2]
    );
    std::fs::write(
        root.join("agglomerate_to_segments_offsets/c/0"),
        u64s(&[0, u64::MAX, 3, 5]),
    )
    .unwrap();
    state.agglomerates.clear_caches(&key.data_source_id, None);
    assert!(
        state
            .agglomerates
            .segment_ids_for_agglomerate_id(&key, 1, None)
            .await
            .is_err()
    );
}
