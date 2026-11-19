//! Alignment project uploads (#10073) through the actual router with a mock WK and the fake
//! Redis: reservation (Redis keys of the Scala `AlignmentProjectUploadMetadataStore`), chunks and
//! finish into `.alignmentProjects/<id>` with the tile CSV report, CSV replacement, cancelling
//! when WEBKNOSSOS deletes the project, and `getOneBaseDirForOrgaAbsolute?requireAllowsUpload`.
use crate::common;
use crate::fake_redis;
use crate::mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::send;
use fake_redis::FakeRedis;
use mock_wk::{Call, MockWk, Reply};
use serde_json::{Value, json};
use std::{
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use webknossos_datastore::{AppState, config::BaseDirectory, router};

const PROJECT: &str = "0123456789abcdef01234567";
const BOUNDARY: &str = "wkboundary";
const CSV: &[u8] = b"section,x,y,path\n3,0,0,./tiles/a.tif\n4,0.5,1,./tiles/b.tif\n";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-alignment-upload-{}-{}",
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
    /// Answer of `validateAlignmentProjectCsvReplacement`.
    replacement: Arc<Mutex<(StatusCode, Value)>>,
}

async fn fixture() -> Fixture {
    let base = temp();
    // Not allowing uploads: alignment projects go to the first upload-enabled base directory.
    let other = temp();
    let redis = FakeRedis::start().await;
    let replacement = Arc::new(Mutex::new((
        StatusCode::OK,
        json!({"organizationId":"org"}),
    )));
    let answer = Arc::clone(&replacement);
    let wk = MockWk::start(move |call: &Call| {
        let path = call.path.as_str();
        if path.ends_with("/validateUserAccess") {
            let granted = call.query_value("token").as_deref() == Some("good");
            Reply::json(StatusCode::OK, json!({"granted":granted}))
        } else if path.ends_with("/reserveAlignmentProjectUpload") {
            Reply::json(StatusCode::OK, json!({"newAlignmentProjectId":PROJECT}))
        } else if path.ends_with("/validateAlignmentProjectCsvReplacement") {
            let (status, body) = answer.lock().unwrap().clone();
            Reply::json(status, body)
        } else if path.ends_with("/reportAlignmentProjectUpload")
            || path.ends_with("/updateAlignmentProjectCsv")
        {
            Reply::json(StatusCode::OK, json!({}))
        } else {
            panic!("unexpected WK call {path}");
        }
    })
    .await;
    let mut config = wk.config();
    config.base_directories = vec![
        BaseDirectory {
            path: other.to_str().unwrap().into(),
            is_remote: false,
            organization_id: None,
            allows_upload: false,
            do_scan: true,
        },
        BaseDirectory {
            path: base.to_str().unwrap().into(),
            is_remote: false,
            organization_id: None,
            allows_upload: true,
            do_scan: true,
        },
    ];
    config.redis.address = "127.0.0.1".into();
    config.redis.port = redis.port;
    Fixture {
        wk,
        redis,
        app: router(AppState::new(config)),
        orga_dir: base.join("org"),
        replacement,
    }
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("x-auth-token", "good");
    let body = match body {
        Some(body) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).unwrap())
        }
        None => Body::empty(),
    };
    let (status, _, body) = send(app.clone(), builder.body(body).unwrap()).await;
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

fn error(body: &Value) -> &str {
    body["messages"][0]["error"].as_str().unwrap()
}

fn multipart_file(name: &str, file_name: &str, data: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(data);
    body.extend(format!("\r\n--{BOUNDARY}--\r\n").bytes());
    body
}

