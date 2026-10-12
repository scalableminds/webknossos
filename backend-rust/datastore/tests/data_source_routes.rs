//! Real source mutation/reload flows against a stateful mock WEBKNOSSOS and local arrays.
mod common;
mod mock_wk;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{header, json as body_json, send};
use mock_wk::{KEY, MockWk, Reply};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use webknossos_datastore::{AppState, models::FILENAME_DATASOURCE_PROPERTIES_JSON, router};
const ID: &str = "0123456789abcdef01234567";

struct Remote {
    source: Value,
    root: String,
    fail_root: bool,
    fail_source: bool,
    fail_update: bool,
    ignore_update: bool,
}
struct Fixture {
    dir: PathBuf,
    wk: MockWk,
    state: AppState,
    app: Router,
    remote: Arc<Mutex<Remote>>,
}
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "wk-source-routes-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}
fn source(path: &Path, absolute: bool) -> Value {
    let layers:Vec<_>=["color","color__extra"].iter().map(|name|json!({
        "name":name,"category":"color","elementClass":"uint8","dataFormat":"zarr",
        "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":if absolute {path.join(name).join("1").to_string_lossy().into_owned()}
            else {format!("{name}/1")},"axisOrder":{"x":0,"y":1,"z":2}}]})).collect();
    json!({"id":{"name":path.file_name().unwrap().to_str().unwrap(),"team":"org"},
        "scale":[1,1,1],"dataLayers":layers})
}
fn properties(dir: &Path, source: &Value) {
    std::fs::write(
        dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON),
        serde_json::to_vec_pretty(source).unwrap(),
    )
    .unwrap();
}
fn chunk(dir: &Path, layer: &str, value: u8) {
    std::fs::write(dir.join(layer).join("1/0.0.0"), vec![value; 32768]).unwrap();
}
impl Fixture {
    async fn new() -> Self {
        let dir = temp();
        properties(&dir, &source(&dir, false));
        for (layer, value) in [("color", 7), ("color__extra", 11)] {
            std::fs::create_dir_all(dir.join(layer).join("1")).unwrap();
            std::fs::write(
                dir.join(layer).join("1/.zarray"),
                serde_json::to_vec(&json!({"zarr_format":2,
                "shape":[32,32,32],"chunks":[32,32,32],"dtype":"|u1","order":"F","compressor":null,
                "fill_value":0}))
                .unwrap(),
            )
            .unwrap();
            chunk(&dir, layer, value);
        }
        let remote = Arc::new(Mutex::new(Remote {
            source: source(&dir, true),
            root: dir.to_str().unwrap().into(),
            fail_root: false,
            fail_source: false,
            fail_update: false,
            ignore_update: false,
        }));
        let service = Arc::clone(&remote);
        let wk = MockWk::start(move |call| {
            assert_eq!(call.query_value("key").as_deref(), Some(KEY));
            if call.path.ends_with("/validateUserAccess") {
                let token = call.query_value("token");
                let granted = token.as_deref() == Some("admin")
                    || (token.as_deref() == Some("reader") && call.json()["mode"] == "read");
                return Reply::json(StatusCode::OK, json!({"granted":granted}));
            }
            let mut remote = service.lock().unwrap();
            if call.path.ends_with("/findDatasetLocalRootPath") {
                assert_eq!(call.query_value("datasetId").as_deref(), Some(ID));
                if remote.fail_root {
                    Reply::text(StatusCode::SERVICE_UNAVAILABLE, "root lookup failed")
                } else {
                    Reply::json(StatusCode::OK, json!(remote.root))
                }
            } else if call.method == "PUT" {
                assert_eq!(
                    call.path,
                    format!("/api/datastores/test-ds/datasources/{ID}")
                );
                assert_eq!(call.query_value("token").as_deref(), Some("admin"));
                if remote.fail_update {
                    Reply::text(StatusCode::SERVICE_UNAVAILABLE, "update failed")
                } else {
                    if !remote.ignore_update {
                        remote.source = call.json();
                    }
                    Reply::text(StatusCode::OK, "")
                }
            } else {
                assert_eq!(
                    call.path,
                    format!("/api/datastores/test-ds/datasources/{ID}")
                );
                if remote.fail_source {
                    Reply::text(StatusCode::SERVICE_UNAVAILABLE, "source unavailable")
                } else {
                    Reply::json(StatusCode::OK, remote.source.clone())
                }
            }
        })
        .await;
        let state = AppState::new(wk.config());
        let app = router(state.clone());
        Self {
            dir,
            wk,
            state,
            app,
            remote,
        }
    }
    async fn call(
        &self,
        method: &str,
        url: &str,
        token: &str,
        body: Option<Value>,
    ) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
        let request = Request::builder()
            .method(method)
            .uri(url)
            .header("x-auth-token", token);
        let request = match body {
            Some(body) => request
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap())),
            None => request.body(Body::empty()),
        }
        .unwrap();
        send(self.app.clone(), request).await
    }
    async fn read(&self, layer: &str) -> Vec<u8> {
        let path = format!("/data/datasets/{ID}/layers/{layer}/data");
        let (status, headers, data) = self
            .call(
                "POST",
                &path,
                "reader",
                Some(json!([{
            "position":[0,0,0],"cubeSize":32,"mag":[1,1,1]}])),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(header(&headers, "failure-bucket-indices"), Some("[]"));
        data
    }
    fn update_url(&self) -> String {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("rootPath", self.dir.to_str().unwrap())
            .finish();
        format!("/data/datasets/{ID}?{query}")
    }
}

