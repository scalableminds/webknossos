mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::send;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{AppState, router};
const ID: &str = "0123456789abcdef01234567";
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/meshes")
}
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-mesh-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for file in std::fs::read_dir(from).unwrap() {
        let file = file.unwrap();
        if file.file_type().unwrap().is_dir() {
            copy_dir(&file.path(), &to.join(file.file_name()));
        } else {
            std::fs::copy(file.path(), to.join(file.file_name())).unwrap();
        }
    }
}
async fn start() -> (MockWk, Router, PathBuf) {
    let root = temp();
    for name in ["zarr3", "precomputed", "precomputed_gzip"] {
        copy_dir(&fixtures().join(name), &root.join(name));
    }
    for name in ["local", "gzip", "real"] {
        std::fs::copy(
            fixtures().join(format!("{name}.hdf5")),
            root.join(format!("{name}.hdf5")),
        )
        .unwrap();
    }
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/agglomerates/contiguous.hdf5"),
        root.join("agg.hdf5"),
    )
    .unwrap();
    let mesh = |name: &str, format: &str, path: PathBuf| json!({"name":name,"dataFormat":format,"path":path});
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr","largestSegmentId":5,"boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":root.join("seg")}],"attachments":{"meshes":[mesh("local","hdf5",root.join("local.hdf5")),mesh("zarr3","zarr3",root.join("zarr3")),mesh("precomputed","neuroglancerPrecomputed",root.join("precomputed")),mesh("gzip","hdf5",root.join("gzip.hdf5")),mesh("missing-hdf","hdf5",root.join("absent.hdf5")),mesh("missing-zarr","zarr3",root.join("absent-zarr")),mesh("missing-precomputed","neuroglancerPrecomputed",root.join("absent-pc"))],"agglomerates":[{"name":"agg","dataFormat":"hdf5","path":root.join("agg.hdf5")}]}}]});
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
    let app = router(AppState::new(wk.config()));
    (wk, app, root)
}
async fn call(
    app: &Router,
    suffix: &str,
    body: Option<Value>,
    token: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut request = Request::builder()
        .method(if body.is_some() { "POST" } else { "GET" })
        .uri(format!("/data/datasets/{ID}/layers/seg/meshes{suffix}"))
        .header("x-auth-token", token);
    let bytes = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        serde_json::to_vec(&body).unwrap()
    } else {
        vec![]
    };
    send(app.clone(), request.body(Body::from(bytes)).unwrap()).await
}
async fn chunks(app: &Router, name: &str, id: u64, query: &str) -> Value {
    let (status,_,bytes)=call(app,&format!("/chunks{query}"),Some(json!({"meshFileName":name,"segmentId":{"customJsonEncoding":"bigint","value":id.to_string()}})),"t").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap()
}
#[tokio::test]
async fn lists_formats_and_preserves_scala_missing_file_differences() {
    let (_wk, app, _) = start().await;
    let (status, _, bytes) = call(&app, "", None, "t").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap(),
        json!([{"name":"local","formatVersion":7},{"name":"zarr3","formatVersion":7},{"name":"precomputed","formatVersion":7},{"name":"gzip","formatVersion":7},{"name":"missing-hdf","formatVersion":0},{"name":"missing-precomputed","formatVersion":7}])
    );
}
#[tokio::test]
async fn reads_all_format_chunks_in_requested_order_and_sets_gzip_header() {
    let (_wk, app, _) = start().await;
    for name in ["local", "zarr3", "precomputed", "gzip"] {
        let info = chunks(&app, name, u64::MAX, "").await;
        let lods = info["lods"].as_array().unwrap();
        let mut pieces = lods
            .iter()
            .flat_map(|lod| lod["chunks"].as_array().unwrap())
            .cloned()
            .collect::<Vec<_>>();
        pieces.rotate_right(1);
        let requests=pieces.into_iter().map(|chunk|json!({"byteOffset":chunk["byteOffset"],"byteSize":chunk["byteSize"],"segmentId":{"customJsonEncoding":"bigint","value":"18446744073709551615"}})).collect::<Vec<_>>();
        let (status, headers, bytes) = call(
            &app,
            "/chunks/data",
            Some(json!({"meshFileName":name,"requests":requests})),
            "t",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        if name == "gzip" {
            assert_eq!(headers["content-encoding"], "gzip");
            use std::io::Read;
            let mut raw = Vec::new();
            flate2::read::MultiGzDecoder::new(&bytes[..])
                .read_to_end(&mut raw)
                .unwrap();
            assert_eq!(raw, b"789123456");
        } else {
            assert_eq!(bytes, b"789123456");
            assert!(!headers.contains_key("content-encoding"));
        }
    }
}
#[tokio::test]
async fn expands_mapping_ids_and_omits_missing_local_segments() {
    let (_wk, app, _) = start().await;
    let info = chunks(&app, "local", 1, "?targetMappingName=agg").await;
    // Agglomerate1 has segments1/2/3; only2 has mesh chunks, so missing members are omitted.
    assert_eq!(info["lods"][0]["chunks"].as_array().unwrap().len(), 2);
    assert_eq!(info["lods"][1]["chunks"].as_array().unwrap().len(), 1);
    let (status, _, _) = call(
        &app,
        "/chunks",
        Some(json!({"meshFileName":"local","segmentId":6})),
        "t",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = call(
        &app,
        "/chunks",
        Some(json!({"meshFileName":"precomputed","segmentId":6})),
        "t",
    )
    .await;
    assert_ne!(status, StatusCode::OK);
}
#[tokio::test]
async fn rejects_schema_ranges_segment_id_mismatches_and_warm_cache_denial() {
    let (wk, app, _) = start().await;
    let (status, _, _) = call(
        &app,
        "/chunks",
        Some(json!({"meshFileName":"local","segmentId":"bad"})),
        "t",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(wk.calls().is_empty());
    chunks(&app, "local", 2, "").await;
    let (status, _, _) = call(
        &app,
        "/chunks",
        Some(json!({"meshFileName":"local","segmentId":2})),
        "denied",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for body in [
        json!({"meshFileName":"local","requests":[{"byteOffset":-1,"byteSize":1}]}),
        json!({"meshFileName":"local","requests":[{"byteOffset":i64::MAX,"byteSize":1}]}),
        json!({"meshFileName":"precomputed","requests":[]}),
        json!({"meshFileName":"precomputed","requests":[{"byteOffset":0,"byteSize":1,"segmentId":2},{"byteOffset":1,"byteSize":1,"segmentId":4}]}),
    ] {
        assert_eq!(
            call(&app, "/chunks/data", Some(body), "t").await.0,
            StatusCode::BAD_REQUEST
        );
    }
}
#[tokio::test]
async fn actual_http_invalidation_refreshes_zarr_payload_chunks() {
    let (_wk, app, root) = start().await;
    let body = json!({"meshFileName":"zarr3","requests":[{"byteOffset":0,"byteSize":4}]});
    assert_eq!(
        call(&app, "/chunks/data", Some(body.clone()), "t").await.2,
        b"ABCD"
    );
    let path = root.join("zarr3/neuroglancer/c/0");
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[..4].copy_from_slice(b"WXYZ");
    std::fs::write(path, bytes).unwrap();
    assert_eq!(
        call(&app, "/chunks/data", Some(body.clone()), "t").await.2,
        b"ABCD"
    );
    let request = Request::builder()
        .method("DELETE")
        .uri(format!("/data/datasets/{ID}"))
        .header("x-auth-token", "t")
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(app.clone(), request).await.0, StatusCode::OK);
    assert_eq!(call(&app, "/chunks/data", Some(body), "t").await.2, b"WXYZ");
}

#[tokio::test]
async fn current_tokens_reach_remote_manifests_and_fragments_after_cache_hits() {
    use axum::{extract::OriginalUri, http::header, response::IntoResponse};
    use std::sync::{Arc, Mutex};
    let reads = Arc::new(Mutex::new(Vec::<(String, Option<String>)>::new()));
    let log = Arc::clone(&reads);
    let server =
        Router::new().fallback(move |OriginalUri(uri): OriginalUri, headers: HeaderMap| {
            let log = Arc::clone(&log);
            async move {
                let path = uri.path().trim_start_matches('/').to_owned();
                log.lock().unwrap().push((
                    path.clone(),
                    headers
                        .get("x-auth-token")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned),
                ));
                let bytes = std::fs::read(fixtures().join(&path)).unwrap();
                if let Some(range) = headers.get(header::RANGE) {
                    let range = range.to_str().unwrap().trim_start_matches("bytes=");
                    let (a, b) = range.split_once('-').unwrap();
                    let a = a.parse::<usize>().unwrap();
                    let b = b.parse::<usize>().unwrap();
                    (
                        StatusCode::PARTIAL_CONTENT,
                        [(
                            header::CONTENT_RANGE,
                            format!("bytes {a}-{b}/{}", bytes.len()),
                        )],
                        bytes[a..=b].to_vec(),
                    )
                        .into_response()
                } else {
                    bytes.into_response()
                }
            }
        });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, server).await.unwrap();
    });
    let uri = format!("http://{address}");
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr","largestSegmentId":4,"boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":"/tmp/seg"}],"attachments":{"meshes":[{"name":"remote","dataFormat":"neuroglancerPrecomputed","path":format!("{uri}/precomputed_gzip")}]}}]});
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(StatusCode::OK, json!({"granted":true}))
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let mut config = wk.config();
    config.http.uri = uri;
    let app = router(AppState::new(config));
    for token in ["a", "b"] {
        let (status, _, bytes) = call(
            &app,
            "/chunks",
            Some(json!({"meshFileName":"remote","segmentId":2})),
            token,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        let info: Value = serde_json::from_slice(&bytes).unwrap();
        let chunk = &info["lods"][0]["chunks"][0];
        let (status,_,bytes)=call(&app,"/chunks/data",Some(json!({"meshFileName":"remote","requests":[{"byteOffset":chunk["byteOffset"],"byteSize":chunk["byteSize"],"segmentId":2}]})),token).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(bytes, b"ABCD");
    }
    let log = reads.lock().unwrap().clone();
    assert_eq!(
        log.iter()
            .filter(|(path, _)| path.ends_with("info"))
            .count(),
        1
    );
    assert_eq!(
        log.iter()
            .filter(|(_, token)| token.as_deref() == Some("b"))
            .count(),
        2,
        "{log:?}"
    );
    task.abort();
}
