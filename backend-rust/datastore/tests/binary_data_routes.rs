//! Actual datastore router -> access RPC -> datasource cache -> vault/reader -> binary service.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::{header, json as body_json, send};
use mock_wk::{KEY, MockWk, Reply};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use webknossos_datastore::{AppState, router};

const ID: &str = "0123456789abcdef01234567";
fn url(endpoint: &str) -> String {
    format!("/data/datasets/{ID}/layers/color/{endpoint}")
}
fn fixtures(s: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(s)
}
fn source(format: &str, path: &Path, element: &str, bbox: Value, axis: Value) -> Value {
    json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"color","category":"color","elementClass":element,"dataFormat":format,
        "boundingBox":bbox,"mags":[{"mag":[1,1,1],"path":path.to_str().unwrap(),"axisOrder":axis}]}]})
}
fn bbox(p: [i32; 3], size: [i32; 3]) -> Value {
    json!({"topLeft":p,"width":size[0],"height":size[1],"depth":size[2]})
}
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-data-routes-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn value(x: i32, y: i32, z: i32) -> u8 {
    (x + 13 * y + 37 * z) as u8
}
fn synthetic() -> (PathBuf, Value) {
    let p = temp();
    std::fs::write(
        p.join(".zarray"),
        serde_json::to_vec(&json!({"zarr_format":2,
        "shape":[64,32,32],"chunks":[32,32,32],"dtype":"|u1","order":"F",
        "compressor":null,"fill_value":0}))
        .unwrap(),
    )
    .unwrap();
    let mut data = Vec::new();
    for z in 0..32 {
        for y in 0..32 {
            for x in 0..32 {
                data.push(value(x, y, z));
            }
        }
    }
    std::fs::write(p.join("0.0.0"), data).unwrap();
    std::fs::write(p.join("1.0.0"), [1]).unwrap();
    let source = source(
        "zarr",
        &p,
        "uint8",
        bbox([0, 0, 0], [64, 32, 32]),
        json!({"x":0,"y":1,"z":2}),
    );
    (p, source)
}
async fn app(source: Value) -> (MockWk, AppState, Router, Arc<Mutex<Value>>) {
    let data = Arc::new(Mutex::new(source));
    let returned = Arc::clone(&data);
    let wk = MockWk::start(move |call| {
        assert_eq!(call.query_value("key").as_deref(), Some(KEY));
        if call.path.ends_with("/validateUserAccess") {
            assert_eq!(
                call.json(),
                json!({"resourceId":ID,"resourceType":"dataset","mode":"read"})
            );
            let granted = call.query_value("token").as_deref() == Some("good");
            Reply::json(
                StatusCode::OK,
                json!({"granted":granted,"msg":"Read permission required."}),
            )
        } else {
            assert_eq!(
                call.path,
                format!("/api/datastores/test-ds/datasources/{ID}")
            );
            assert!(call.query_value("token").is_none());
            Reply::json(StatusCode::OK, returned.lock().unwrap().clone())
        }
    })
    .await;
    let state = AppState::new(wk.config());
    (wk, state.clone(), router(state), data)
}
async fn post(
    app: &Router,
    path: &str,
    body: Value,
    token: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::post(path)
            .header("content-type", "application/json")
            .header("x-auth-token", token)
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await
}
async fn get(app: &Router, path: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::get(path)
            .header("x-auth-token", "good")
            .body(Body::empty())
            .unwrap(),
    )
    .await
}
fn cube(position: [i32; 3], mag: [i32; 3], size: i32) -> Value {
    json!({"position":position,"mag":mag,"cubeSize":size})
}
fn success_headers(headers: &HeaderMap) {
    assert_eq!(
        header(headers, "content-type"),
        Some("application/octet-stream")
    );
    assert_eq!(header(headers, "cache-control"), Some("no-cache"));
    assert_eq!(header(headers, "access-control-allow-origin"), Some("*"));
    assert_eq!(
        header(headers, "access-control-expose-headers"),
        Some("failure-bucket-indices, empty-bucket-indices, MISSING-BUCKETS")
    );
    assert_eq!(header(headers, "empty-bucket-indices"), Some("[]"));
    assert_eq!(header(headers, "failure-bucket-indices"), Some("[]"));
    assert_eq!(header(headers, "missing-buckets"), Some("[]"));
}

