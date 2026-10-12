//! finishUpload through the actual router: reserve → chunks → finish, with a mock WK and the fake
//! Redis; checks the on-disk result, clean-up and the report sent to WEBKNOSSOS.
mod common;
mod fake_redis;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::send;
use fake_redis::FakeRedis;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::{io::Write, path::PathBuf};
use webknossos_datastore::{AppState, config::BaseDirectory, router};

const ID: &str = "0123456789abcdef01234567";
const BOUNDARY: &str = "wkboundary";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-upload-finish-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p.canonicalize().unwrap()
}

struct Fixture {
    wk: MockWk,
    redis: FakeRedis,
    app: Router,
    orga_dir: PathBuf,
}

async fn fixture() -> Fixture {
    let base = temp();
    let redis = FakeRedis::start().await;
    let wk = MockWk::start(move |call| {
        let path = call.path.as_str();
        if path.ends_with("/validateUserAccess") {
            Reply::json(StatusCode::OK, json!({"granted":true}))
        } else if path.ends_with("/reserveDatasetUpload") {
            Reply::json(
                StatusCode::OK,
                json!({"newDatasetId":ID,"directoryName":"my_ds"}),
            )
        } else if path.ends_with("/reserveMagUpload") {
            Reply::json(
                StatusCode::OK,
                json!({"dataSourceId":{"name":"my_ds","team":"org"}}),
            )
        } else {
            Reply::json(StatusCode::OK, json!({}))
        }
    })
    .await;
    let mut config = wk.config();
    config.base_directories = vec![BaseDirectory {
        path: base.to_str().unwrap().into(),
        is_remote: false,
        organization_id: None,
        allows_upload: true,
        do_scan: true,
    }];
    config.redis.address = "127.0.0.1".into();
    config.redis.port = redis.port;
    Fixture {
        app: router(AppState::new(config)),
        wk,
        redis,
        orga_dir: base.join("org"),
    }
}

async fn post_json(app: &Router, path: &str, body: Value) -> (StatusCode, Value) {
    let (status, _, body) = send(
        app.clone(),
        Request::post(path)
            .header("x-auth-token", "t")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await;
    let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    (status, value)
}

async fn chunk(app: &Router, domain: &str, file_id: &str, data: &[u8]) {
    let mut body = Vec::new();
    let size = data.len().to_string();
    for (name, value) in [
        ("resumableChunkNumber", "1"),
        ("resumableChunkSize", size.as_str()),
        ("resumableCurrentChunkSize", size.as_str()),
        ("resumableTotalChunks", "1"),
        ("resumableIdentifier", file_id),
    ] {
        body.extend(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .bytes(),
        );
    }
    body.extend(
        format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"blob\"\r\n\r\n")
            .bytes(),
    );
    body.extend_from_slice(data);
    body.extend(format!("\r\n--{BOUNDARY}--\r\n").bytes());
    let (status, _, response) = send(
        app.clone(),
        Request::post(format!("/data/datasets/upload/{domain}?token=t"))
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&response)
    );
}

fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

async fn reserve_dataset(f: &Fixture, files: &[&str], needs_conversion: bool) {
    let (status, body) = post_json(
        &f.app,
        "/data/datasets/upload/dataset/reserveUpload",
        json!({"resumableUploadInfo":{"uploadId":"up1","totalFileCount":files.len(),
                "filePaths":files},
            "datasetName":"My DS","organizationId":"org","initialTeamIds":[],
            "needsConversion":needs_conversion}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn finish(f: &Fixture, domain: &str, upload_id: &str) -> (StatusCode, Value) {
    post_json(
        &f.app,
        &format!("/data/datasets/upload/{domain}/finishUpload?uploadId={upload_id}"),
        json!({}),
    )
    .await
}

fn report(f: &Fixture, endpoint: &str) -> Value {
    f.wk.calls()
        .iter()
        .rev()
        .find(|c| c.path.ends_with(endpoint))
        .unwrap_or_else(|| panic!("no {endpoint} call"))
        .json()
}

const PROPERTIES: &str = r#"{"id":{"name":"x","team":"y"},"scale":[1,1,1],"dataLayers":[{
    "name":"color","category":"color","elementClass":"uint8","dataFormat":"wkw",
    "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
    "mags":[{"mag":[1,1,1]}]}]}"#;