async fn post_multipart(app: &Router, path: &str, body: Vec<u8>) -> (StatusCode, Value) {
    let (status, _, body) = send(
        app.clone(),
        Request::post(path)
            .header("x-auth-token", "good")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

/// Uploads one file as a single chunk.
async fn chunk(app: &Router, file_id: &str, data: &[u8]) {
    let size = data.len().to_string();
    let mut body = Vec::new();
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
    body.extend(multipart_file("file", "blob", data));
    let (status, body) = post_multipart(app, "/data/datasets/upload/alignmentProject", body).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

fn reservation(upload_id: &str, file_count: usize) -> Value {
    json!({"resumableUploadInfo":{"uploadId":upload_id,"totalFileCount":file_count},
        "name":"My project","organizationId":"org","voxelSizeFactor":[4,4,40],
        "voxelSizeUnit":"nanometer"})
}

async fn reserve(f: &Fixture, upload_id: &str, file_count: usize) {
    let (status, body) = request(
        &f.app,
        "POST",
        "/data/datasets/upload/alignmentProject/reserveUpload",
        Some(reservation(upload_id, file_count)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!({"newAlignmentProjectId":PROJECT}));
}

async fn finish(f: &Fixture, upload_id: &str) -> (StatusCode, Value) {
    request(
        &f.app,
        "POST",
        &format!("/data/datasets/upload/alignmentProject/finishUpload?uploadId={upload_id}"),
        None,
    )
    .await
}

fn calls_to(f: &Fixture, rpc: &str) -> Vec<Call> {
    f.wk.calls()
        .into_iter()
        .filter(|c| c.path.ends_with(rpc))
        .collect()
}

fn access_requests(f: &Fixture) -> Vec<Value> {
    calls_to(f, "/validateUserAccess")
        .iter()
        .map(Call::json)
        .collect()
}

fn project_dir(f: &Fixture) -> PathBuf {
    f.orga_dir.join(".alignmentProjects").join(PROJECT)
}

fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    for (name, data) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[tokio::test]
async fn reserves_alignment_project_uploads_in_scala_redis_format() {
    let f = fixture().await;
    reserve(&f, "ap1", 2).await;
    let p = "upload___alignmentProject___ap1___";
    assert_eq!(f.redis.text(&format!("{p}fileCount")).as_deref(), Some("2"));
    assert_eq!(
        f.redis.text(&format!("{p}datasetId")),
        Some(format!("\"{PROJECT}\""))
    );
    assert_eq!(
        f.redis.text(&format!("{p}dataSourceId")),
        Some(format!(r#"{{"name":"{PROJECT}","team":"org"}}"#))
    );
    assert_eq!(
        f.redis.text(&format!("{p}filePaths")).as_deref(),
        Some("[]")
    );
    let reverse = format!("upload___alignmentProject______{PROJECT}___alignmentProjectId");
    assert_eq!(f.redis.text(&reverse).as_deref(), Some("ap1"));
    assert_eq!(f.redis.data.lock().unwrap().ttls[&reverse], 14 * 24 * 3600);
    assert_eq!(
        access_requests(&f),
        [json!({"resourceId":"org","resourceType":"dataset","mode":"administrate"})]
    );
    // WEBKNOSSOS gets the body re-written like Scala's `Json.toJson`, with the user's token.
    let reservations = calls_to(&f, "/reserveAlignmentProjectUpload");
    assert_eq!(
        String::from_utf8(reservations[0].body.clone()).unwrap(),
        r#"{"resumableUploadInfo":{"uploadId":"ap1","totalFileCount":2},"name":"My project","organizationId":"org","voxelSizeFactor":[4,4,40],"voxelSizeUnit":"nanometer"}"#
    );
    assert_eq!(
        reservations[0].query_value("token").as_deref(),
        Some("good")
    );
    assert_eq!(
        reservations[0].query_value("key").as_deref(),
        Some(mock_wk::KEY)
    );

    // A known upload answers its project id without asking WEBKNOSSOS again.
    reserve(&f, "ap1", 2).await;
    assert_eq!(calls_to(&f, "/reserveAlignmentProjectUpload").len(), 1);

    // All fields are required.
    let (status, _) = request(
        &f.app,
        "POST",
        "/data/datasets/upload/alignmentProject/reserveUpload",
        Some(
            json!({"resumableUploadInfo":{"uploadId":"ap2","totalFileCount":1},
            "name":"x","organizationId":"org","voxelSizeFactor":[1,1,1]}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn finishes_uploads_into_the_project_directory_and_reports_the_csv() {
    let f = fixture().await;
    reserve(&f, "ap1", 3).await;
    chunk(&f.app, "ap1/upload/tiles.csv", CSV).await;
    chunk(&f.app, "ap1/upload/tiles/a.tif", b"aa").await;
    chunk(&f.app, "ap1/upload/tiles/b.tif", b"bbb").await;
    // Chunks and finish check write access to the alignment project, not to a dataset.
    let write = json!({"resourceId":PROJECT,"resourceType":"alignmentProject","mode":"write"});
    assert_eq!(access_requests(&f)[1], write);

    let (status, body) = finish(&f, "ap1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!({"alignmentProjectId":PROJECT}));
    assert_eq!(access_requests(&f).last(), Some(&write));

    // The files are moved as they are (no common prefix is removed).
    let dir = project_dir(&f);
    assert_eq!(std::fs::read(dir.join("upload/tiles.csv")).unwrap(), CSV);
    assert_eq!(
        std::fs::read(dir.join("upload/tiles/b.tif")).unwrap(),
        b"bbb"
    );
    assert!(!f.orga_dir.join(".uploading/alignmentProject/ap1").exists());
    assert_eq!(
        f.redis.keys(),
        Vec::<String>::new(),
        "all upload keys removed"
    );

    let reports = calls_to(&f, "/reportAlignmentProjectUpload");
    assert_eq!(reports[0].query_value("token"), None);
    assert_eq!(
        String::from_utf8(reports[0].body.clone()).unwrap(),
        format!(
            r#"{{"alignmentProjectId":"{PROJECT}","csvPath":"upload/tiles.csv","fileCount":3,"totalSizeInBytes":{},"sectionRange":{{"first":3,"last":4}}}}"#,
            CSV.len() + 5
        )
    );

    // Finishing again: the upload is gone.
    let (status, body) = finish(&f, "ap1").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Could not find running alignmentProject upload with upload id “ap1”."
    );
}

#[tokio::test]
async fn unzips_a_single_uploaded_zip_and_reports_invalid_csvs() {
    let f = fixture().await;
    reserve(&f, "ap1", 1).await;
    let archive = zip(&[
        ("data/tiles.csv", b"1,0,0,./a.tif\n3,0,0,./b.tif\n"),
        ("data/a.tif", b"a"),
        ("data/.hidden", b"h"),
    ]);
    chunk(&f.app, "ap1/Data.ZIP", &archive).await;
    let (status, body) = finish(&f, "ap1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let dir = project_dir(&f);
    assert!(dir.join("data/a.tif").is_file(), "common prefix kept");
    assert!(!dir.join("data/.hidden").exists(), "hidden files skipped");
    assert!(!dir.join("Data.ZIP").exists());
    let report = calls_to(&f, "/reportAlignmentProjectUpload")[0].json();
    assert_eq!(
        report,
        json!({"alignmentProjectId":PROJECT,"csvPath":"data/tiles.csv","fileCount":2,
            "totalSizeInBytes":29,
            "invalidReason":"Section numbers are not continuous: section 2 is missing between 1 and 3."})
    );

    // The project directory exists already: a second project upload with the same id fails.
    reserve(&f, "ap2", 1).await;
    chunk(&f.app, "ap2/x.csv", CSV).await;
    let (status, body) = finish(&f, "ap2").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Could not finish the alignment project upload."
    );
    let chain = body["messages"][1]["chain"].as_str().unwrap();
    assert!(
        chain.contains(&format!(
            "Alignment project directory {} already exists.",
            dir.display()
        )),
        "{chain}"
    );
}

#[tokio::test]
async fn reports_missing_and_ambiguous_csvs() {
    let f = fixture().await;
    reserve(&f, "ap1", 2).await;
    chunk(&f.app, "ap1/b.CSV", CSV).await;
    chunk(&f.app, "ap1/sub/a.csv", CSV).await;
    let (status, body) = finish(&f, "ap1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let report = calls_to(&f, "/reportAlignmentProjectUpload")[0].json();
    assert_eq!(report.get("csvPath"), None);
    assert_eq!(report.get("sectionRange"), None);
    assert_eq!(
        report["invalidReason"],
        "Expected exactly one CSV file, found 2: b.CSV, sub/a.csv."
    );
}

#[tokio::test]
async fn reports_projects_without_csv() {
    let f = fixture().await;
    reserve(&f, "ap1", 1).await;
    chunk(&f.app, "ap1/a.tif", b"a").await;
    let (status, _) = finish(&f, "ap1").await;
    assert_eq!(status, StatusCode::OK);
    let report = calls_to(&f, "/reportAlignmentProjectUpload")[0].json();
    assert_eq!(
        report,
        json!({"alignmentProjectId":PROJECT,"fileCount":1,"totalSizeInBytes":1,
            "invalidReason":"No CSV file was found among the uploaded files."})
    );
}

#[tokio::test]
async fn replaces_the_tile_csv_next_to_the_current_one() {
    let f = fixture().await;
    let dir = project_dir(&f);
    std::fs::create_dir_all(dir.join("upload")).unwrap();
    std::fs::write(dir.join("upload/tiles.csv"), b"old").unwrap();
    *f.replacement.lock().unwrap() = (
        StatusCode::OK,
        json!({"organizationId":"org","currentCsvPath":"upload/tiles.csv"}),
    );
    let path =
        format!("/data/datasets/upload/alignmentProject/replaceCsv?alignmentProjectId={PROJECT}");
    let (status, body) =
        post_multipart(&f.app, &path, multipart_file("file", "new tiles.csv", CSV)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!({"csvPath":"upload/tiles.v2.csv","sectionRange":{"first":3,"last":4}})
    );
    assert_eq!(std::fs::read(dir.join("upload/tiles.csv")).unwrap(), b"old");
    assert_eq!(std::fs::read(dir.join("upload/tiles.v2.csv")).unwrap(), CSV);
    let validation = &calls_to(&f, "/validateAlignmentProjectCsvReplacement")[0];
    assert_eq!(validation.method, "POST");
    assert_eq!(
        validation.query_value("alignmentProjectId").as_deref(),
        Some(PROJECT)
    );
    assert_eq!(validation.query_value("token").as_deref(), Some("good"));
    assert!(validation.body.is_empty());
    let update = &calls_to(&f, "/updateAlignmentProjectCsv")[0];
    assert_eq!(update.query_value("token"), None);
    assert_eq!(
        String::from_utf8(update.body.clone()).unwrap(),
        format!(
            r#"{{"alignmentProjectId":"{PROJECT}","csvPath":"upload/tiles.v2.csv","sectionRange":{{"first":3,"last":4}}}}"#
        )
    );

    // Without a current CSV, the new one is named after the uploaded file, in the project root.
    *f.replacement.lock().unwrap() = (StatusCode::OK, json!({"organizationId":"org"}));
    let (status, body) =
        post_multipart(&f.app, &path, multipart_file("file", "my tiles.csv", CSV)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["csvPath"], "my_tiles.csv");

    // Invalid CSVs are rejected before storing or reporting them.
    let (status, body) =
        post_multipart(&f.app, &path, multipart_file("file", "x.csv", b"1,0,0\n")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        "Row 1: expected at least 4 columns (section,x,y,path), found 3."
    );
    assert_eq!(calls_to(&f, "/updateAlignmentProjectCsv").len(), 2);

    // A current CSV outside of the project directory.
    *f.replacement.lock().unwrap() = (
        StatusCode::OK,
        json!({"organizationId":"org","currentCsvPath":"../other/tiles.csv"}),
    );
    let (status, body) = post_multipart(&f.app, &path, multipart_file("file", "x.csv", CSV)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "Invalid path of the current CSV.");

    // WEBKNOSSOS refuses (e.g. the upload is unfinished): its status is kept.
    *f.replacement.lock().unwrap() = (
        StatusCode::BAD_REQUEST,
        json!({"messages":[{"error":"The upload of this alignment project has not finished yet."}]}),
    );
    let (status, _) = post_multipart(&f.app, &path, multipart_file("file", "x.csv", CSV)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(calls_to(&f, "/updateAlignmentProjectCsv").len(), 2);

    // The CSV must be attached as file "file"; WEBKNOSSOS is not asked then.
    let asked = calls_to(&f, "/validateAlignmentProjectCsvReplacement").len();
    let (status, body) = post_multipart(&f.app, &path, multipart_file("other", "x.csv", CSV)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error(&body), "No CSV file was attached.");
    assert_eq!(
        calls_to(&f, "/validateAlignmentProjectCsvReplacement").len(),
        asked
    );

    let (status, _) = post_multipart(
        &f.app,
        "/data/datasets/upload/alignmentProject/replaceCsv?alignmentProjectId=nope",
        multipart_file("file", "x.csv", CSV),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn replacing_the_csv_requires_the_project_directory() {
    let f = fixture().await;
    let path =
        format!("/data/datasets/upload/alignmentProject/replaceCsv?alignmentProjectId={PROJECT}");
    let (status, body) = post_multipart(&f.app, &path, multipart_file("file", "x.csv", CSV)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error(&body),
        format!(
            "Alignment project directory {} does not exist.",
            project_dir(&f).display()
        )
    );
}

#[tokio::test]
async fn cancels_the_upload_when_webknossos_deletes_the_project() {
    let f = fixture().await;
    reserve(&f, "ap1", 2).await;
    chunk(&f.app, "ap1/tiles.csv", CSV).await;
    assert!(f.orga_dir.join(".uploading/alignmentProject/ap1").is_dir());
    let path = format!(
        "/data/datasets/upload/alignmentProject/cancelUploadForProject?alignmentProjectId={PROJECT}"
    );
    let (status, body) = request(&f.app, "DELETE", &path, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!f.orga_dir.join(".uploading/alignmentProject/ap1").exists());
    assert_eq!(f.redis.keys(), Vec::<String>::new());
    assert_eq!(
        access_requests(&f).last(),
        Some(&json!({"resourceType":"webknossos","mode":"administrate"}))
    );

    // Unknown (finished or expired) uploads are ignored.
    let (status, _) = request(&f.app, "DELETE", &path, None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = send(
        f.app.clone(),
        Request::delete(&path)
            .header("x-auth-token", "bad")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = request(
        &f.app,
        "DELETE",
        "/data/datasets/upload/alignmentProject/cancelUploadForProject",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn base_dir_can_require_upload_permission() {
    let f = fixture().await;
    let base_dir = |query: &'static str| {
        let app = f.app.clone();
        async move {
            request(
                &app,
                "GET",
                &format!("/data/datasets/getOneBaseDirForOrgaAbsolute?organizationId=org{query}"),
                None,
            )
            .await
        }
    };
    let (status, first) = base_dir("").await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(first, json!(f.orga_dir.to_str().unwrap()));
    assert_eq!(base_dir("&requireAllowsUpload=false").await.1, first);
    let (status, body) = base_dir("&requireAllowsUpload=true").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!(f.orga_dir.to_str().unwrap()));
    assert_eq!(
        base_dir("&requireAllowsUpload=maybe").await.0,
        StatusCode::BAD_REQUEST
    );
}