#[tokio::test]
async fn four_entrypoints_and_versions_replay_actual_binary_bytes() {
    let (_, s) = synthetic();
    let (wk, _, app, _) = app(s).await;
    let body = cube([2, 2, 2], [1, 1, 1], 2);
    let (status, headers, actual) = post(&app, &url("data"), json!([body]), "good").await;
    assert_eq!(status, StatusCode::OK);
    success_headers(&headers);
    let expected: Vec<u8> = (2..4)
        .flat_map(|z| (2..4).flat_map(move |y| (2..4).map(move |x| value(x, y, z))))
        .collect();
    assert_eq!(actual, expected);
    let (status, headers, actual) = post(
        &app,
        &url("readData"),
        json!({"position":[2,2,2],"mag":[1,1,1],"cubeSize":[2,2,2]}),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    success_headers(&headers);
    assert_eq!(actual, expected);
    for prefix in ["/data", "/data/v10", "/data/v16"] {
        let path = format!(
            "{prefix}/datasets/{ID}/layers/color/data?x=2&y=2&z=2&width=2&height=2&depth=2&mag=1-1-1"
        );
        let (status, headers, actual) = get(&app, &path).await;
        assert_eq!(status, StatusCode::OK);
        success_headers(&headers);
        assert_eq!(actual, expected);
    }
    let (status, headers, actual) = get(&app, &url("mag1/x1/y1/z1/bucket.raw?cubeSize=2")).await;
    assert_eq!(status, StatusCode::OK);
    success_headers(&headers);
    assert_eq!(actual, expected);
    assert_eq!(
        wk.calls().len(),
        2,
        "access and datasource are independently cached"
    );
}

#[tokio::test]
async fn batch_order_missing_failure_indices_and_half_byte_contract() {
    let (_, s) = synthetic();
    let (_, _, app, _) = app(s).await;
    let (status, headers, data) = post(
        &app,
        &url("data"),
        json!([
            cube([2, 2, 2], [1, 1, 1], 2),
            cube([0, 0, 0], [2, 2, 2], 32),
            cube([32, 0, 0], [1, 1, 1], 32),
            cube([3, 3, 3], [1, 1, 1], 1)
        ]),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(data.len(), 9);
    assert_eq!(data[0], value(2, 2, 2));
    assert_eq!(data[8], value(3, 3, 3));
    assert_eq!(header(&headers, "empty-bucket-indices"), Some("[1]"));
    assert_eq!(header(&headers, "failure-bucket-indices"), Some("[2]"));
    assert_eq!(header(&headers, "missing-buckets"), Some("[1, 2]"));
    let query = "data?x=2&y=2&z=2&width=2&height=1&depth=1&mag=1-1-1&halfByte=1&halfByte=false";
    let (status, headers, data) = get(&app, &url(query)).await;
    assert_eq!(status, StatusCode::OK);
    success_headers(&headers);
    assert_eq!(data, vec![(value(2, 2, 2) & 0xf0) | (value(3, 2, 2) >> 4)]);
    let (status, headers, data) = post(&app, &url("data"), json!([]), "good").await;
    assert_eq!(status, StatusCode::OK);
    success_headers(&headers);
    assert!(data.is_empty());
}

#[tokio::test]
async fn auth_is_required_even_when_datasource_and_chunks_are_cached() {
    let (_, s) = synthetic();
    let (wk, state, app, _) = app(s).await;
    let payload = json!([cube([0, 0, 0], [1, 1, 1], 2)]);
    let (status, _, _) = post(&app, &url("data"), payload.clone(), "bad").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(state.datasets.is_empty());
    assert_eq!(state.binary_data.cached_provider_count(), 0);
    assert_eq!(wk.calls().len(), 1);
    assert_eq!(
        post(&app, &url("data"), payload.clone(), "good").await.0,
        StatusCode::OK
    );
    let (status, headers, body) = post(&app, &url("data"), payload, "bad").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        header(&headers, "content-type"),
        Some("text/plain; charset=utf-8")
    );
    assert_eq!(
        String::from_utf8(body).unwrap(),
        "Token may be expired, consider reloading. Access forbidden: Read permission required."
    );
    assert_eq!(wk.calls().len(), 3);
    // A query token takes priority over the header, even after a denied header was cached.
    assert_eq!(
        post(&app, &url("data?token=good"), json!([]), "bad")
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn play_schema_errors_and_path_binding_fail_before_rpc_or_data_access() {
    let (_, s) = synthetic();
    let (wk, _, app, _) = app(s).await;
    let (status, _, body) = post(
        &app,
        &url("data"),
        json!([{"position":[0,0,0],"mag":[1,1,1]}]),
        "bad",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body_json(&body),
        json!({"obj[0].cubeSize":[{"msg":["error.path.missing"],"args":[]}]})
    );
    let (status, _, body) = post(
        &app,
        &url("readData"),
        json!({"position":[0,0,0],"mag":[1,1,1],"cubeSize":32}),
        "bad",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body_json(&body)["obj.cubeSize"].is_array());
    let (status, _, _) = post(
        &app,
        "/data/datasets/invalid/layers/color/data",
        json!([]),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(wk.calls().is_empty());
    let prefixed = format!(
        "/data/datasets/human-name-{}/layers/color/data",
        ID.to_ascii_uppercase()
    );
    assert_eq!(
        post(&app, &prefixed, json!([]), "good").await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn datasource_layer_and_mag_errors_follow_controller_contracts() {
    let (_, s) = synthetic();
    let (_, state, app, data) = app(s).await;
    let query = "data?x=0&y=0&z=0&width=2&height=2&depth=2&mag=1";
    let (status, _, body) = get(&app, &url(query)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body_json(&body)["messages"][0]["error"],
        "Invalid mag “1”. Please use “x-y-z”."
    );
    let path = url("readData").replace("/color/", "/absent/");
    let (status, _, body) = post(
        &app,
        &path,
        json!({"position":[0,0,0],"mag":[1,1,1],"cubeSize":[2,2,2]}),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body_json(&body)["messages"][0]["error"],
        "Could not find layer “absent” in dataset."
    );
    let path = url("data").replace("/color/", "/absent/");
    let (status, _, body) = post(&app, &path, json!([]), "good").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body_json(&body)["messages"][0]["error"],
        "Data source not found on data store server. It may still be initializing."
    );
    *data.lock().unwrap() = json!({"id":{"name":"ds","team":"org"},"status":"Not imported yet."});
    state.datasets.invalidate(ID);
    let (status, _, body) = post(&app, &url("data"), json!([]), "good").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        body_json(&body)["messages"][1]["chain"]
            .as_str()
            .unwrap()
            .contains("Data source is not usable: Some(Not imported yet.)")
    );
}

#[tokio::test]
async fn all_native_reader_fixtures_replay_through_authorized_read_data_route() {
    for (format, dir, element, origin, size, bounds, axis, expected) in [
        (
            "zarr3",
            "zarr3/shard_end",
            "uint16",
            [1, 1, 1],
            [6, 5, 4],
            bbox([0, 0, 0], [7, 6, 5]),
            json!({"c":0,"x":1,"y":2,"z":3}),
            "zarr3/shard_end/expected.bin",
        ),
        (
            "n5",
            "n5/real_gzip",
            "uint16",
            [1, 2, 3],
            [8, 8, 8],
            bbox([1, 2, 3], [8, 8, 8]),
            json!({"x":0,"y":1,"z":2}),
            "n5/real_gzip/expected.bin",
        ),
        (
            "neuroglancerPrecomputed",
            "precomputed/shard_murmur/1",
            "uint16",
            [6, 8, 12],
            [4, 3, 2],
            bbox([5, 7, 11], [5, 4, 3]),
            json!({"x":0,"y":1,"z":2}),
            "precomputed/shard_murmur/expected.bin",
        ),
    ] {
        let (_, _, app, _) = app(source(format, &fixtures(dir), element, bounds, axis)).await;
        let (status, headers, data) = post(
            &app,
            &url("readData"),
            json!({"position":origin,"mag":[1,1,1],"cubeSize":size}),
            "good",
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}");
        success_headers(&headers);
        assert_eq!(data, std::fs::read(fixtures(expected)).unwrap(), "{format}");
    }
    let (_, _, app, _) = app(source(
        "wkw",
        &fixtures("wkw/lz4hc"),
        "uint24",
        bbox([0, 0, 0], [16, 8, 8]),
        Value::Null,
    ))
    .await;
    let (status, headers, data) = post(
        &app,
        &url("data"),
        json!([cube([0, 0, 0], [1, 1, 1], 32)]),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    success_headers(&headers);
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
    assert_eq!(data, expected);
}

#[tokio::test]
async fn json_parser_memory_limit_is_enforced_before_authentication() {
    let (_, s) = synthetic();
    let (wk, _, _, _) = app(s).await;
    let mut config = wk.config();
    config.http.max_memory_buffer = 32;
    config.http.max_disk_buffer = 1024;
    let state = AppState::new(config);
    let app = router(state.clone());
    let (status, _, _) = post(
        &app,
        &url("data"),
        json!([cube([0, 0, 0], [1, 1, 1], 32)]),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(wk.calls().is_empty());
    assert!(state.datasets.is_empty());
    assert_eq!(
        post(&app, &url("data"), json!([]), "good").await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn request_tokens_reach_remote_chunks_after_datasource_and_array_cache_hits() {
    use axum::{
        extract::{Path as RoutePath, State},
        routing::get,
    };
    type Reads = Arc<Mutex<Vec<(String, Option<String>)>>>;
    async fn serve(
        State(reads): State<Reads>,
        RoutePath(file): RoutePath<String>,
        headers: HeaderMap,
    ) -> Vec<u8> {
        reads.lock().unwrap().push((
            file.clone(),
            headers
                .get("X-Auth-Token")
                .map(|v| v.to_str().unwrap().to_owned()),
        ));
        if file == ".zarray" {
            serde_json::to_vec(
                &json!({"zarr_format":2,"shape":[32,32,64],"chunks":[32,32,32],
                "dtype":"|u1","order":"C","compressor":null,"fill_value":0}),
            )
            .unwrap()
        } else {
            vec![if file == "0.0.0" { 1 } else { 2 }; 32768]
        }
    }
    let reads: Reads = Arc::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route("/array/{file}", get(serve))
                .with_state(reads.clone()),
        )
        .into_future(),
    );
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"color","category":"color","dataFormat":"zarr","elementClass":"uint8",
        "boundingBox":bbox([0,0,0],[64,32,32]),"mags":[{"mag":[1,1,1],"path":format!("{base}/array")}]}]});
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(StatusCode::OK, json!({"granted":true}))
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let mut config = wk.config();
    config.http.uri = base;
    let app = router(AppState::new(config));
    for (token, x, byte) in [("a", 0, 1), ("b", 32, 2)] {
        let (status, headers, data) = post(
            &app,
            &url("data"),
            json!([cube([x, 0, 0], [1, 1, 1], 32)]),
            token,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        success_headers(&headers);
        assert_eq!(data, vec![byte; 32768]);
    }
    assert_eq!(
        *reads.lock().unwrap(),
        vec![
            (".zarray".into(), Some("a".into())),
            ("0.0.0".into(), Some("a".into())),
            ("0.0.1".into(), Some("b".into()))
        ]
    );
    assert_eq!(
        wk.calls()
            .iter()
            .filter(|c| c.path.ends_with(&format!("/datasources/{ID}")))
            .count(),
        1
    );
    server.abort();
}
