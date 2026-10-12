//! UploadController reservation/chunk/cancel routes through the actual router, with a mock WK
//! and an in-process fake Redis (keys and values checked against the Scala formats).
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
use std::path::PathBuf;
use webknossos_datastore::{AppState, config::BaseDirectory, router};

const ID: &str = "0123456789abcdef01234567";
const BOUNDARY: &str = "wkboundary";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-upload-routes-{}-{}",
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
            let granted = call.query_value("token").as_deref() == Some("good");
            Reply::json(StatusCode::OK, json!({"granted":granted}))
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
        } else if path.ends_with("/getUnfinishedDatasetUploadsForUser") {
            Reply::json(
                StatusCode::OK,
                json!([
                    {"uploadId":"","dataSourceId":{"name":"my_ds","team":"org"},"datasetName":"x",
                     "folderId":"f","created":1,"allowedTeams":[]},
                    {"uploadId":"","dataSourceId":{"name":"gone","team":"org"},"datasetName":"y",
                     "folderId":"f","created":1,"allowedTeams":[]}
                ]),
            )
        } else if path.ends_with("/deleteDataset") {
            Reply::json(StatusCode::OK, json!({}))
        } else {
            panic!("unexpected WK call {path}");
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
    let state = AppState::new(config);
    Fixture {
        wk,
        redis,
        app: router(state),
        orga_dir: base.join("org"),
    }
}

async fn post_json(app: &Router, path: &str, body: Value) -> (StatusCode, Vec<u8>) {
    let (status, _, body) = send(
        app.clone(),
        Request::post(path)
            .header("x-auth-token", "good")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await;
    (status, body)
}

async fn request(app: &Router, method: &str, path: &str) -> (StatusCode, Vec<u8>) {
    let (status, _, body) = send(
        app.clone(),
        Request::builder()
            .method(method)
            .uri(path)
            .header("x-auth-token", "good")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    (status, body)
}

fn multipart(fields: &[(&str, &str)], file: Option<&[u8]>) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .bytes(),
        );
    }
    if let Some(file) = file {
        body.extend(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"blob\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .bytes(),
        );
        body.extend_from_slice(file);
        body.extend(b"\r\n");
    }
    body.extend(format!("--{BOUNDARY}--\r\n").bytes());
    body
}

async fn upload_chunk(
    app: &Router,
    domain: &str,
    file_id: &str,
    number: i64,
    chunk_size: i64,
    data: &[u8],
) -> (StatusCode, Vec<u8>) {
    upload_chunk_declaring(app, domain, file_id, number, chunk_size, data.len(), data).await
}