#[tokio::test]
async fn metadata_update_uses_validated_backup_writer_and_invalidates_metadata_only() {
    let f = Fixture::new().await;
    assert_eq!(f.read("color").await, vec![7; 32768]);
    let mut data = source(&f.dir, true);
    data["scale"] = json!([2, 3, 4]);
    let (status, headers, body) = f.call("PUT", &f.update_url(), "admin", Some(data)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_empty());
    assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
    assert!(f.state.datasets.is_empty());
    assert_eq!(
        f.state.binary_data.cached_provider_count(),
        1,
        "Scala updateOnDisk clears metadata only"
    );
    let disk: Value = serde_json::from_slice(
        &std::fs::read(f.dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON)).unwrap(),
    )
    .unwrap();
    assert_eq!(disk["scale"]["factor"], json!([2, 3, 4]));
    assert_eq!(disk["dataLayers"][0]["mags"][0]["path"], "./color/1");
    assert!(disk["dataLayers"][0].get("resolutions").is_none());
    let backup = std::fs::read_to_string(f.dir.join("datasource-properties-backups.log")).unwrap();
    assert!(backup.contains("Old content:"));
    assert!(backup.contains("\"scale\": ["));
    assert!(
        f.wk.calls().iter().all(|c| c.method != "PUT"),
        "disk update does not update WK metadata"
    );
    let mut invalid = source(&f.dir, true);
    invalid["scale"] = json!([0, 1, 1]);
    let before = std::fs::read(f.dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON)).unwrap();
    let (status, _, body) = f.call("PUT", &f.update_url(), "admin", Some(invalid)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body_json(&body),
        json!({"messages":[{"error":"Voxel size (scale) is negative in at least one dimension."}]})
    );
    assert_eq!(
        std::fs::read(f.dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON)).unwrap(),
        before
    );
    assert_eq!(
        std::fs::read_to_string(f.dir.join("datasource-properties-backups.log")).unwrap(),
        backup
    );
}

