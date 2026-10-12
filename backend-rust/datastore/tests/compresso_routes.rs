mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::send;
use mock_wk::{MockWk, Reply};
use serde_json::json;
use std::path::{Path, PathBuf};
use webknossos_datastore::{AppState, router};
const ID: &str = "0123456789abcdef01234567";
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compresso/volumes")
}
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        if e.path().is_dir() {
            copy(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
        }
    }
}
async fn start(name: &str) -> (MockWk, Router, PathBuf) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let root = std::env::temp_dir().join(format!(
        "wk-compresso-http-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    copy(&fixtures().join(name), &root);
    let width = name[1..]
        .split('_')
        .next()
        .unwrap()
        .parse::<usize>()
        .unwrap();
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":format!("uint{}",width*8),"dataFormat":"neuroglancerPrecomputed","largestSegmentId":{"customJsonEncoding":"bigint","value":"18446744073709551615"},"boundingBox":{"topLeft":[5,7,11],"width":7,"height":5,"depth":3},"mags":[{"mag":[1,1,1],"path":root.join("1"),"axisOrder":{"x":0,"y":1,"z":2}}]}]});
    let wk = MockWk::start(move |c| {
        if c.path.ends_with("/validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":c.query_value("token").as_deref()!=Some("denied")}),
            )
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let app = router(AppState::new(wk.config()));
    (wk, app, root)
}
async fn read_detail(app: &Router, token: &str) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let request = Request::builder()
        .method("POST")
        .uri(format!("/data/datasets/{ID}/layers/seg/readData"))
        .header("x-auth-token", token)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({"position":[5,7,11],"cubeSize":[7,5,3],"mag":[1,1,1]}))
                .unwrap(),
        ))
        .unwrap();
    send(app.clone(), request).await
}
async fn read(app: &Router, token: &str) -> (StatusCode, Vec<u8>) {
    let (s, _, b) = read_detail(app, token).await;
    (s, b)
}
#[tokio::test]
async fn native_verified_compresso_volumes_replay_through_authenticated_data_routes() {
    for width in [1, 2, 4, 8] {
        for mode in ["plain", "shard_raw", "shard_gzip"] {
            let name = format!("u{width}_{mode}");
            let (_wk, app, root) = start(&name).await;
            let (status, bytes) = read(&app, "t").await;
            assert_eq!(
                status,
                StatusCode::OK,
                "{name}: {}",
                String::from_utf8_lossy(&bytes)
            );
            assert_eq!(
                bytes,
                std::fs::read(root.join("expected_full.raw")).unwrap(),
                "{name}"
            );
        }
    }
}
#[tokio::test]
async fn warm_cache_denial_and_reload_preserve_failure_headers_for_invalid_compresso() {
    let (_wk, app, root) = start("u4_plain").await;
    let original = read(&app, "first").await;
    assert_eq!(original.0, StatusCode::OK);
    let path = root.join("1/5-9_7-10_11-13");
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[5] = 8;
    std::fs::write(path, bytes).unwrap();
    assert_eq!(read(&app, "second").await, original);
    assert_eq!(read(&app, "denied").await.0, StatusCode::FORBIDDEN);
    let (status, _, _) = send(
        app.clone(),
        Request::builder()
            .method("DELETE")
            .uri(format!("/data/datasets/{ID}"))
            .header("x-auth-token", "t")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let request = Request::builder()
        .method("POST")
        .uri(format!("/data/datasets/{ID}/layers/seg/readData"))
        .header("x-auth-token", "second")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({"position":[0,0,0],"cubeSize":[32,32,32],"mag":[1,1,1]}))
                .unwrap(),
        ))
        .unwrap();
    let (status, headers, bytes) = send(app.clone(), request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["failure-bucket-indices"], "[0]");
    assert_eq!(headers["missing-buckets"], "[0]");
    assert!(bytes.is_empty());
}
#[tokio::test]
async fn denied_compresso_dataset_never_loads_metadata_or_volume() {
    let (wk, app, _root) = start("u8_shard_gzip").await;
    assert_eq!(read(&app, "denied").await.0, StatusCode::FORBIDDEN);
    assert!(
        wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
}
