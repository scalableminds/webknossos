//! finishUpload through the actual router: reserve → chunks → finish, with a mock WK and the fake
//! Redis; checks the on-disk result, clean-up and the report sent to WEBKNOSSOS.
mod common;
mod fake_redis;
mod mock_s3;
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
    fixture_with_s3(None, true).await
}
async fn fixture_with_s3(s3: Option<&mock_s3::MockS3>, credentials: bool) -> Fixture {
    let base = temp();
    let redis = FakeRedis::start().await;
    let wk = MockWk::start(move |call| {
        let path = call.path.as_str();
        if path.ends_with("/validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref() != Some("denied")}),
            )
        } else if path.ends_with("/reserveDatasetUpload") {
            Reply::json(
                StatusCode::OK,
                json!({"newDatasetId":ID,"directoryName":"my_ds"}),
            )
        } else if path.ends_with("/reserveMagUpload") || path.ends_with("/reserveAttachmentUpload")
        {
            Reply::json(
                StatusCode::OK,
                json!({"dataSourceId":{"name":"my_ds","team":"org"}}),
            )
        } else if path.ends_with("/findDatasetId") {
            Reply::json(StatusCode::OK, json!(ID))
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
    if let Some(s3) = s3 {
        let path = format!("s3://{}/bucket/storage", s3.address);
        config.base_directories.push(BaseDirectory {
            path: path.clone(),
            is_remote: true,
            organization_id: None,
            allows_upload: true,
            do_scan: false,
        });
        if credentials {
            config.data_vault_credentials.push(
                webknossos_datastore::config::DataVaultCredential::S3AccessKey {
                    name: path,
                    key_id: "example-key".into(),
                    secret: webknossos_datastore::config::Secret::new("example-secret"),
                },
            );
        }
    }
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
    chunk_at(
        app,
        &format!("/data/datasets/upload/{domain}?token=t"),
        file_id,
        data,
    )
    .await;
}
async fn chunk_at(app: &Router, path: &str, file_id: &str, data: &[u8]) {
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
        Request::post(path)
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

#[tokio::test]
async fn managed_s3_dataset_upload_copies_only_referenced_files_before_report_and_cleans_staging() {
    let s3 = mock_s3::MockS3::start(|_| mock_s3::Reply::ok()).await;
    let f = fixture_with_s3(Some(&s3), true).await;
    reserve_dataset(&f, &["ds.zip"], false).await;
    let archive = zip(&[
        ("ds/datasource-properties.json", PROPERTIES.as_bytes()),
        ("ds/color/1/header.wkw", b"WKW"),
        ("ds/color/1/z0/y0/x0.wkw", b"data"),
        ("ds/notes.txt", b"discard"),
    ]);
    chunk(&f.app, "dataset", "up1/ds.zip", &archive).await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let calls = s3.calls();
    assert_eq!(calls.len(), 2);
    for call in calls {
        assert_eq!(call.method, "PUT");
        assert!(call.path.starts_with("/bucket/storage/org/my_ds/color/1/"));
    }
    let report = report(&f, "/reportDatasetUpload");
    assert_eq!(
        report["dataSourceOpt"]["dataLayers"][0]["mags"][0]["path"],
        format!("s3://{}/bucket/storage/org/my_ds/color/1", s3.address)
    );
    assert!(!f.orga_dir.join("my_ds").exists());
    assert!(
        !f.orga_dir
            .join(".uploading/.unpacked/dataset/up1/my_ds")
            .exists()
    );
    assert!(f.orga_dir.join(".trash/uploadBackup__up1/ds.zip").exists());
}

#[tokio::test]
async fn managed_s3_targets_keep_worker_conversion_local() {
    let s3 = mock_s3::MockS3::start(|_| panic!("conversion must not write S3")).await;
    let f = fixture_with_s3(Some(&s3), false).await;
    reserve_dataset(&f, &["stack/a.tif"], true).await;
    chunk(&f.app, "dataset", "up1/stack/a.tif", b"pixels").await;
    let (status, body) = finish(&f, "dataset", "up1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        std::fs::read(f.orga_dir.join(".forConversion/my_ds/a.tif")).unwrap(),
        b"pixels"
    );
    assert!(s3.calls().is_empty());
    assert!(
        report(&f, "/reportDatasetUpload")
            .get("dataSourceOpt")
            .is_none()
    );
}

#[tokio::test]
async fn denied_managed_s3_finish_has_no_storage_or_reporting_effects() {
    let s3 = mock_s3::MockS3::start(|_| panic!("denied write must not reach storage")).await;
    let f = fixture_with_s3(Some(&s3), true).await;
    reserve_dataset(&f, &["file"], true).await;
    chunk(&f.app, "dataset", "up1/file", b"staged").await;
    let (status, _, _) = send(
        f.app.clone(),
        Request::post("/data/datasets/upload/dataset/finishUpload?uploadId=up1")
            .header("x-auth-token", "denied")
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(s3.calls().is_empty());
    assert!(f.orga_dir.join(".uploading/dataset/up1/file").exists());
    assert!(
        !f.wk
            .calls()
            .iter()
            .any(|c| c.path.ends_with("/reportDatasetUpload"))
    );
}

#[tokio::test]
async fn legacy_reserve_upload_adapts_v10_through_v13_and_discards_conversion() {
    for version in 10..=13 {
        let f = fixture().await;
        let links = if version <= 11 {
            json!([
            {"organizationName":"old_org","dataSetName":"directory","layerName":"a"},
            {"organizationId":"id_org","organizationName":"ignored","dataSetName":ID,"layerName":"b","newLayerName":"renamed"}])
        } else {
            json!([{"datasetId":ID,"layerName":"a"}])
        };
        let (status, body) = post_json(&f.app, &format!("/data/v{version}/datasets/reserveUpload"), json!({"uploadId":"old", "name":"legacy", "organization":"org", "totalFileCount":1, "filePaths":["file"], "initialTeams":[], "layersToLink":links, "needsConversion":true})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let call =
            f.wk.calls()
                .into_iter()
                .find(|c| c.path.ends_with("/reserveDatasetUpload"))
                .unwrap();
        let request = call.json();
        assert_eq!(request["datasetName"], "legacy");
        assert_eq!(request["organizationId"], "org");
        assert_eq!(
            request["resumableUploadInfo"],
            json!({"uploadId":"old","totalFileCount":1,"filePaths":["file"]})
        );
        assert!(request.get("needsConversion").is_none());
        assert!(request.get("voxelSizeFactor").is_none());
        assert_eq!(
            request["layersToLink"][0],
            json!({"datasetId":ID,"layerName":"a"})
        );
        let calls = f.wk.calls();
        let lookups: Vec<_> = calls
            .iter()
            .filter(|c| c.path.ends_with("/findDatasetId"))
            .collect();
        if version <= 11 {
            assert_eq!(lookups.len(), 1);
            assert_eq!(
                lookups[0].query_value("organizationId").as_deref(),
                Some("old_org")
            );
            assert_eq!(
                request["layersToLink"][1],
                json!({"datasetId":ID,"layerName":"b","newLayerName":"renamed"})
            );
        } else {
            assert!(lookups.is_empty());
        }
        assert!(f.redis.keys().iter().any(|k| k.contains("old")));
    }
}

#[tokio::test]
async fn legacy_manual_reservation_validates_and_never_creates_upload_metadata() {
    let f = fixture().await;
    let (status, body) = post_json(
        &f.app,
        "/data/v10/datasets/reserveManualUpload",
        json!({"datasetName":"manual", "organization":"org", "initialTeamIds":[]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!({"newDatasetId":ID, "directoryName":"my_ds"}));
    let request = report(&f, "/reserveDatasetUpload");
    assert_eq!(
        request["resumableUploadInfo"],
        json!({"uploadId":"aManualUpload","totalFileCount":0,"filePaths":[]})
    );
    assert_eq!(request["requireUniqueName"], false);
    assert_eq!(request["isVirtual"], false);
    assert!(f.redis.keys().is_empty());
    let before = f.wk.calls().len();
    let (status, body) = post_json(
        &f.app,
        "/data/v13/datasets/reserveUpload",
        json!({"uploadId":"bad"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.get("obj.name").is_some());
    assert!(body.get("obj.initialTeams").is_some());
    assert_eq!(f.wk.calls().len(), before);
}

#[tokio::test]
async fn legacy_upload_dtos_match_compiled_scala_defaults_options_and_validation_errors() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/legacy/scala_upload_dtos.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let f = fixture().await;
        let path = match case["kind"].as_str().unwrap() {
            "v11" => "/data/v11/datasets/reserveUpload",
            "v13" => "/data/v13/datasets/reserveUpload",
            "manual" => "/data/v10/datasets/reserveManualUpload",
            "finish" => "/data/v13/datasets/finishUpload",
            _ => unreachable!(),
        };
        let (status, body) = post_json(&f.app, path, case["input"].clone()).await;
        if let Some(error) = case.get("error") {
            assert_eq!(status, StatusCode::BAD_REQUEST, "{}", case["name"]);
            assert_eq!(&body, error, "{}", case["name"]);
            assert!(f.wk.calls().is_empty());
        } else if case["kind"] != "finish" {
            assert_eq!(status, StatusCode::OK, "{}: {body}", case["name"]);
            assert_eq!(
                report(&f, "/reserveDatasetUpload"),
                case["adapted"],
                "{}",
                case["name"]
            );
        } else {
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(
                body.to_string()
                    .contains("Could not find running dataset upload with upload id")
            );
        }
    }
}

#[tokio::test]
async fn legacy_chunk_endpoints_and_finish_body_preserve_old_response_fields() {
    for version in 10..=13 {
        let f = fixture().await;
        reserve_dataset(&f, &["a.tif"], true).await;
        for prefix in [
            format!("/data/v{version}/datasets"),
            "/data/datasets".into(),
        ] {
            chunk_at(&f.app, &format!("{prefix}?token=t"), "up1/a.tif", b"pixels").await;
            let (status, _, _) = send(
                f.app.clone(),
                Request::get(format!(
                    "{prefix}?resumableChunkNumber=1&resumableIdentifier=up1%2Fa.tif"
                ))
                .header("x-auth-token", "t")
                .body(Body::empty())
                .unwrap(),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
        }
        let (status, body) = post_json(
            &f.app,
            &format!("/data/v{version}/datasets/finishUpload?uploadId=ignored"),
            json!({"uploadId":"up1","needsConversion":false}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body, json!({"newDatasetId":ID}));
        assert_eq!(
            std::fs::read(f.orga_dir.join(".forConversion/my_ds/a.tif")).unwrap(),
            b"pixels"
        );
    }
}

#[tokio::test]
async fn denied_legacy_layer_lookup_and_manual_reservation_have_no_rpc_effects() {
    let f = fixture().await;
    for (path, body) in [
        (
            "/data/v11/datasets/reserveUpload",
            json!({"uploadId":"old","name":"old","organization":"org","totalFileCount":0,"initialTeams":[],"layersToLink":[{"dataSetName":"directory","layerName":"a"}]}),
        ),
        (
            "/data/v10/datasets/reserveManualUpload",
            json!({"datasetName":"manual","organization":"org","initialTeamIds":[]}),
        ),
    ] {
        let (status, _, _) = send(
            f.app.clone(),
            Request::post(path)
                .header("x-auth-token", "denied")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    assert!(
        f.wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
    assert!(f.redis.keys().is_empty());
}

#[tokio::test]
async fn managed_s3_missing_credentials_or_failed_file_never_publish_and_preserve_staged_data() {
    for credentials in [false, true] {
        let s3 = mock_s3::MockS3::start(|_| {
            mock_s3::Reply::xml(
                StatusCode::FORBIDDEN,
                "<Error><Code>AccessDenied</Code><Message>storage-denied</Message></Error>",
            )
        })
        .await;
        let f = fixture_with_s3(Some(&s3), credentials).await;
        reserve_dataset(&f, &["ds.zip"], false).await;
        let archive = zip(&[
            ("ds/datasource-properties.json", PROPERTIES.as_bytes()),
            ("ds/color/1/header.wkw", b"WKW"),
        ]);
        chunk(&f.app, "dataset", "up1/ds.zip", &archive).await;
        let (status, body) = finish(&f, "dataset", "up1").await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(body.to_string().contains(if credentials {
            "storage-denied"
        } else {
            "S3 upload is not properly configured"
        }));
        assert!(
            !f.wk
                .calls()
                .iter()
                .any(|c| c.path.ends_with("/reportDatasetUpload"))
        );
        assert!(
            f.orga_dir
                .join(".uploading/.unpacked/dataset/up1/my_ds/color/1/header.wkw")
                .exists()
        );
        assert_eq!(s3.calls().is_empty(), !credentials);
    }
}

#[tokio::test]
async fn managed_s3_mag_and_attachment_reports_use_generated_remote_paths() {
    let s3 = mock_s3::MockS3::start(|_| mock_s3::Reply::ok()).await;
    let f = fixture_with_s3(Some(&s3), true).await;
    for domain in ["mag", "attachment"] {
        let mut body = json!({"resumableUploadInfo":{"uploadId":domain,"totalFileCount":1},"datasetId":ID,"layerName":"color","overwritePending":false});
        if domain == "mag" {
            body["mag"] = json!({"mag":[2,2,1]});
        } else {
            body["attachmentType"] = json!("mesh");
            body["attachment"] = json!({"name":"my_mesh","path":"old","dataFormat":"hdf5"});
        }
        let (status, response) = post_json(
            &f.app,
            &format!("/data/datasets/upload/{domain}/reserveUpload"),
            body,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{response}");
        chunk(&f.app, domain, &format!("{domain}/file.bin"), b"chunk").await;
        let (status, response) = finish(&f, domain, domain).await;
        assert_eq!(status, StatusCode::OK, "{response}");
        let report = report(
            &f,
            if domain == "mag" {
                "/reportMagUpload"
            } else {
                "/reportAttachmentUpload"
            },
        );
        let path = report[domain]["path"].as_str().unwrap();
        assert!(
            path.starts_with(&format!(
                "s3://{}/bucket/storage/org/my_ds/color/",
                s3.address
            )),
            "{path}"
        );
        assert!(
            path.contains(if domain == "mag" {
                "/2-2-1__"
            } else {
                "/mesh/Some(my_mesh)__"
            }),
            "{path}"
        );
        let key = webknossos_datastore::datavault::s3::object_key_from_upath(
            &webknossos_datastore::models::UPath::parse(path).unwrap(),
        )
        .unwrap();
        assert!(s3.calls().iter().any(|c| {
            percent_encoding::percent_decode_str(&c.path).decode_utf8_lossy()
                == format!("/bucket/{key}/file.bin")
        }));
    }
}