#[tokio::test]
async fn finishes_zipped_explored_dataset_uploads() {
    let f = fixture().await;
    reserve_dataset(&f, &["ds.zip"], false).await;
    let archive = zip(&[
        ("wrapper/datasource-properties.json", PROPERTIES.as_bytes()),
        ("wrapper/color/1/header.wkw", b"WKW"),
        ("wrapper/color/1/z0/y0/x0.wkw", b"data"),
        ("wrapper/notes.txt", b"not referenced"),
        ("wrapper/.DS_Store", b"hidden"),
        ("__MACOSX/wrapper/._x", b"mac"),
    ]);
    chunk(&f.app, "dataset", "up1/ds.zip", &archive).await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!({"datasetId": ID}));

    let target = f.orga_dir.join("my_ds");
    assert_eq!(
        std::fs::read(target.join("color/1/z0/y0/x0.wkw")).unwrap(),
        b"data"
    );
    // Scala also deletes the properties file: only data paths count as referenced; WEBKNOSSOS
    // receives the data source in the report instead.
    assert!(!target.join("datasource-properties.json").exists());
    assert!(
        !target.join("notes.txt").exists(),
        "unreferenced files are deleted"
    );
    assert!(
        !target.join(".DS_Store").exists(),
        "hidden files are not unzipped"
    );
    assert!(!f.orga_dir.join(".uploading/dataset/up1").exists());
    assert!(
        f.orga_dir.join(".trash/uploadBackup__up1/ds.zip").exists(),
        "raw upload backed up"
    );
    assert!(!f.redis.keys().iter().any(|k| k.ends_with("___fileCount")));

    let report = report(&f, "/reportDatasetUpload");
    assert_eq!(report["needsConversion"], false);
    assert_eq!(report["layersToLink"], json!([]));
    assert!(report["datasetSizeBytes"].as_u64().unwrap() > 0);
    let layer = &report["dataSourceOpt"]["dataLayers"][0];
    assert_eq!(
        layer["mags"][0]["path"],
        target.join("color/1").to_str().unwrap()
    );
}

#[tokio::test]
async fn explores_uploaded_ngff_datasets() {
    let f = fixture().await;
    reserve_dataset(&f, &["ds.zip"], false).await;
    let zattrs = serde_json::to_vec(&json!({"multiscales":[{"version":"0.4","axes":[
            {"name":"z","type":"space","unit":"nanometer"},
            {"name":"y","type":"space","unit":"nanometer"},
            {"name":"x","type":"space","unit":"nanometer"}],
        "datasets":[{"path":"0","coordinateTransformations":[{"type":"scale","scale":[2,2,2]}]}]}]}))
    .unwrap();
    let zarray = serde_json::to_vec(&json!({"zarr_format":2,"shape":[4,4,4],"chunks":[4,4,4],
        "dtype":"|u1","order":"C","compressor":null,"fill_value":0,"filters":null}))
    .unwrap();
    let archive = zip(&[
        ("img/.zattrs", zattrs.as_slice()),
        ("img/0/.zarray", zarray.as_slice()),
        ("img/0/0.0.0", &[7u8; 64]),
    ]);
    chunk(&f.app, "dataset", "up1/ds.zip", &archive).await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let target = f.orga_dir.join("my_ds");
    // The layer directory was added (`color`) and the mag kept.
    assert_eq!(
        std::fs::read(target.join("color/0/0.0.0")).unwrap(),
        [7u8; 64]
    );
    let report = report(&f, "/reportDatasetUpload");
    let source = &report["dataSourceOpt"];
    assert_eq!(
        source["scale"],
        json!({"factor":[2,2,2],"unit":"nanometer"})
    );
    let layer = &source["dataLayers"][0];
    assert_eq!(layer["name"], "color");
    assert_eq!(layer["dataFormat"], "zarr");
    assert_eq!(
        layer["mags"][0]["path"],
        target.join("color/0").to_str().unwrap()
    );
}

