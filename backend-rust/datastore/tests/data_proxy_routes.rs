//! DataProxyController through the actual router: access RPC -> datasource cache -> vault reads.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::{header, json as body_json, send};
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::router;

const ID: &str = "0123456789abcdef01234567";
const CHUNK: &[u8] = b"0123456789";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-proxy-routes-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// A precomputed-style layer directory: `<root>/info`, `<root>/s1/0-1_0-1_0-1` and a mesh.
fn layer_dir() -> PathBuf {
    let root = temp();
    std::fs::create_dir_all(root.join("s1")).unwrap();
    std::fs::create_dir_all(root.join("meshes/m")).unwrap();
    std::fs::write(root.join("s1/0-1_0-1_0-1"), CHUNK).unwrap();
    std::fs::write(root.join("meshes/m/info"), b"{\"@type\":\"m\"}").unwrap();
    let scale = |key: &str| {
        json!({"key":key,"size":[8,8,8],"resolution":[4.0,4.0,40.0],"chunk_sizes":[[8,8,8]],
            "encoding":"raw","sharding":{"@type":"neuroglancer_uint64_sharded_v1","preshift_bits":0,
            "hash":"identity","minishard_bits":0,"shard_bits":0}})
    };
    std::fs::write(
        root.join("info"),
        serde_json::to_vec(
            &json!({"@type":"neuroglancer_multiscale_volume","type":"image",
            "data_type":"uint8","num_channels":1,"scales":[scale("s1"), scale("s2")],
            "extra":"dropped"}),
        )
        .unwrap(),
    )
    .unwrap();
    root
}

fn source(root: &Path) -> Value {
    json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"seg","category":"segmentation","elementClass":"uint8",
        "dataFormat":"neuroglancerPrecomputed","largestSegmentId":5,
        "boundingBox":{"topLeft":[0,0,0],"width":8,"height":8,"depth":8},
        "mags":[{"mag":[1,1,1],"path":root.join("s1").to_str().unwrap()}],
        "attachments":{"meshes":[{"name":"m","path":root.join("meshes/m").to_str().unwrap(),
            "dataFormat":"neuroglancerPrecomputed"}]}}]})
}

async fn app(root: &Path) -> (MockWk, Router) {
    app_with_source(source(root)).await
}
async fn app_with_source(returned: Value) -> (MockWk, Router) {
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            assert_eq!(
                call.json(),
                json!({"resourceId":ID,"resourceType":"dataset","mode":"read"})
            );
            let granted = call.query_value("token").as_deref() == Some("good");
            Reply::json(StatusCode::OK, json!({"granted":granted}))
        } else {
            assert_eq!(
                call.path,
                format!("/api/datastores/test-ds/datasources/{ID}")
            );
            Reply::json(StatusCode::OK, returned.clone())
        }
    })
    .await;
    let state = webknossos_datastore::AppState::new(wk.config());
    (wk, router(state))
}

#[tokio::test]
async fn legacy_proxy_metadata_downgrades_only_safe_largest_ids_and_keeps_access_and_headers() {
    let root = layer_dir();
    let mut source = source(&root);
    let mut large = source["dataLayers"][0].clone();
    large["name"] = json!("large");
    large["largestSegmentId"] = json!({"customJsonEncoding":"bigint","value":"9007199254740992"});
    source["dataLayers"].as_array_mut().unwrap().push(large);
    let (wk, app) = app_with_source(source).await;
    for version in 10..=16 {
        let (status, headers, bytes) = get(
            &app,
            &format!("/data/v{version}/datasets/{ID}/proxy/datasource-properties.json"),
            "good",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body["dataLayers"][0]["largestSegmentId"],
            if version <= 14 {
                json!(5)
            } else {
                json!({"customJsonEncoding":"bigint","value":"5"})
            }
        );
        assert_eq!(
            body["dataLayers"][1]["largestSegmentId"],
            json!({"customJsonEncoding":"bigint","value":"9007199254740992"})
        );
        assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
        if version <= 14 {
            assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
        }
    }
    let (status, headers, body) = send(
        app.clone(),
        Request::head(format!(
            "/data/v14/datasets/{ID}/proxy/datasource-properties.json"
        ))
        .header("x-auth-token", "good")
        .body(Body::empty())
        .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_empty());
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
    let before = wk
        .calls()
        .iter()
        .filter(|c| !c.path.ends_with("/validateUserAccess"))
        .count();
    let (status, _, _) = get(
        &app,
        &format!("/data/v14/datasets/{ID}/proxy/datasource-properties.json"),
        "bad",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        wk.calls()
            .iter()
            .filter(|c| !c.path.ends_with("/validateUserAccess"))
            .count(),
        before
    );
}

async fn get(
    app: &Router,
    path: &str,
    token: &str,
    range: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut request = Request::get(path).header("x-auth-token", token);
    if let Some(range) = range {
        request = request.header("range", range);
    }
    send(app.clone(), request.body(Body::empty()).unwrap()).await
}