async fn upload_chunk_declaring(
    app: &Router,
    domain: &str,
    file_id: &str,
    number: i64,
    chunk_size: i64,
    current_chunk_size: usize,
    data: &[u8],
) -> (StatusCode, Vec<u8>) {
    let number = number.to_string();
    let size = chunk_size.to_string();
    let current = current_chunk_size.to_string();
    let body = multipart(
        &[
            ("resumableChunkNumber", &number),
            ("resumableChunkSize", &size),
            ("resumableCurrentChunkSize", &current),
            ("resumableTotalChunks", "2"),
            ("resumableIdentifier", file_id),
        ],
        Some(data),
    );
    let (status, _, body) = send(
        app.clone(),
        Request::post(format!("/data/datasets/upload/{domain}?token=good"))
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    (status, body)
}

fn error(body: &[u8]) -> Value {
    serde_json::from_slice::<Value>(body).unwrap()["messages"][0]["error"].clone()
}

fn dataset_reservation() -> Value {
    json!({"resumableUploadInfo":{"uploadId":"up1","totalFileCount":1,"filePaths":["a/b.bin"],
            "totalFileSizeInBytes":100},
        "datasetName":"My DS","organizationId":"org","initialTeamIds":[],
        "layersToLink":[{"datasetId":ID,"layerName":"color"}],
        "voxelSizeFactor":[4,4,40]})
}

#[tokio::test]
async fn reserves_dataset_uploads_in_scala_redis_format() {
    let f = fixture().await;
    let (status, body) = post_json(
        &f.app,
        "/data/datasets/upload/dataset/reserveUpload",
        dataset_reservation(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let p = "upload___dataset___up1___";
    assert_eq!(f.redis.text(&format!("{p}fileCount")).as_deref(), Some("1"));
    assert_eq!(
        f.redis.text(&format!("{p}totalFileSizeInBytes")).as_deref(),
        Some("100")
    );
    assert_eq!(
        f.redis.text(&format!("{p}datasetId")),
        Some(format!("\"{ID}\""))
    );
    assert_eq!(
        f.redis.text(&format!("{p}dataSourceId")).as_deref(),
        Some(r#"{"name":"my_ds","team":"org"}"#)
    );
    assert_eq!(
        f.redis.text(&format!("{p}filePaths")).as_deref(),
        Some(r#"["a/b.bin"]"#)
    );
    assert_eq!(
        f.redis.text(&format!("{p}linkedLayerIdentifier")),
        Some(format!(r#"[{{"datasetId":"{ID}","layerName":"color"}}]"#))
    );
    assert_eq!(
        f.redis.text(&format!("{p}needsConversion")).as_deref(),
        Some("false")
    );
    assert_eq!(
        f.redis.text(&format!("{p}voxelSize")).as_deref(),
        Some(r#"{"factor":[4,4,40],"unit":"nanometer"}"#)
    );
    assert_eq!(
        f.redis
            .text(r#"upload___dataset______{"name":"my_ds","team":"org"}___datasourceId"#)
            .as_deref(),
        Some("\"up1\"")
    );
    assert_eq!(
        f.redis.data.lock().unwrap().ttls[&format!("{p}fileCount")],
        14 * 24 * 3600
    );
    assert!(f.orga_dir.is_dir(), "organization directory created");

    // Re-reserving a known upload does not ask WEBKNOSSOS again.
    let reservations = || {
        f.wk.calls()
            .iter()
            .filter(|c| c.path.ends_with("/reserveDatasetUpload"))
            .count()
    };
    assert_eq!(reservations(), 1);
    let (status, _) = post_json(
        &f.app,
        "/data/datasets/upload/dataset/reserveUpload",
        dataset_reservation(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reservations(), 1);

    let (status, _) = post_json(
        &f.app,
        "/data/datasets/upload/dataset/reserveUpload",
        json!({"datasetName":"x"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn receives_resumable_chunks() {
    let f = fixture().await;
    post_json(
        &f.app,
        "/data/datasets/upload/dataset/reserveUpload",
        dataset_reservation(),
    )
    .await;
    let test = |n: i64| {
        format!(
            "/data/datasets/upload/dataset?resumableChunkNumber={n}&resumableIdentifier=up1/a/b.bin"
        )
    };
    assert_eq!(
        request(&f.app, "GET", &test(2)).await.0,
        StatusCode::NO_CONTENT
    );

    // Chunks arrive out of order; each is written at (n - 1) * chunkSize.
    let (status, body) = upload_chunk(&f.app, "dataset", "up1/a/b.bin", 2, 4, b"5678").await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let (status, _) = upload_chunk(&f.app, "dataset", "up1/a/b.bin", 1, 4, b"1234").await;
    assert_eq!(status, StatusCode::OK);
    let file = f.orga_dir.join(".uploading/dataset/up1/a/b.bin");
    assert_eq!(std::fs::read(&file).unwrap(), b"12345678");
    assert_eq!(request(&f.app, "GET", &test(2)).await.0, StatusCode::OK);
    let set = f
        .redis
        .set("upload___dataset___up1___file___a/b.bin___chunkSet")
        .unwrap();
    assert_eq!(set.into_iter().collect::<Vec<_>>(), ["1", "2"]);
    assert_eq!(
        f.redis
            .text("upload___dataset___up1___file___a/b.bin___chunkCount")
            .as_deref(),
        Some("2")
    );

    // Repeated chunks are not rewritten.
    upload_chunk(&f.app, "dataset", "up1/a/b.bin", 1, 4, b"XXXX").await;
    assert_eq!(std::fs::read(&file).unwrap(), b"12345678");

    let (status, body) = upload_chunk(&f.app, "dataset", "up1/../../escape", 1, 4, b"x").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "Invalid file path: ../../escape");

    let (status, body) = upload_chunk(&f.app, "dataset", "other/x", 1, 4, b"x").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Could not find running dataset upload with upload id “other”."
    );

    let (status, body) =
        upload_chunk_declaring(&f.app, "dataset", "up1/a/c.bin", 1, 4, 4, b"too long").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        error(&body)
            .as_str()
            .unwrap()
            .starts_with("Error receiving chunk 1 for upload up1 for dataset")
    );
    assert!(
        !f.redis
            .set("upload___dataset___up1___file___a/c.bin___chunkSet")
            .unwrap()
            .contains("1"),
        "failed chunks are removed from the chunk set"
    );

    let (status, _, body) = send(
        f.app.clone(),
        Request::post("/data/datasets/upload/dataset?token=good")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(multipart(
                &[("resumableChunkNumber", "x")],
                None,
            )))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "error.number");

    let (status, _) = request(
        &f.app,
        "GET",
        "/data/datasets/upload/nonsense?resumableChunkNumber=1&resumableIdentifier=up1/x",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn reserves_mag_uploads() {
    let f = fixture().await;
    let (status, body) = post_json(
        &f.app,
        "/data/datasets/upload/mag/reserveUpload",
        json!({"resumableUploadInfo":{"uploadId":"m1","totalFileCount":1},
            "datasetId":ID,"layerName":"color","overwritePending":false,
            "mag":{"mag":[2,2,1],"credentialId":"secret"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(
        f.redis.text("upload___mag___m1___mag").as_deref(),
        Some(r#"{"mag":[2,2,1]}"#)
    );
    assert_eq!(
        f.redis.text("upload___mag___m1___layerName").as_deref(),
        Some("color")
    );
    assert_eq!(
        f.redis.text("upload___mag___m1___filePaths").as_deref(),
        Some("[]")
    );
    let (status, _) = upload_chunk(&f.app, "mag", "m1/0.0.0", 1, 8, b"chunk").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read(f.orga_dir.join(".uploading/mag/m1/0.0.0")).unwrap(),
        b"chunk"
    );
}

#[tokio::test]
async fn cancels_uploads_and_lists_unfinished() {
    let f = fixture().await;
    post_json(
        &f.app,
        "/data/datasets/upload/dataset/reserveUpload",
        dataset_reservation(),
    )
    .await;
    upload_chunk(&f.app, "dataset", "up1/a/b.bin", 1, 4, b"1234").await;

    // Scala stores the upload id JSON-encoded but reads it raw, so enrichment never finds the
    // file paths and the list stays empty (kept for parity).
    for path in [
        "/data/datasets/upload/dataset/unfinishedUploads?organizationName=org",
        "/data/v10/datasets/unfinishedUploads?organizationName=org",
        "/data/v11/datasets/unfinishedUploads?organizationName=org",
        "/data/v12/datasets/unfinishedUploads?organizationName=org",
        "/data/v13/datasets/unfinishedUploads?organizationName=org",
    ] {
        let (status, body) = request(&f.app, "GET", path).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), json!([]));
    }
    let (status, _) = request(
        &f.app,
        "GET",
        "/data/datasets/upload/mag/unfinishedUploads?organizationName=org",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, body) = request(
        &f.app,
        "POST",
        "/data/datasets/upload/dataset/cancelUpload?uploadId=up1",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert!(
        f.wk.calls()
            .iter()
            .any(|c| c.path.ends_with("/deleteDataset"))
    );
    assert!(!f.orga_dir.join(".uploading/dataset/up1").exists());
    // Scala's dataset clean-up does not delete the voxel size key; it expires after 14 days.
    assert_eq!(f.redis.keys(), ["upload___dataset___up1___voxelSize"]);

    let (status, body) = request(
        &f.app,
        "POST",
        "/data/datasets/upload/dataset/cancelUpload?uploadId=up1",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Could not find running dataset upload with upload id “up1”."
    );
}

#[tokio::test]
async fn cleans_up_conversion_files() {
    let f = fixture().await;
    std::fs::create_dir_all(f.orga_dir.join(".forConversion/ds")).unwrap();
    let (status, _) = request(
        &f.app,
        "DELETE",
        "/data/datasets/upload/dataset/cleanUpUploadFiles?organizationId=org&directoryName=ds&jobId=j",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // `deleteTemporaryFilesAfterUpload` is off by default: nothing is deleted.
    assert!(f.orga_dir.join(".forConversion/ds").exists());
}

#[tokio::test]
async fn redis_store_against_real_redis_server() {
    let Ok(binary) = which("redis-server") else {
        eprintln!("redis-server not installed; skipping the real Redis smoke test");
        return;
    };
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut child = std::process::Command::new(binary)
        .args([
            "--port",
            &port.to_string(),
            "--save",
            "",
            "--appendonly",
            "no",
        ])
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let store = webknossos_datastore::redis_store::RedisStore::new(
        &webknossos_datastore::config::RedisConfig {
            address: "127.0.0.1".into(),
            port,
        },
    );
    let mut ready = false;
    for _ in 0..50 {
        if store.contains("probe").await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let result = async {
        assert!(ready, "redis-server did not start");
        store
            .insert("k", "v", Some(std::time::Duration::from_secs(100)))
            .await
            .unwrap();
        assert_eq!(store.find("k").await.unwrap().as_deref(), Some("v"));
        assert!(store.ttl_seconds("k").await.unwrap() > 90);
        assert!(store.insert_into_set("s", "1", None).await.unwrap());
        assert!(!store.insert_into_set("s", "1", None).await.unwrap());
        assert!(store.is_contained_in_set("s", "1").await.unwrap());
        assert_eq!(store.find_set("s").await.unwrap(), ["1"]);
        assert!(store.remove_from_set("s", "1").await.unwrap());
        store.remove("k").await.unwrap();
        assert_eq!(store.find("k").await.unwrap(), None);
        assert_eq!(store.ttl_seconds("k").await.unwrap(), -2);
        // Wrong type: Redis error replies become wrapped failures.
        store.insert("str", "x", None).await.unwrap();
        let error = store.find_set("str").await.unwrap_err();
        assert_eq!(error.message, "Redis access failure");
    }
    .await;
    child.kill().ok();
    child.wait().ok();
    result
}

fn which(binary: &str) -> Result<PathBuf, ()> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .map(|dir| dir.join(binary))
        .find(|p| p.is_file())
        .ok_or(())
}
