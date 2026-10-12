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
use webknossos_datastore::{AppState, router};
const ID: &str = "0123456789abcdef01234567";
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/connectomes")
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
async fn start() -> (MockWk, Router, AppState, PathBuf) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let root = std::env::temp_dir().join(format!(
        "wk-connectomes-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    copy(&fixtures(), &root);
    let attachment = |name: &str, path: PathBuf, format: &str| json!({"name":name,"path":path,"dataFormat":format});
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr","largestSegmentId":7,"boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":"/not-read"}],"attachments":{"connectomes":[attachment("hdf",root.join("contiguous.hdf5"),"hdf5"),attachment("filtered",root.join("chunked_v4.hdf5"),"hdf5"),attachment("zarr",root.join("zarr3"),"zarr3"),attachment("missing",root.join("absent.hdf5"),"hdf5"),attachment("unsupported",root.join("contiguous.hdf5"),"neuroglancerPrecomputed")]}}]});
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
async fn call(app: &Router, route: &str, body: Option<Value>, token: &str) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(if body.is_some() { "POST" } else { "GET" })
        .uri(format!("/data/datasets/{ID}/layers/seg/connectomes{route}"))
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
fn oracle(zarr: bool) -> Value {
    serde_json::from_slice(
        &std::fs::read(fixtures().join(if zarr {
            "scala_zarr_oracle.json"
        } else {
            "scala_oracle.json"
        }))
        .unwrap(),
    )
    .unwrap()
}
#[tokio::test]
async fn all_five_routes_match_actual_scala_native_and_zarr_oracles() {
    let (_wk, app, _, _) = start().await;
    assert_eq!(
        call(&app, "", None, "t").await,
        (
            StatusCode::OK,
            json!([{"connectomeFileName":"hdf","mappingName":"connectome_mapping"},{"connectomeFileName":"filtered","mappingName":"connectome_mapping"},{"connectomeFileName":"zarr","mappingName":"connectome_mapping"}])
        )
    );
    for name in ["hdf", "filtered", "zarr"] {
        let oracle = oracle(name == "zarr");
        for case in oracle["synapses"].as_array().unwrap() {
            let body = json!({"connectomeFile":name,"agglomerateIds":case["ids"]});
            assert_eq!(
                call(&app, "/synapses", Some(body), "t").await,
                (StatusCode::OK, case["value"].clone()),
                "{name}: {case}"
            );
        }
        for (route, field) in [("positions", "positions"), ("types", "types")] {
            assert_eq!(
                call(
                    &app,
                    &format!("/synapses/{route}"),
                    Some(json!({"connectomeFile":name,"synapseIds":oracle["selected"]})),
                    "t"
                )
                .await,
                (StatusCode::OK, oracle[field].clone()),
                "{name}: {field}"
            );
        }
        for direction in ["src", "dst"] {
            let expected=oracle[direction].as_array().unwrap().iter().map(|id|json!({"customJsonEncoding":"bigint","value":(id.as_i64().unwrap() as u64).to_string()})).collect::<Vec<_>>();
            assert_eq!(
                call(
                    &app,
                    &format!("/synapses/{direction}"),
                    Some(json!({"connectomeFile":name,"synapseIds":oracle["selected"]})),
                    "t"
                )
                .await,
                (StatusCode::OK, json!(expected))
            );
        }
        for case in oracle["boundaries"].as_array().unwrap() {
            let (status, value) = call(
                &app,
                "/synapses/dst",
                Some(json!({"connectomeFile":name,"synapseIds":[case["id"]]})),
                "t",
            )
            .await;
            if case["ok"].as_bool().unwrap() {
                assert_eq!(status, StatusCode::OK);
                assert_eq!(value, json!([{"customJsonEncoding":"bigint","value":"0"}]))
            } else {
                assert_eq!(status, StatusCode::BAD_REQUEST, "{value}");
            }
        }
    }
}
#[tokio::test]
async fn auth_schema_direction_and_missing_files_are_enforced() {
    let (wk, app, _, _) = start().await;
    assert_eq!(
        call(&app, "", None, "denied").await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "/synapses/invalid",
            Some(json!({"connectomeFile":"hdf","synapseIds":[]})),
            "denied"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert!(
        wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
    let (_, value) = call(
        &app,
        "/synapses/invalid",
        Some(json!({"connectomeFile":"hdf","synapseIds":[]})),
        "t",
    )
    .await;
    assert_eq!(
        value["messages"][0]["error"],
        "could not parse synaptic partner direction"
    );
    for body in [
        json!({"connectomeFile":true,"synapseIds":[]}),
        json!({"connectomeFile":"hdf","synapseIds":[{"customJsonEncoding":"bigint","value":"1"}]}),
        json!({"connectomeFile":"hdf","synapseIds":"wrong"}),
    ] {
        let (status, value) = call(&app, "/synapses/types", Some(body), "t").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            value
                .as_object()
                .unwrap()
                .keys()
                .any(|k| k.starts_with("obj.")),
            "{value}"
        );
    }
    assert_eq!(
        call(
            &app,
            "/synapses",
            Some(json!({"connectomeFile":"not-attached","agglomerateIds":[]})),
            "t"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "/synapses/types",
            Some(json!({"connectomeFile":"missing","synapseIds":[]})),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "/synapses/types",
            Some(json!({"connectomeFile":"unsupported","synapseIds":[]})),
            "t"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Scala skips the reader entirely for no directed pairs, even when the format is unsupported.
    assert_eq!(
        call(
            &app,
            "/synapses",
            Some(json!({"connectomeFile":"unsupported","agglomerateIds":[]})),
            "t"
        )
        .await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(call(&app,"/synapses",Some(json!({"connectomeFile":"zarr","agglomerateIds":[{"customJsonEncoding":"bigint","value":"18446744073709551615"}]})),"t").await,(StatusCode::OK,json!([{"in":[],"out":[]}])));
}
#[tokio::test]
async fn warm_cache_authorization_and_http_invalidation_reload_changed_tables() {
    let (_wk, app, state, root) = start().await;
    let body = json!({"connectomeFile":"zarr","synapseIds":[0]});
    let original = call(&app, "/synapses/positions", Some(body.clone()), "first").await;
    assert_eq!(original, (StatusCode::OK, json!([[0, 1, 2]])));
    let path = root.join("zarr3/synapse_positions/c/0/0");
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[..8].copy_from_slice(&999u64.to_le_bytes());
    std::fs::write(path, bytes).unwrap();
    assert_eq!(
        call(&app, "/synapses/positions", Some(body.clone()), "second").await,
        original
    );
    assert_eq!(
        call(&app, "/synapses/positions", Some(body.clone()), "denied")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        state.connectomes.clear_caches(
            &webknossos_datastore::models::DataSourceId::new("ds", "org"),
            Some("other")
        ),
        0
    );
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
    assert_eq!(
        call(&app, "/synapses/positions", Some(body), "second").await,
        (StatusCode::OK, json!([[999, 1, 2]]))
    );
    let group = root.join("zarr3/zarr.json");
    let mut meta: Value = serde_json::from_slice(&std::fs::read(&group).unwrap()).unwrap();
    meta["attributes"]["voxelytics"]["artifact_attributes"]["mapping_name"] = json!("changed");
    std::fs::write(group, serde_json::to_vec(&meta).unwrap()).unwrap();
    state.connectomes.clear_caches(
        &webknossos_datastore::models::DataSourceId::new("ds", "org"),
        None,
    );
    assert_eq!(
        call(&app, "", None, "second").await.1[2]["mappingName"],
        "changed"
    );
}
#[tokio::test]
async fn current_token_reaches_new_remote_chunks_after_array_metadata_cache_hits() {
    use axum::{
        extract::OriginalUri,
        http::{HeaderMap, header},
        response::IntoResponse,
    };
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
                        .and_then(|h| h.to_str().ok())
                        .map(str::to_owned),
                ));
                let bytes = if path == "zarr3/synapse_positions/zarr.json" {
                    let mut meta: Value =
                        serde_json::from_slice(&std::fs::read(fixtures().join(&path)).unwrap())
                            .unwrap();
                    meta["chunk_grid"]["configuration"]["chunk_shape"] = json!([1, 3]);
                    serde_json::to_vec(&meta).unwrap()
                } else if let Some(chunk) = path.strip_prefix("zarr3/synapse_positions/c/") {
                    let index = chunk.split('/').next().unwrap().parse::<usize>().unwrap();
                    let bytes =
                        std::fs::read(fixtures().join("zarr3/synapse_positions/c/0/0")).unwrap();
                    bytes[index * 24..(index + 1) * 24].to_vec()
                } else {
                    std::fs::read(fixtures().join(&path)).unwrap()
                };
                if let Some(range) = headers.get(header::RANGE) {
                    let (a, b) = range
                        .to_str()
                        .unwrap()
                        .trim_start_matches("bytes=")
                        .split_once('-')
                        .unwrap();
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
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"seg","category":"segmentation","elementClass":"uint8","dataFormat":"zarr","largestSegmentId":7,"boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},"mags":[{"mag":[1,1,1],"path":"/not-read"}],"attachments":{"connectomes":[{"name":"remote","path":format!("{uri}/zarr3"),"dataFormat":"zarr3"}]}}]});
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
    let mut config = wk.config();
    config.http.uri = uri;
    let app = router(AppState::new(config));
    for (id, token) in [(0, "first"), (1, "second")] {
        assert_eq!(
            call(
                &app,
                "/synapses/positions",
                Some(json!({"connectomeFile":"remote","synapseIds":[id]})),
                token
            )
            .await,
            (StatusCode::OK, json!([[id * 3, id * 3 + 1, id * 3 + 2]]))
        );
    }
    let log = reads.lock().unwrap().clone();
    assert_eq!(
        log.iter()
            .filter(|(p, _)| p.ends_with("synapse_positions/zarr.json"))
            .count(),
        1
    );
    assert_eq!(
        log.iter()
            .filter(|(_, t)| t.as_deref() == Some("second"))
            .map(|v| v.0.as_str())
            .collect::<Vec<_>>(),
        ["zarr3/synapse_positions/c/1/0"]
    );
    assert_eq!(
        call(
            &app,
            "/synapses/positions",
            Some(json!({"connectomeFile":"remote","synapseIds":[1]})),
            "denied"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(reads.lock().unwrap().len(), log.len());
    task.abort();
}
