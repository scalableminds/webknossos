//! layerThumbnail / datasetThumbnail through the actual router; JPEGs are decoded and compared
//! with tolerance (encoder rounding differs from Java ImageIO).
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use common::{header, send};
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::PathBuf;
use webknossos_datastore::{AppState, router};

const ID: &str = "0123456789abcdef01234567";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-thumbnail-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// A 32³ uint8 Zarr layer whose voxel (x, y, z) holds `value(x, y)`.
fn zarr_layer(name: &str, category: &str, value: impl Fn(usize, usize) -> u8) -> Value {
    let p = temp();
    std::fs::write(
        p.join(".zarray"),
        serde_json::to_vec(
            &json!({"zarr_format":2,"shape":[32,32,32],"chunks":[32,32,32],
            "dtype":"|u1","order":"F","compressor":null,"fill_value":0}),
        )
        .unwrap(),
    )
    .unwrap();
    let mut data = Vec::new();
    for _z in 0..32 {
        for y in 0..32 {
            for x in 0..32 {
                data.push(value(x, y));
            }
        }
    }
    std::fs::write(p.join("0.0.0"), data).unwrap();
    let mut layer = json!({"name":name,"category":category,"elementClass":"uint8","dataFormat":"zarr",
        "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":p.to_str().unwrap(),"axisOrder":{"x":0,"y":1,"z":2}}]});
    if category == "segmentation" {
        layer["largestSegmentId"] = json!(255);
    }
    layer
}

async fn start() -> (MockWk, Router) {
    let source = json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[
        zarr_layer("color", "color", |x, _| if x < 16 { 50 } else { 200 }),
        zarr_layer("seg", "segmentation", |_, y| if y < 16 { 0 } else { 1 }),
    ]});
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

async fn post(app: &Router, path: &str, body: Value) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::post(path)
            .header("x-auth-token", "good")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await
}

/// Decoded RGB pixels.
fn decode(jpeg: &[u8]) -> (usize, usize, Vec<u8>) {
    let mut decoder =
        zune_jpeg::JpegDecoder::new(zune_jpeg::zune_core::bytestream::ZCursor::new(jpeg));
    let pixels = decoder.decode().unwrap();
    let info = decoder.info().unwrap();
    (info.width as usize, info.height as usize, pixels)
}

fn pixel(image: &(usize, usize, Vec<u8>), x: usize, y: usize) -> [u8; 3] {
    let i = (y * image.0 + x) * 3;
    [image.2[i], image.2[i + 1], image.2[i + 2]]
}

fn close(actual: [u8; 3], expected: [u8; 3]) -> bool {
    actual.iter().zip(expected).all(|(a, e)| a.abs_diff(e) <= 4)
}

fn error(body: &[u8]) -> Value {
    serde_json::from_slice::<Value>(body).unwrap()["messages"][0]["error"].clone()
}

#[tokio::test]
async fn renders_standalone_layer_thumbnails() {
    let (_wk, app) = start().await;
    let base = format!("/data/datasets/{ID}/layers");
    let (status, headers, body) = get(
        &app,
        &format!("{base}/color/layerThumbnail?x=0&y=0&z=3&width=32&height=32&mag=1-1-1&intensityMin=0&intensityMax=200&color=%23ff0000"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "content-type"), Some("image/jpeg"));
    let image = decode(&body);
    assert_eq!((image.0, image.1), (32, 32));
    // 50/200*255 = 63.75 → 64 red; 200 → 255 red.
    assert!(
        close(pixel(&image, 4, 4), [64, 0, 0]),
        "{:?}",
        pixel(&image, 4, 4)
    );
    assert!(close(pixel(&image, 28, 4), [255, 0, 0]));

    // Without bounds the histogram extrema are used; for uint8 they are the type range 0..255.
    let (status, _, body) = get(
        &app,
        &format!("{base}/color/layerThumbnail?x=0&y=0&z=0&width=32&height=32&mag=1-1-1"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let image = decode(&body);
    assert!(close(pixel(&image, 4, 4), [50, 50, 50]));
    assert!(close(pixel(&image, 28, 4), [200, 200, 200]));

    let (status, _, body) = get(
        &app,
        &format!("{base}/seg/layerThumbnail?x=0&y=0&z=0&width=32&height=32&mag=1-1-1"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let image = decode(&body);
    // Background gray, segment 1 in the frontend's jet colour (0x0057ff).
    assert!(close(pixel(&image, 4, 4), [0x64, 0x64, 0x64]));
    assert!(
        close(pixel(&image, 4, 28), [0x00, 0x57, 0xff]),
        "{:?}",
        pixel(&image, 4, 28)
    );
}

#[tokio::test]
async fn layer_thumbnail_errors() {
    let (_wk, app) = start().await;
    let base = format!("/data/datasets/{ID}/layers");
    let (status, _, body) = get(
        &app,
        &format!("{base}/color/layerThumbnail?x=0&y=0&z=0&width=0&height=32&mag=1-1-1"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Thumbnail width and height must be between 1 and 3000, got 0×32."
    );
    let (status, _, _) = get(
        &app,
        &format!("{base}/nope/layerThumbnail?x=0&y=0&z=0&width=8&height=8&mag=1-1-1"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = get(
        &app,
        &format!(
            "{base}/seg/layerThumbnail?x=0&y=0&z=0&width=8&height=8&mag=1-1-1&mappingName=agg"
        ),
    )
    .await;
    // A missing agglomerate file fails the read; Scala then renders the zero fallback.
    assert_eq!(status, StatusCode::OK);
    let (status, _, body) = get(
        &app,
        &format!(
            "{base}/color/layerThumbnail?x=0&y=0&z=0&width=8&height=8&mag=1-1-1&intensityMin=low"
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Cannot parse parameter intensityMin as Double: For input string: \"low\""
    );
}

#[tokio::test]
async fn composes_dataset_thumbnails() {
    let (_wk, app) = start().await;
    let path = format!("/data/datasets/{ID}/datasetThumbnail");
    let layer = |name: &str, opacity: f64| {
        json!({"dataLayerName":name,"x":0,"y":0,"z":0,"mag":"1-1-1","width":32,"height":32,
            "intensityMin":0,"intensityMax":200,"opacity":opacity})
    };
    let (status, headers, body) = post(
        &app,
        &path,
        json!({"width":16,"height":16,"blendMode":"Additive",
            "layers":[layer("color", 100.0), layer("seg", 100.0)]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "content-type"), Some("image/jpeg"));
    let image = decode(&body);
    assert_eq!((image.0, image.1), (16, 16));
    // Top half: gray color data only (64 left, 255 right); bottom half: opaque segment colour.
    assert!(
        close(pixel(&image, 2, 2), [64, 64, 64]),
        "{:?}",
        pixel(&image, 2, 2)
    );
    assert!(close(pixel(&image, 13, 2), [255, 255, 255]));
    assert!(
        close(pixel(&image, 2, 13), [0x00, 0x57, 0xff]),
        "{:?}",
        pixel(&image, 2, 13)
    );

    let (status, _, body) = post(
        &app,
        &path,
        json!({"width":16,"height":4000,"blendMode":"Cover","layers":[]}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Thumbnail width and height must be between 1 and 3000, got 16×4000."
    );
    let (status, _, _) = post(&app, &path, json!({"width":16})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
