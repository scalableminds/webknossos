//! ZarrStreamingController dataset routes through the actual router (mock WK, synthetic Zarr v2).
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
        "wk-zarr-streaming-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn value(x: usize, y: usize, z: usize) -> u8 {
    (x + 13 * y + 37 * z) as u8
}

/// 64×32×32 uint8 layer: chunk 0.0.0 is valid, chunk 1.0.0 is a corrupt one-byte file.
fn source() -> Value {
    let p = temp();
    std::fs::write(
        p.join(".zarray"),
        serde_json::to_vec(
            &json!({"zarr_format":2,"shape":[64,32,32],"chunks":[32,32,32],
            "dtype":"|u1","order":"F","compressor":null,"fill_value":0}),
        )
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
    json!({"id":{"name":"ds","team":"org"},"scale":{"factor":[11.0,11.0,24.5],"unit":"nanometer"},
        "dataLayers":[{
            "name":"color","category":"color","elementClass":"uint8","dataFormat":"zarr",
            "boundingBox":{"topLeft":[0,0,0],"width":64,"height":32,"depth":32},
            "mags":[{"mag":[1,1,1],"path":p.to_str().unwrap(),"axisOrder":{"x":0,"y":1,"z":2}}],
            "attachments":{"meshes":[{"name":"m","path":"/x/m","dataFormat":"zarr3"}]}}]})
}

async fn app() -> (MockWk, Router) {
    let source = source();
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
    get_as(app, path, "good").await
}

async fn get_as(app: &Router, path: &str, token: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::get(path)
            .header("x-auth-token", token)
            .body(Body::empty())
            .unwrap(),
    )
    .await
}

async fn get_json(app: &Router, path: &str) -> (StatusCode, Value) {
    let (status, _, body) = get(app, path).await;
    (status, serde_json::from_slice(&body).unwrap())
}

fn text(body: &[u8]) -> String {
    String::from_utf8(body.to_vec()).unwrap()
}

#[tokio::test]
async fn serves_directory_listings() {
    let (_wk, app) = app().await;
    let (status, headers, body) = get(&app, &format!("/data/zarr/{ID}/")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        header(&headers, "content-type"),
        Some("text/html; charset=utf-8")
    );
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
    let html = text(&body);
    assert!(html.contains(&format!("WEBKNOSSOS Datastore “{ID}” folder.")));
    for entry in ["datasource-properties.json", ".zgroup", "color"] {
        assert!(html.contains(&format!("<li><a href=\"{entry}\">{entry}</a></li>")));
    }

    let (status, _, body) = get(&app, &format!("/data/zarr3/{ID}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!text(&body).contains(".zgroup"));

    let (_, _, body) = get(&app, &format!("/data/zarr/{ID}/color")).await;
    let html = text(&body);
    for entry in [".zattrs", ".zgroup", "1"] {
        assert!(html.contains(&format!("<a href=\"{entry}\">")), "{entry}");
    }
    let (_, _, body) = get(&app, &format!("/data/zarr3_experimental/{ID}/color/")).await;
    assert!(text(&body).contains("<a href=\"zarr.json\">"));

    let (status, _, body) = get(&app, &format!("/data/zarr/{ID}/color/1-1-1/")).await;
    assert_eq!(status, StatusCode::OK);
    let html = text(&body);
    assert!(html.contains(&format!("“{ID}/color/1-1-1” folder.")));
    assert!(html.contains("<a href=\".zarray\">"));
    let (_, _, body) = get(&app, &format!("/data/zarr3/{ID}/color/1")).await;
    assert!(text(&body).contains("<a href=\"zarr.json\">"));
}

#[tokio::test]
async fn serves_zarr2_metadata() {
    let (_wk, app) = app().await;
    let (status, body) = get_json(&app, &format!("/data/zarr/{ID}/.zgroup")).await;
    assert_eq!((status, body), (StatusCode::OK, json!({"zarr_format":2})));
    let (_, body) = get_json(&app, &format!("/data/zarr/{ID}/color/.zgroup")).await;
    assert_eq!(body, json!({"zarr_format":2}));

    let (status, body) = get_json(&app, &format!("/data/zarr/{ID}/color/.zattrs")).await;
    assert_eq!(status, StatusCode::OK);
    // Play renders whole doubles without a fraction.
    assert_eq!(
        body,
        json!({"multiscales":[{"version":"0.4","name":"color","axes":[
            {"name":"c","type":"channel"},
            {"name":"x","type":"space","unit":"nanometer"},
            {"name":"y","type":"space","unit":"nanometer"},
            {"name":"z","type":"space","unit":"nanometer"}],
            "datasets":[{"path":"1","coordinateTransformations":[
                {"type":"scale","scale":[1,11,11,24.5]}]}]}]})
    );

    let (status, body) = get_json(&app, &format!("/data/zarr/{ID}/color/1/.zarray")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"dtype":"|u1","fill_value":0,"zarr_format":2,"order":"F","chunks":[1,32,32,32],
            "compressor":null,"filters":null,"shape":[1,64,32,32],"dimension_separator":"."})
    );

    let (status, body) =
        get_json(&app, &format!("/data/zarr/{ID}/datasource-properties.json")).await;
    assert_eq!(status, StatusCode::OK);
    let layer = &body["dataLayers"][0];
    assert_eq!(layer["dataFormat"], "zarr");
    assert_eq!(
        layer["mags"],
        json!([{"mag":[1,1,1],"path":"./color/1","axisOrder":{"x":1,"y":2,"z":3,"c":0}}])
    );
    assert!(layer.get("attachments").is_none());
    assert_eq!(body["id"], json!({"name":"ds","team":"org"}));
}

