//! Annotation private-link Zarr routes: annotation volume layers are proxied to the tracingstore,
//! other layers are served from the annotation's dataset (mock WK doubles as tracingstore).
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
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use webknossos_datastore::{AppState, router};

const ID: &str = "0123456789abcdef01234567";
const LINK: &str = "private-link-token";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-zarr-private-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn data_source() -> Value {
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
    std::fs::write(p.join("0.0.0"), vec![7u8; 32 * 32 * 32]).unwrap();
    let layer = |name: &str| {
        json!({"name":name,"category":"color","elementClass":"uint8","dataFormat":"zarr",
            "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
            "mags":[{"mag":[1,1,1],"path":p.to_str().unwrap(),"axisOrder":{"x":0,"y":1,"z":2}}]})
    };
    json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],
        "dataLayers":[layer("color"), layer("Volume")]})
}

fn volume_layer() -> Value {
    json!({"name":"Volume","category":"segmentation","elementClass":"uint32","dataFormat":"zarr",
        "largestSegmentId":5,
        "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":"./Volume/1","axisOrder":{"x":1,"y":2,"z":3,"c":0}}]})
}

async fn start(via_private_link: bool) -> (MockWk, Router) {
    let source = data_source();
    let tracingstore: Arc<Mutex<String>> = Arc::default();
    let ts = Arc::clone(&tracingstore);
    let wk = MockWk::start(move |call| {
        let path = call.path.as_str();
        if path.starts_with("/api/annotations/source/") {
            if path.ends_with("/unknown") {
                return Reply::text(StatusCode::NOT_FOUND, "not found");
            }
            Reply::json(
                StatusCode::OK,
                json!({"id":"bbbbbbbbbbbbbbbbbbbbbbbb","datasetDirectoryName":"ds","datasetId":ID,
                    "organizationId":"org","dataStoreUrl":"http://ds",
                    "tracingStoreUrl":ts.lock().unwrap().clone(),
                    "accessViaPrivateLink":via_private_link,
                    "annotationLayers":[
                        {"tracingId":"tr1","typ":"Volume","name":"Volume","stats":{}},
                        {"tracingId":"sk1","typ":"Skeleton","name":"Skeleton","stats":{}}]}),
            )
        } else if path.starts_with("/tracings/volume/") {
            let expected = if via_private_link { LINK } else { "user" };
            assert_eq!(
                call.query_value("token").as_deref(),
                Some(expected),
                "{path}"
            );
            match path {
                "/tracings/volume/zarr/tr1/zarrSource"
                | "/tracings/volume/zarr3/tr1/zarrSource" => {
                    assert_eq!(call.query_value("tracingName").as_deref(), Some("Volume"));
                    Reply::json(StatusCode::OK, volume_layer())
                }
                "/tracings/volume/zarr/tr1/.zgroup" => {
                    Reply::json(StatusCode::OK, json!({"zarr_format":2,"from":"ts"}))
                }
                "/tracings/volume/zarr3/json/tr1" => {
                    Reply::json(StatusCode::OK, json!(["zarr.json", "1"]))
                }
                "/tracings/volume/zarr3/tr1/1/zarr.json" => {
                    Reply::json(StatusCode::OK, json!({"zarr_format":3,"fill_value":0.0}))
                }
                "/tracings/volume/zarr/tr1/1/.zarray" => Reply::json(
                    StatusCode::OK,
                    json!({"zarr_format":2,"shape":[1,32,32,32],"chunks":[1,32,32,32],
                        "dtype":"<u4","order":"F","compressor":null,"filters":null,
                        "fill_value":0,"dimension_separator":"."}),
                ),
                "/tracings/volume/zarr/tr1/1/0.0.0.0" => Reply::text(StatusCode::OK, "cube"),
                other => panic!("unexpected tracingstore call {other}"),
            }
        } else if path.ends_with("/validateUserAccess") {
            panic!("private links must not check dataset access");
        } else {
            Reply::json(StatusCode::OK, source.clone())
        }
    })
    .await;
    *tracingstore.lock().unwrap() = wk.uri();
    let state = AppState::new(wk.config());
    (wk, router(state))
}

async fn get(app: &Router, path: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(
        app.clone(),
        Request::get(path)
            .header("x-auth-token", "user")
            .body(Body::empty())
            .unwrap(),
    )
    .await
}

fn json_of(body: &[u8]) -> Value {
    serde_json::from_slice(body).unwrap()
}

