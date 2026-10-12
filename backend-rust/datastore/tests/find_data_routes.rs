//! findData and histogram through the actual router with a synthetic Zarr v2 layer.
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
use std::path::PathBuf;
use webknossos_datastore::{AppState, router};

const ID: &str = "0123456789abcdef01234567";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-find-data-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// 64³ uint8 Zarr with 32³ chunks; only chunk 0.0.0 exists, with the given voxels set.
fn layer(voxels: &[([usize; 3], u8)], element_class: &str) -> Value {
    let p = temp();
    std::fs::write(
        p.join(".zarray"),
        serde_json::to_vec(
            &json!({"zarr_format":2,"shape":[64,64,64],"chunks":[32,32,32],
            "dtype":"|u1","order":"F","compressor":null,"fill_value":0}),
        )
        .unwrap(),
    )
    .unwrap();
    let mut chunk = vec![0u8; 32 * 32 * 32];
    for ([x, y, z], v) in voxels {
        chunk[x + 32 * y + 1024 * z] = *v;
    }
    std::fs::write(p.join("0.0.0"), chunk).unwrap();
    json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"color","category":"color","elementClass":element_class,"dataFormat":"zarr",
        "boundingBox":{"topLeft":[0,0,0],"width":64,"height":64,"depth":64},
        "mags":[{"mag":[1,1,1],"path":p.to_str().unwrap(),"axisOrder":{"x":0,"y":1,"z":2}}]}]})
}

async fn app(source: Value) -> (MockWk, Router) {
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            let granted = call.query_value("token").as_deref() == Some("good");
            Reply::json(StatusCode::OK, json!({"granted":granted}))
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    let state = AppState::new(wk.config());
    (wk, router(state))
}

async fn get(app: &Router, path: &str, token: &str) -> (StatusCode, Value) {
    let (status, _, body) = send(
        app.clone(),
        Request::get(path)
            .header("x-auth-token", token)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    // Access denials are plain text.
    let value = serde_json::from_slice(&body)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&body).into_owned()));
    (status, value)
}

#[tokio::test]
async fn find_data_returns_first_non_zero_voxel() {
    let (_wk, app) = app(layer(&[([5, 6, 7], 9), ([20, 0, 0], 1)], "uint8")).await;
    let (status, body) = get(
        &app,
        &format!("/data/datasets/{ID}/layers/color/findData"),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // (32,32,32) is checked first and is empty; within the (0,0,0) bucket x runs fastest.
    assert_eq!(body, json!({"position":[20,0,0],"mag":[1,1,1]}));
}

#[tokio::test]
async fn find_data_without_data_returns_nulls() {
    let (_wk, app) = app(layer(&[], "uint8")).await;
    let (status, body) = get(
        &app,
        &format!("/data/datasets/{ID}/layers/color/findData"),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"position":null,"mag":null}));
}

#[tokio::test]
async fn histogram_counts_non_zero_values() {
    let (_wk, app) = app(layer(
        &[([5, 6, 7], 9), ([1, 1, 1], 9), ([2, 2, 2], 255)],
        "uint8",
    ))
    .await;
    let (status, body) = get(
        &app,
        &format!("/data/datasets/{ID}/layers/color/histogram"),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut counts = vec![0; 256];
    counts[9] = 2;
    counts[255] = 1;
    assert_eq!(body, json!([{"elementCounts":counts,"min":0,"max":255}]));
}

#[tokio::test]
async fn histogram_errors_like_scala() {
    let (wk, uint8_app) = app(layer(&[], "uint8")).await;
    let (status, body) = get(
        &uint8_app,
        &format!("/data/datasets/{ID}/layers/nope/histogram"),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body["messages"][0]["error"],
        "Could not generate histogram data: missing layer “nope”."
    );

    let (status, body) = get(
        &uint8_app,
        &format!("/data/datasets/{ID}/layers/color/histogram"),
        "bad",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, _) = get(
        &uint8_app,
        &format!("/data/datasets/{ID}/layers/color/findData"),
        "bad",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let lookups = wk
        .calls()
        .iter()
        .filter(|c| !c.path.ends_with("/validateUserAccess"))
        .count();
    assert_eq!(lookups, 1, "denied requests must not load the datasource");

    // Double layers fail in Scala's DataConverter.
    let (_wk, double_app) = app(layer(&[], "double")).await;
    let (status, body) = get(
        &double_app,
        &format!("/data/datasets/{ID}/layers/color/histogram"),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Could not generate histogram data for layer “color”."
    );
}