#[tokio::test]
async fn selective_reload_reports_resolved_source_and_only_clears_selected_layer() {
    let f = Fixture::new().await;
    assert_eq!(f.read("color").await, vec![7; 32768]);
    assert_eq!(f.read("color__extra").await, vec![11; 32768]);
    chunk(&f.dir, "color", 17);
    chunk(&f.dir, "color__extra", 21);
    assert_eq!(f.read("color").await, vec![7; 32768]);
    let path = format!("/data/v16/triggers/reload/org/{ID}?layerName=color&layerName=color__extra");
    let (status, _, body) = f.call("POST", &path, "admin", None).await;
    assert_eq!(status, StatusCode::OK);
    let returned = body_json(&body);
    assert_eq!(returned["id"]["team"], "org");
    assert_eq!(
        returned["dataLayers"][0]["mags"][0]["path"],
        f.dir.join("color/1").to_str().unwrap()
    );
    assert_eq!(f.state.binary_data.cached_provider_count(), 1);
    assert_eq!(f.state.chunk_contents_cache.len(), 1);
    assert_eq!(f.state.data_vaults.cached_vault_count(), 1);
    assert_eq!(f.read("color").await, vec![17; 32768]);
    assert_eq!(f.read("color__extra").await, vec![11; 32768]);
    let calls = f.wk.calls();
    let put = calls.iter().find(|c| c.method == "PUT").unwrap();
    assert_eq!(put.json(), returned);
    assert!(put.json()["dataLayers"][0]["attachments"].is_object());
    assert_eq!(put.query_value("token").as_deref(), Some("admin"));
}

#[tokio::test]
async fn delete_cache_route_clears_real_reader_and_vault_caches_without_deleting_files() {
    let f = Fixture::new().await;
    f.read("color").await;
    f.read("color__extra").await;
    chunk(&f.dir, "color", 19);
    chunk(&f.dir, "color__extra", 23);
    let (status, _, body) = f
        .call("DELETE", &format!("/data/datasets/{ID}"), "admin", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_empty());
    assert_eq!(f.state.datasets.len(), 1, "fresh source stays cached");
    assert_eq!(f.state.binary_data.cached_provider_count(), 0);
    assert!(f.state.chunk_contents_cache.is_empty());
    assert_eq!(f.state.data_vaults.cached_vault_count(), 0);
    assert!(f.dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON).exists());
    assert_eq!(f.read("color").await, vec![19; 32768]);
    assert_eq!(f.read("color__extra").await, vec![23; 32768]);
    // Scala's shiftBox/foreach intentionally returns200 even if the source refresh fails.
    f.remote.lock().unwrap().fail_source = true;
    assert_eq!(
        f.call("DELETE", &format!("/data/datasets/{ID}"), "admin", None)
            .await
            .0,
        StatusCode::OK
    );
    assert!(f.state.datasets.is_empty());
}

#[tokio::test]
async fn denied_mutations_and_cross_organization_reload_preserve_files_and_caches() {
    let f = Fixture::new().await;
    f.read("color").await;
    let before = std::fs::read(f.dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON)).unwrap();
    for (method, path, body) in [
        ("PUT", f.update_url(), Some(source(&f.dir, true))),
        ("DELETE", format!("/data/datasets/{ID}"), None),
        ("POST", format!("/data/triggers/reload/org/{ID}"), None),
    ] {
        assert_eq!(
            f.call(method, &path, "reader", body).await.0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(f.state.datasets.len(), 1);
        assert_eq!(f.state.binary_data.cached_provider_count(), 1);
    }
    let (status, _, body) = f
        .call(
            "POST",
            &format!("/data/triggers/reload/other/{ID}"),
            "admin",
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body_json(&body)["messages"][0]["error"],
        "Dataset does not belong to the requested organization."
    );
    assert_eq!(f.state.binary_data.cached_provider_count(), 1);
    assert_eq!(
        std::fs::read(f.dir.join(FILENAME_DATASOURCE_PROPERTIES_JSON)).unwrap(),
        before
    );
    assert!(
        f.wk.calls()
            .iter()
            .all(|c| c.method != "PUT" && !c.path.ends_with("/findDatasetLocalRootPath"))
    );
}