fn error(body: &[u8]) -> String {
    body_json(body)["messages"][0]["error"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn proxies_mag_bytes_with_ranges() {
    let root = layer_dir();
    let (_wk, app) = app(&root).await;
    let base = format!("/data/datasets/{ID}/proxy/layers/seg/mags");

    let (status, headers, body) =
        get(&app, &format!("{base}/1-1-1/0-1_0-1_0-1"), "good", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, CHUNK);
    assert_eq!(header(&headers, "accept-ranges"), Some("bytes"));
    assert_eq!(
        header(&headers, "content-type"),
        Some("application/octet-stream")
    );
    assert_eq!(header(&headers, "content-encoding"), None);
    // DataProxyController does not allow remote origins.
    assert_eq!(header(&headers, "access-control-allow-origin"), None);

    // Scalar mag literal and version alias.
    let (status, headers, body) = get(
        &app,
        &format!("/data/v10/datasets/{ID}/proxy/layers/seg/mags/1/0-1_0-1_0-1"),
        "good",
        Some("bytes=2-4"),
    )
    .await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, b"234");
    assert_eq!(header(&headers, "content-range"), Some("bytes 2-4/10"));

    let (status, _, body) = get(
        &app,
        &format!("{base}/1-1-1/0-1_0-1_0-1"),
        "good",
        Some("bytes=-3"),
    )
    .await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, b"789");

    let (status, _, body) = get(
        &app,
        &format!("{base}/1-1-1/0-1_0-1_0-1"),
        "good",
        Some("bytes=1-2,4-5"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error(&body).starts_with("Invalid range header"));
}

#[tokio::test]
async fn rejects_bad_paths_mags_and_missing_files() {
    let root = layer_dir();
    let (wk, app) = app(&root).await;
    let base = format!("/data/datasets/{ID}/proxy/layers/seg/mags");

    for (path, message) in [
        ("1-1-1/a/../b", "path must not contain “..”"),
        ("1-1-1/%2e%2e/info", "path must not contain “%2e%2e”"),
        ("1-1-1/%2finfo", "path must not start with “%2f”"),
    ] {
        let (status, _, body) = get(&app, &format!("{base}/{path}"), "good", None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(error(&body), message);
    }
    // Path validation precedes the datasource lookup.
    assert!(
        wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );

    let (status, _, body) = get(&app, &format!("{base}/x-y/file"), "good", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "Invalid mag “x-y”. Please use “x-y-z”.");

    let (status, _, body) = get(&app, &format!("{base}/2-2-2/file"), "good", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error(&body), "Data layer “seg” does not have mag “2-2-2”.");

    let (status, _, body) = get(&app, &format!("{base}/1-1-1/missing"), "good", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        error(&body),
        "Could not find or access the requested resource."
    );

    let (status, _, body) = get(
        &app,
        &format!("/data/datasets/{ID}/proxy/layers/nope/mags/1-1-1/x"),
        "good",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error(&body), "Could not find layer “nope” in dataset.");
}

#[tokio::test]
async fn denied_access_reads_nothing() {
    let root = layer_dir();
    let (wk, app) = app(&root).await;
    for path in [
        format!("/data/datasets/{ID}/proxy/layers/seg/mags/1-1-1/0-1_0-1_0-1"),
        format!("/data/datasets/{ID}/proxy/layers/seg/mags/info"),
        format!("/data/datasets/{ID}/proxy/layers/seg/attachments/mesh/m/info"),
        format!("/data/datasets/{ID}/proxy/datasource-properties.json"),
    ] {
        let (status, _, _) = get(&app, &path, "bad", None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    assert!(
        wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
}

#[tokio::test]
async fn serves_adapted_precomputed_info() {
    let root = layer_dir();
    let (_wk, app) = app(&root).await;
    let (status, _, body) = get(
        &app,
        &format!("/data/datasets/{ID}/proxy/layers/seg/mags/info"),
        "good",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body_json(&body),
        json!({"type":"image","data_type":"uint8","num_channels":1,"scales":[{
            "key":"1","size":[8,8,8],"resolution":[4.0,4.0,40.0],"chunk_sizes":[[8,8,8]],
            "encoding":"raw","sharding":{"@type":"neuroglancer_uint64_sharded_v1",
            "preshift_bits":0,"hash":"identity","minishard_bits":0,"shard_bits":0,
            "minishard_index_encoding":"raw","data_encoding":"raw"}}]})
    );
}

#[tokio::test]
async fn proxies_attachments() {
    let root = layer_dir();
    let (_wk, app) = app(&root).await;
    let base = format!("/data/datasets/{ID}/proxy/layers/seg/attachments");
    let (status, headers, body) = get(&app, &format!("{base}/mesh/m/info"), "good", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"{\"@type\":\"m\"}");
    assert_eq!(header(&headers, "accept-ranges"), Some("bytes"));

    let (status, _, body) = get(&app, &format!("{base}/mesh/other/info"), "good", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        error(&body),
        "Data layer “seg” does not have attachment “other”."
    );

    let (status, _, body) = get(&app, &format!("{base}/meshes/m/info"), "good", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        error(&body),
        "Could not find or access the requested resource."
    );

    let (status, _, _) = get(&app, &format!("{base}/mesh/m/../x"), "good", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn serves_datasource_with_proxy_paths() {
    let root = layer_dir();
    let (_wk, app) = app(&root).await;
    let (status, headers, body) = get(
        &app,
        &format!("/data/datasets/{ID}/proxy/datasource-properties.json"),
        "good",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
    let source = body_json(&body);
    let layer = &source["dataLayers"][0];
    // Scala `toMagLiteral(allowScalar = true)` and relative `LocalUPath.toString` (`./` prefix).
    assert_eq!(layer["mags"][0]["path"], "./layers/seg/mags/1");
    assert_eq!(layer["mags"][0]["mag"], json!([1, 1, 1]));
    assert_eq!(
        layer["attachments"]["meshes"][0]["path"],
        "./layers/seg/attachments/mesh/m"
    );
    assert_eq!(source["id"], json!({"name":"ds","team":"org"}));
}