#[tokio::test]
async fn combines_dataset_and_annotation_layers() {
    let (_wk, app) = start(true).await;
    let (status, _, body) = get(&app, &format!("/data/annotations/zarr/{LINK}/")).await;
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(body).unwrap();
    assert!(html.contains(&format!(
        "WEBKNOSSOS Combined datastore and tracingstore directory “{LINK}” folder."
    )));
    let entries: Vec<&str> = html
        .match_indices("<li><a href=\"")
        .map(|(i, m)| {
            let rest = &html[i + m.len()..];
            &rest[..rest.find('"').unwrap()]
        })
        .collect();
    assert_eq!(
        entries,
        ["datasource-properties.json", ".zgroup", "Volume", "color"]
    );

    let (status, _, body) = get(
        &app,
        &format!("/data/annotations/zarr3/{LINK}/datasource-properties.json"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let source = json_of(&body);
    let layers = source["dataLayers"].as_array().unwrap();
    assert_eq!(layers.len(), 2);
    assert_eq!(layers[0]["name"], "color");
    assert_eq!(layers[0]["dataFormat"], "zarr3");
    assert_eq!(layers[1]["name"], "Volume");
    // Play API writes `UnsignedLong` as a bigint envelope.
    assert_eq!(
        layers[1]["largestSegmentId"],
        json!({"customJsonEncoding":"bigint","value":"5"})
    );
    assert_eq!(layers[1]["mags"][0]["path"], "./Volume/1");
}

#[tokio::test]
async fn legacy_private_link_metadata_downgrades_annotation_ids_and_forwards_the_correct_token() {
    for private in [true, false] {
        let (_, app) = start(private).await;
        for version in 10..=16 {
            for format in ["zarr", "zarr3", "zarr3_experimental"] {
                let (status, headers, bytes) = get(
                    &app,
                    &format!(
                        "/data/v{version}/annotations/{format}/{LINK}/datasource-properties.json"
                    ),
                )
                .await;
                assert_eq!(
                    status,
                    StatusCode::OK,
                    "{}",
                    String::from_utf8_lossy(&bytes)
                );
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(
                    body["dataLayers"][1]["largestSegmentId"],
                    if version <= 14 {
                        json!(5)
                    } else {
                        json!({"customJsonEncoding":"bigint","value":"5"})
                    }
                );
                assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
            }
        }
        let (status, _, _) = get(
            &app,
            "/data/v14/annotations/zarr/unknown/datasource-properties.json",
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn proxies_annotation_layers_to_the_tracingstore() {
    let (_wk, app) = start(true).await;
    let base = format!("/data/annotations/zarr/{LINK}");
    let (status, _, body) = get(&app, &format!("{base}/Volume/.zgroup")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&body), json!({"zarr_format":2,"from":"ts"}));
    let (_, _, body) = get(&app, &format!("{base}/.zgroup")).await;
    assert_eq!(json_of(&body), json!({"zarr_format":2}));

    let (status, headers, body) = get(&app, &format!("{base}/Volume/1/0.0.0.0")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"cube");
    assert_eq!(
        header(&headers, "content-type"),
        Some("application/octet-stream")
    );

    let (status, _, body) = get(&app, &format!("{base}/Volume/1/.zarray")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&body)["dtype"], "<u4");

    let base3 = format!("/data/annotations/zarr3_experimental/{LINK}");
    let (status, _, body) = get(&app, &format!("{base3}/Volume/")).await;
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(body).unwrap();
    assert!(html.contains("WEBKNOSSOS Tracingstore “tr1” folder."));
    assert!(html.contains("<a href=\"zarr.json\">"));
    let (_, _, body) = get(&app, &format!("{base3}/Volume/1/zarr.json")).await;
    // Play re-renders whole doubles without a fraction.
    assert_eq!(
        String::from_utf8(body).unwrap(),
        r#"{"zarr_format":3,"fill_value":0}"#
    );
}

#[tokio::test]
async fn serves_dataset_layers_without_dataset_access_checks() {
    let (_wk, app) = start(false).await;
    let base = format!("/data/annotations/zarr/{LINK}");
    let (status, _, body) = get(&app, &format!("{base}/color/1/0.0.0.0")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, vec![7u8; 32 * 32 * 32]);
    let (status, _, body) = get(&app, &format!("{base}/color/1/.zarray")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&body)["dtype"], "|u1");
    // Without private-link access the user's own token goes to the tracingstore.
    let (status, _, _) = get(&app, &format!("{base}/Volume/.zgroup")).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn unknown_links_and_bad_requests_are_not_found() {
    let (_wk, app) = start(true).await;
    let (status, _, _) = get(&app, "/data/annotations/zarr/unknown/.zgroup").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, body) = get(
        &app,
        &format!("/data/annotations/zarr/{LINK}/color/9/.zarray"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        json_of(&body)["messages"][0]["error"],
        "Data layer “color” does not have mag “9”."
    );
}