#[tokio::test]
async fn virtual_reload_and_local_fallback_follow_refresh_box_semantics() {
    let f = Fixture::new().await;
    f.remote.lock().unwrap().root = String::new();
    let path = format!("/data/triggers/reload/org/{ID}");
    let (status, _, body) = f.call("POST", &path, "admin", None).await;
    assert_eq!(status, StatusCode::OK);
    let mut expected = source(&f.dir, true);
    expected["scale"] = json!({"factor":[1,1,1],"unit":"nanometer"});
    for layer in expected["dataLayers"].as_array_mut().unwrap() {
        layer["resolutions"] = json!([[1, 1, 1]]);
        layer["numChannels"] = json!(1);
    }
    assert_eq!(body_json(&body), expected);
    assert!(f.wk.calls().iter().all(|c| c.method != "PUT"));
    {
        let mut remote = f.remote.lock().unwrap();
        remote.root = f.dir.to_str().unwrap().into();
        remote.ignore_update = true;
        remote.source = json!({"id":{"name":f.dir.file_name().unwrap().to_str().unwrap(),"team":"org"},"status":"Not imported yet."});
    }
    let (status, _, body) = f.call("POST", &path, "admin", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body_json(&body)["dataLayers"].is_array());
    assert!(
        f.state.datasets.is_empty(),
        "unusable RPC answer isn't cached"
    );
    f.remote.lock().unwrap().root = String::new();
    let (status, _, body) = f.call("POST", &path, "admin", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body_json(&body)["messages"][0]["error"],
        "DataSource not found"
    );
}

#[tokio::test]
async fn reload_reports_missing_disk_properties_as_unusable_and_propagates_rpc_failures() {
    let f = Fixture::new().await;
    // Point to an existing directory without properties: no permanent deletion commands used.
    let empty = f.dir.join("empty");
    std::fs::create_dir(&empty).unwrap();
    f.remote.lock().unwrap().root = empty.to_str().unwrap().into();
    let path = format!("/data/triggers/reload/org/{ID}");
    let (status, _, body) = f.call("POST", &path, "admin", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body_json(&body)["status"], "Not imported yet.");
    assert_eq!(body_json(&body)["id"]["name"], "empty");
    f.remote.lock().unwrap().fail_root = true;
    let (status, _, body) = f.call("POST", &path, "admin", None).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body_json(&body)["messages"][0]["error"],
        "Failed to get data source root path remote webknossos"
    );
    {
        let mut remote = f.remote.lock().unwrap();
        remote.fail_root = false;
        remote.fail_update = true;
    }
    assert_eq!(
        f.call("POST", &path, "admin", None).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    f.remote.lock().unwrap().fail_source = true;
    assert_eq!(
        f.call("POST", &path, "admin", None).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn reload_rechecks_organization_on_later_rpc_responses() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    for change_at in [1, 2] {
        let dir = temp();
        let counter = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&counter);
        let wk = MockWk::start(move |call| {
            if call.path.ends_with("/validateUserAccess") {
                Reply::json(StatusCode::OK, json!({"granted":true}))
            } else if call.path.ends_with("/findDatasetLocalRootPath") {
                Reply::json(StatusCode::OK, json!(""))
            } else {
                assert_eq!(call.method, "GET");
                let mut data = source(&dir, true);
                if calls.fetch_add(1, Ordering::SeqCst) >= change_at {
                    data["id"]["team"] = json!("other");
                }
                Reply::json(StatusCode::OK, data)
            }
        })
        .await;
        let app = router(AppState::new(wk.config()));
        let (status, _, body) = send(
            app,
            Request::post(format!("/data/triggers/reload/org/{ID}"))
                .header("x-auth-token", "admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            body_json(&body)["messages"][0]["error"],
            "Dataset does not belong to the requested organization."
        );
        assert_eq!(counter.load(Ordering::SeqCst), change_at + 1);
        assert!(wk.calls().iter().all(|c| c.method != "PUT"));
    }
}
