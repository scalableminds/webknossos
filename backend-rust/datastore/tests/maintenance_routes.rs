//! DataSourceController maintenance routes, ExportsController and DSAiModelController through the
//! actual router with a mock WEBKNOSSOS and temporary base directories.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode},
};
use common::{header, send};
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use webknossos_datastore::{
    AppState,
    config::{BaseDirectory, DataVaultCredential, DatastoreConfig, Secret},
    router,
};

const ID: &str = "0123456789abcdef01234567";
const JOB: &str = "aaaaaaaaaaaaaaaaaaaaaaaa";

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-maintenance-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    // Canonical, so that path comparisons are not confused by /tmp → /private/tmp.
    p.canonicalize().unwrap()
}

struct Fixture {
    wk: MockWk,
    app: Router,
    base: PathBuf,
    data: PathBuf,
}

fn source(data: &Path) -> Value {
    json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[{
        "name":"color","category":"segmentation","elementClass":"uint8","dataFormat":"zarr",
        "largestSegmentId":1,
        "boundingBox":{"topLeft":[0,0,0],"width":8,"height":8,"depth":8},
        "mags":[{"mag":[1,1,1],"path":data.join("mag1").to_str().unwrap()}],
        "attachments":{"meshes":[{"name":"m","path":data.join("m.hdf5").to_str().unwrap(),
            "dataFormat":"hdf5"}]}}]})
}

async fn fixture(mirrors: bool) -> Fixture {
    let root = temp();
    let base = root.join("base");
    let data = root.join("external");
    std::fs::create_dir_all(data.join("mag1")).unwrap();
    std::fs::write(data.join("m.hdf5"), b"h").unwrap();
    std::fs::create_dir_all(base.join("org")).unwrap();
    let returned = source(&data);
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/validateUserAccess") {
            let granted = call.query_value("token").as_deref() == Some("good");
            Reply::json(StatusCode::OK, json!({"granted":granted}))
        } else if call.path.ends_with("/jobExportProperties") {
            Reply::json(
                StatusCode::OK,
                json!({"jobId":JOB,"runId":"run1","organizationId":"org",
                    "exportFileName":"naïve export.zip"}),
            )
        } else {
            Reply::json(StatusCode::OK, returned.clone())
        }
    })
    .await;
    let mut config: DatastoreConfig = wk.config();
    config.base_directories = vec![BaseDirectory {
        path: base.to_str().unwrap().into(),
        is_remote: false,
        organization_id: None,
        allows_upload: true,
        do_scan: true,
    }];
    config.write_virtual_datasets_mirror = mirrors;
    config.data_vault_credentials = vec![DataVaultCredential::S3AccessKey {
        name: "s3://managed/bucket".into(),
        key_id: "a".into(),
        secret: Secret::new("b"),
    }];
    let state = AppState::new(config);
    Fixture {
        wk,
        app: router(state),
        base,
        data,
    }
}

async fn call(
    app: &Router,
    method: Method,
    path: &str,
    body: Option<Value>,
    token: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-auth-token", token);
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).unwrap())
        }
        None => Body::empty(),
    };
    send(app.clone(), request.body(body).unwrap()).await
}

fn json_body(body: &[u8]) -> Value {
    serde_json::from_slice(body).unwrap()
}