#[tokio::test]
async fn failed_exploration_cleans_up() {
    let f = fixture().await;
    reserve_dataset(&f, &["ds.zip"], false).await;
    // A bare Zarr array (no NGFF metadata) is moved to `color/1`, but Scala's local Zarr
    // exploration lists the dataset directory as mags and fails on `color`.
    let archive = zip(&[("layer/0/.zarray", b"{}"), ("layer/0/0.0.0", b"x")]);
    chunk(&f.app, "dataset", "up1/ds.zip", &archive).await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body["messages"][0]["error"],
        format!("Could not finalize upload for dataset “{ID}”.")
    );
    let chain = body["messages"][1]["chain"].as_str().unwrap();
    assert!(
        chain.contains("Could not explore local data source"),
        "{chain}"
    );
    assert!(
        f.wk.calls()
            .iter()
            .any(|c| c.path.ends_with("/deleteDataset"))
    );
    assert!(
        // Trash next to the unpack directory, as Scala's `moveToTrash(unpackToDir)` does.
        f.orga_dir
            .join(".uploading/.unpacked/dataset/up1/.trash/my_ds")
            .exists(),
        "failed unpacked data moved to trash"
    );
}

#[tokio::test]
async fn refuses_incomplete_uploads() {
    let f = fixture().await;
    reserve_dataset(&f, &["a.bin", "b.bin"], false).await;
    chunk(&f.app, "dataset", "up1/a.bin", b"a").await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        format!("Could not finalize upload for dataset “{ID}”.")
    );
    let chain = body["messages"][1]["chain"].as_str().unwrap();
    assert!(
        chain.contains("Could not verify that all chunks have been uploaded."),
        "{chain}"
    );
    assert!(
        chain.contains("Reserved file count does not match file names length."),
        "{chain}"
    );

    let (status, body) = finish(&f, "dataset", "unknown").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Could not find running dataset upload with upload id “unknown”."
    );
}

#[tokio::test]
async fn moves_datasets_needing_conversion() {
    let f = fixture().await;
    reserve_dataset(&f, &["stack/a.tif", "stack/b.tif"], true).await;
    chunk(&f.app, "dataset", "up1/stack/a.tif", b"a").await;
    chunk(&f.app, "dataset", "up1/stack/b.tif", b"b").await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        std::fs::read(f.orga_dir.join(".forConversion/my_ds/a.tif")).unwrap(),
        b"a"
    );
    let report = report(&f, "/reportDatasetUpload");
    assert_eq!(report["needsConversion"], true);
    assert!(report.get("dataSourceOpt").is_none());
}

#[tokio::test]
async fn finishes_mag_uploads() {
    let f = fixture().await;
    let (status, body) = post_json(
        &f.app,
        "/data/datasets/upload/mag/reserveUpload",
        json!({"resumableUploadInfo":{"uploadId":"m1","totalFileCount":1},
            "datasetId":ID,"layerName":"color","overwritePending":false,
            "mag":{"mag":[2,2,1]}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    chunk(&f.app, "mag", "m1/.zarray", b"{}").await;
    chunk(&f.app, "mag", "m1/0.0.0", b"chunk").await;
    // The second file exceeds the reserved file count of one.
    let (status, _) = finish(&f, "mag", "m1").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, body) = post_json(
        &f.app,
        "/data/datasets/upload/mag/reserveUpload",
        json!({"resumableUploadInfo":{"uploadId":"m2","totalFileCount":1},
            "datasetId":ID,"layerName":"color","overwritePending":false,
            "mag":{"mag":[2,2,1]}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    chunk(&f.app, "mag", "m2/0.0.0", b"chunk").await;
    let (status, body) = finish(&f, "mag", "m2").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let report = report(&f, "/reportMagUpload");
    assert_eq!(report["datasetId"], ID);
    assert_eq!(report["layerName"], "color");
    assert_eq!(report["magSizeBytes"], 5);
    let path = PathBuf::from(report["mag"]["path"].as_str().unwrap());
    assert!(path.starts_with(f.orga_dir.join("my_ds/color")));
    assert!(
        path.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("2-2-1__")
    );
    assert_eq!(std::fs::read(path.join("0.0.0")).unwrap(), b"chunk");
}
