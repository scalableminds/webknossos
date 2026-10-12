//! JSON mapping routes (`mappings`, `mappings/:name`) through the actual router.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{header, send};
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::PathBuf;
use webknossos_datastore::{AppState, config::BaseDirectory, router};

const ID: &str = "0123456789abcdef01234567";

fn temp() -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "wk-mapping-routes-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&p).unwrap();
    p.canonicalize().unwrap()
}

async fn start(root_path_known: bool) -> (MockWk, Router, PathBuf) {
    let base = temp();
    let dataset = base.join("org/ds");
    std::fs::create_dir_all(dataset.join("seg/mappings")).unwrap();
    std::fs::write(
        dataset.join("seg/mappings/agglomerate.json"),
        br#"{"name":"agglomerate","classes":[[1,2]]}"#,
    )
    .unwrap();
    std::fs::write(dataset.join("seg/mappings/other.json"), b"{}").unwrap();
    std::fs::write(dataset.join("seg/mappings/notes.txt"), b"").unwrap();
    let layer = |name: &str, category: &str| {
        json!({"name":name,"category":category,"elementClass":"uint32","dataFormat":"wkw",
            "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
            "mags":[{"mag":[1,1,1],"path":"/unused"}]})
    };
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],
        "dataLayers":[layer("seg","segmentation"), layer("color","color")]});
    let root = if root_path_known {
        dataset.to_str().unwrap().to_owned()
    } else {
        String::new()
    };
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(StatusCode::OK, json!({"granted":true}))
        } else if call.path.ends_with("/findDatasetLocalRootPath") {
            Reply::json(StatusCode::OK, json!(root))
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let mut config = wk.config();
    config.base_directories = vec![BaseDirectory {
        path: base.to_str().unwrap().into(),
        is_remote: false,
        organization_id: None,
        allows_upload: false,
        do_scan: false,
    }];
    let state = AppState::new(config);
    (wk, router(state), base)
}

async fn get(app: &Router, path: &str) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::get(path)
            .header("x-auth-token", "t")
            .body(Body::empty())
            .unwrap(),
    )
    .await
}

fn error(body: &[u8]) -> Value {
    serde_json::from_slice::<Value>(body).unwrap()["messages"][0]["error"].clone()
}

#[tokio::test]
async fn lists_mappings_of_local_datasets() {
    let (_wk, app, _) = start(true).await;
    let base = format!("/data/datasets/{ID}/layers");
    let (status, headers, body) = get(&app, &format!("{base}/seg/mappings")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!(["agglomerate", "other"])
    );
    assert_eq!(header(&headers, "cache-control"), Some("no-cache"));

    let (status, _, body) = get(&app, &format!("{base}/nope/mappings")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "Could not find layer “nope” in dataset.");

    let (_wk, virtual_app, _) = start(false).await;
    let (status, _, body) = get(&virtual_app, &format!("{base}/seg/mappings")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), json!([]));
}

#[tokio::test]
async fn serves_mapping_bytes() {
    let (_wk, app, _) = start(true).await;
    let base = format!("/data/datasets/{ID}/layers");
    let (status, headers, body) = get(&app, &format!("{base}/seg/mappings/agglomerate")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, br#"{"name":"agglomerate","classes":[[1,2]]}"#);
    assert_eq!(
        header(&headers, "content-type"),
        Some("application/octet-stream")
    );

    let (status, _, body) = get(&app, &format!("{base}/seg/mappings/missing")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        error(&body)
            .as_str()
            .unwrap()
            .ends_with("seg/mappings/missing.json (No such file or directory)")
    );

    let (status, _, body) = get(&app, &format!("{base}/color/mappings/agglomerate")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "Could not find layer “color” in dataset.");

    let (status, _, _) = get(&app, &format!("{base}/seg/mappings/..%2F..%2Fx")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