#[tokio::test]
async fn base_dir_and_path_validation() {
    let f = fixture(false).await;
    let (status, _, body) = call(
        &f.app,
        Method::GET,
        "/data/datasets/getOneBaseDirForOrgaAbsolute?organizationId=org",
        None,
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json_body(&body),
        json!(f.base.join("org").to_str().unwrap())
    );

    let (status, _, body) = call(
        &f.app,
        Method::POST,
        "/data/datasets/validatePaths",
        Some(json!([
            "relative/x",
            "/elsewhere/x",
            "s3://managed/bucket/x",
            "s3://other/x"
        ])),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json_body(&body),
        json!([
            {"path":"./relative/x","valid":true},
            {"path":"/elsewhere/x","valid":false},
            {"path":"s3://managed/bucket/x","valid":false},
            {"path":"s3://other/x","valid":true}])
    );

    let (status, _, _) = call(
        &f.app,
        Method::POST,
        "/data/datasets/validatePaths",
        Some(json!(["x"])),
        "bad",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn deletes_only_paths_inside_base_directories() {
    let f = fixture(false).await;
    let inside = f.base.join("org/ds2/color");
    std::fs::create_dir_all(&inside).unwrap();
    let (status, _, body) = call(
        &f.app,
        Method::DELETE,
        "/data/datasets/deletePaths",
        Some(json!([
            inside.to_str().unwrap(),
            f.data.to_str().unwrap(),
            "s3://managed/bucket/x",
            "s3://other/y"
        ])),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_body(&body), json!(["s3://managed/bucket/x"]));
    assert!(!inside.exists());
    assert!(f.data.join("mag1").exists(), "outside the base dir");

    // Regular files are refused (Commons IO deleteDirectory), the request fails.
    let file = f.base.join("org/file");
    std::fs::write(&file, b"x").unwrap();
    let (status, _, _) = call(
        &f.app,
        Method::DELETE,
        "/data/datasets/deletePaths",
        Some(json!([file.to_str().unwrap()])),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn measures_used_storage_of_local_paths() {
    let f = fixture(false).await;
    std::fs::write(f.data.join("mag1/chunk"), [0u8; 10]).unwrap();
    let mag = f.data.join("mag1");
    let (status, _, body) = call(
        &f.app,
        Method::POST,
        "/data/datasets/measureUsedStorage/org",
        Some(json!({"paths":[mag.to_str().unwrap(), "relative/x", "s3://other/x"]})),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json_body(&body),
        json!({"reports":[{"path":mag.to_str().unwrap(),"usedStorageBytes":10}]})
    );

    let (status, _, _) = call(
        &f.app,
        Method::POST,
        "/data/datasets/measureUsedStorage/org",
        Some(json!({"nope":[]})),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn delete_on_disk_moves_to_trash() {
    let f = fixture(false).await;
    let dataset = f.base.join("org/ds");
    std::fs::create_dir_all(dataset.join("color")).unwrap();
    let path = format!(
        "/data/datasets/{ID}/deleteOnDisk?rootPath={}",
        dataset.to_str().unwrap()
    );
    let (status, _, _) = call(&f.app, Method::DELETE, &path, None, "good").await;
    assert_eq!(status, StatusCode::OK);
    assert!(!dataset.exists());
    assert!(f.base.join("org/.trash/ds/color").is_dir());

    let (status, _, _) = call(&f.app, Method::DELETE, &path, None, "bad").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn writes_dataset_mirrors_when_enabled() {
    let disabled = fixture(false).await;
    let (status, _, body) = call(
        &disabled.app,
        Method::POST,
        "/data/datasets/writeMirrors?failOnError=true",
        Some(json!([ID])),
        "bad",
    )
    .await;
    // Disabled: answered before the access check.
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_body(&body), json!([]));
    assert!(disabled.wk.calls().is_empty());

    let f = fixture(true).await;
    let (status, _, body) = call(
        &f.app,
        Method::POST,
        "/data/datasets/writeMirrors?failOnError=false",
        Some(json!([ID])),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let mirror = f.base.join("org/.mirror/ds");
    assert_eq!(json_body(&body), json!([[ID, mirror.to_str().unwrap()]]));
    assert_eq!(
        std::fs::read_link(mirror.join("color/1")).unwrap(),
        f.data.join("mag1")
    );
    assert_eq!(
        std::fs::read_link(mirror.join("color/meshes/m.hdf5")).unwrap(),
        f.data.join("m.hdf5")
    );
    let properties: Value =
        serde_json::from_slice(&std::fs::read(mirror.join("datasource-properties.json")).unwrap())
            .unwrap();
    let layer = &properties["dataLayers"][0];
    assert_eq!(layer["mags"][0]["path"], "./color/1");
    assert_eq!(
        layer["attachments"]["meshes"][0]["path"],
        "./color/meshes/m.hdf5"
    );
    let readme = std::fs::read_to_string(mirror.join("readme.txt")).unwrap();
    assert!(readme.contains(&format!("Dataset ID: {ID}")));
    assert!(!f.base.join("org/.mirror/ds.new").exists());

    // Rewriting replaces the existing mirror.
    let (status, _, _) = call(
        &f.app,
        Method::POST,
        "/data/datasets/writeMirrors?failOnError=true",
        Some(json!([ID])),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(mirror.join("color/1").exists());

    let (status, _, _) = call(
        &f.app,
        Method::POST,
        "/data/datasets/writeMirrors?failOnError=true",
        Some(json!(["not-an-id"])),
        "good",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn downloads_job_exports() {
    let f = fixture(false).await;
    let path = format!("/data/exports/{JOB}/download");
    let (status, _, body) = call(&f.app, Method::GET, &path, None, "good").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(&body)["messages"][0]["error"],
        "Exported file not found. The link may be expired."
    );

    let export_dir = f.base.join("org/.export/run1");
    std::fs::create_dir_all(&export_dir).unwrap();
    std::fs::write(export_dir.join("naïve export.zip"), b"PK-data").unwrap();
    let (status, headers, body) = call(&f.app, Method::GET, &path, None, "good").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"PK-data");
    assert_eq!(header(&headers, "content-type"), Some("application/zip"));
    assert_eq!(header(&headers, "content-length"), Some("7"));
    assert_eq!(
        header(&headers, "content-disposition"),
        Some("attachment; filename=\"na?ve export.zip\"; filename*=utf-8''na%C3%AFve%20export.zip")
    );
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));

    let (status, _, _) = call(&f.app, Method::GET, &path, None, "bad").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn reads_ai_model_voxel_size() {
    let f = fixture(false).await;
    let model = f.data.join("model-a");
    std::fs::create_dir_all(model.join("model")).unwrap();
    let path = "/data/aiModels/effectiveVoxelSize";
    let body = json!({"modelPath": model.to_str().unwrap()});

    let (status, _, response) = call(&f.app, Method::POST, path, Some(body.clone()), "good").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(&response)["messages"][0]["error"],
        "Could not read model statistics.json info file."
    );

    std::fs::write(model.join("model/statistics.json"), b"{\"other\":1}").unwrap();
    let (status, _, response) = call(&f.app, Method::POST, path, Some(body.clone()), "good").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(&response)["messages"][0]["error"],
        "Could not parse model statistics.json – is the scale attribute missing?"
    );

    std::fs::write(
        model.join("model/statistics.json"),
        b"{\"scale\":[2.0,2.0,4.5]}",
    )
    .unwrap();
    let (status, headers, response) = call(&f.app, Method::POST, path, Some(body), "good").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json_body(&response),
        json!({"factor":[2,2,4.5],"unit":"nanometer"})
    );
    assert_eq!(header(&headers, "access-control-allow-origin"), None);
}