#[tokio::test]
async fn serves_zarr3_metadata() {
    let (_wk, app) = app().await;
    let (status, body) = get_json(&app, &format!("/data/zarr3/{ID}/color/zarr.json")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["zarr_format"], 3);
    assert_eq!(body["node_type"], "group");
    assert_eq!(body["attributes"]["ome"]["version"], "0.5");
    assert_eq!(
        body["attributes"]["ome"]["multiscales"][0]["datasets"][0]["path"],
        "1"
    );

    let (status, body) = get_json(
        &app,
        &format!("/data/zarr3_experimental/{ID}/color/1-1-1/zarr.json"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"zarr_format":3,"node_type":"array","shape":[1,64,32,32],"data_type":"uint8",
            "chunk_grid":{"name":"regular","configuration":{"chunk_shape":[1,32,32,32]}},
            "chunk_key_encoding":{"name":"v2","configuration":{"separator":"."}},
            "fill_value":0,"attributes":{},
            "codecs":[{"name":"transpose","configuration":{"order":[3,2,1,0]}},
                {"name":"bytes","configuration":{"endian":"little"}}],
            "dimension_names":["c","x","y","z"]})
    );

    let (_, body) = get_json(
        &app,
        &format!("/data/zarr3/{ID}/datasource-properties.json"),
    )
    .await;
    assert_eq!(body["dataLayers"][0]["dataFormat"], "zarr3");
}

#[tokio::test]
async fn streams_raw_cubes() {
    let (_wk, app) = app().await;
    let (status, headers, body) = get(&app, &format!("/data/zarr/{ID}/color/1/0.0.0.0")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        header(&headers, "content-type"),
        Some("application/octet-stream")
    );
    let mut expected = Vec::new();
    for z in 0..32 {
        for y in 0..32 {
            for x in 0..32 {
                expected.push(value(x, y, z));
            }
        }
    }
    assert_eq!(body, expected);
    let (status, _, body) = get(&app, &format!("/data/zarr3/{ID}/color/1-1-1/0.0.0.0")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, expected);

    // Corrupt chunk: Scala answers 500 with the streaming error.
    let (status, _, body) = get(&app, &format!("/data/zarr/{ID}/color/1/0.1.0.0")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["messages"][0]["error"],
        "Failed to load zarr chunk for streaming."
    );
}

#[tokio::test]
async fn errors_default_to_not_found() {
    let (wk, app) = app().await;
    for (path, message) in [
        (
            format!("/data/zarr/{ID}/color/1/1.0.0.0"),
            "Invalid chunk coordinates 1.0.0.0. Expected dot-separated coordinates like “c.<additional_axes.>x.y.z”.",
        ),
        (
            format!("/data/zarr/{ID}/color/1/0.0.0"),
            "Invalid chunk coordinates 0.0.0. Expected dot-separated coordinates like “c.<additional_axes.>x.y.z”.",
        ),
        (
            format!("/data/zarr/{ID}/color/x/.zarray"),
            "Invalid mag “x”. Please use “x-y-z”.",
        ),
        (
            format!("/data/zarr/{ID}/color/2/.zarray"),
            "Data layer “color” does not have mag “2”.",
        ),
        (
            format!("/data/zarr3/{ID}/color/2/0.0.0.0"),
            "Data layer “color” does not have mag “2”.",
        ),
        (
            format!("/data/zarr/{ID}/nope/.zattrs"),
            "Data source not found on data store server. It may still be initializing.",
        ),
    ] {
        let (status, _, body) = get(&app, &path).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["messages"][0]["error"], message, "{path}");
    }

    // Play's route binder rejects non-ObjectId ids before the controller default applies.
    let (status, _, body) = get(&app, "/data/zarr/not-an-id/.zgroup").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["messages"][0]["error"],
        "Cannot parse URI path parameter datasetId with value “not-an-id” as ObjectId."
    );

    // Raw cubes of a missing layer: 503 (Scala `~> SERVICE_UNAVAILABLE`).
    let (status, _, _) = get(&app, &format!("/data/zarr/{ID}/nope/1/0.0.0.0")).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let before = wk.calls().len();
    let (status, _, _) = get_as(&app, &format!("/data/zarr/{ID}/color/1/0.0.0.0"), "bad").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = get_as(&app, &format!("/data/zarr/{ID}/.zgroup"), "bad").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        wk.calls()[before..]
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
}
