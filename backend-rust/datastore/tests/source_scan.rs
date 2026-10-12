mod common;
mod mock_wk;
use axum::http::StatusCode;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use webknossos_datastore::{
    AppState,
    config::{BaseDirectory, DatastoreConfig},
    models::{
        DataSourcePathInfo, DataSourceWithRootPathInfo, FILENAME_DATASOURCE_PROPERTIES_JSON, UPath,
    },
    services::{BaseDirService, source_scan::scan_real_paths},
};
fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-inbox-{}-{}",
        std::process::id(),
        N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn entry(path: &Path, org: Option<&str>, upload: bool, scan: bool) -> BaseDirectory {
    BaseDirectory {
        path: path.to_str().unwrap().into(),
        is_remote: false,
        organization_id: org.map(str::to_owned),
        allows_upload: upload,
        do_scan: scan,
    }
}
fn source(name: &str) -> Value {
    json!({"id":{"name":name,"team":"org"},"scale":[1,1,1],"dataLayers":[{"name":"color","category":"color",
        "elementClass":"uint8","dataFormat":"zarr","boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
        "mags":[{"mag":[1,1,1],"path":"color/1"}]}]})
}
fn dataset(root: &Path, name: &str) -> PathBuf {
    let p = root.join(name);
    std::fs::create_dir_all(p.join("color/1")).unwrap();
    std::fs::write(
        p.join(FILENAME_DATASOURCE_PROPERTIES_JSON),
        serde_json::to_vec(&source(name)).unwrap(),
    )
    .unwrap();
    p
}

#[test]
fn base_directory_preference_filters_and_local_creation_checks() {
    let root = temp();
    let specific = root.join("specific");
    let global = root.join("global");
    let remote = BaseDirectory {
        path: "s3://bucket/base".into(),
        is_remote: true,
        organization_id: Some("org".into()),
        allows_upload: false,
        do_scan: false,
    };
    let bases = BaseDirService::new(vec![
        entry(&global, None, true, true),
        remote,
        entry(&specific, Some("org"), false, true),
    ]);
    assert_eq!(
        bases
            .get_one_for_org("org", false, false, false)
            .unwrap()
            .to_string(),
        "s3://bucket/base"
    );
    assert_eq!(
        bases.get_one_for_org("org", false, true, false).unwrap(),
        UPath::from_local_path(&specific)
    );
    assert_eq!(
        bases.get_one_for_org("org", true, true, false).unwrap(),
        UPath::from_local_path(&global.join("org"))
    );
    assert_eq!(
        bases
            .get_one_for_org("org", false, false, true)
            .unwrap()
            .to_string(),
        "s3://bucket/base"
    );
    assert!(bases.get_one_for_org("org", true, false, true).is_err());
    assert_eq!(
        bases.local_dirs(Some("org"), true),
        vec![(specific.clone(), Some("org".into()))]
    );
    assert_eq!(
        bases
            .get_one_local_for_org("org", false, false, true)
            .unwrap_err()
            .message,
        "Datastore cannot write to organization data directory, it does not exist."
    );
    bases
        .get_one_local_for_org("org", false, true, true)
        .unwrap();
    assert!(specific.is_dir());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::metadata(&specific).unwrap().permissions();
        std::fs::set_permissions(&specific, std::fs::Permissions::from_mode(0o500)).unwrap();
        // Compare the read-only permission check against a real OS write; root can still write.
        let write = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(specific.join("write-probe"));
        let checked = bases.get_one_local_for_org("org", false, false, true);
        std::fs::set_permissions(&specific, permissions).unwrap();
        assert_eq!(checked.is_ok(), write.is_ok());
        if let Err(error) = checked {
            assert_eq!(
                error.message,
                "Datastore cannot write to organization data directory. No write access."
            );
        }
    }
    assert!(
        bases
            .get_one_for_org("../escape", false, true, false)
            .is_err()
    );
    let file = root.join("file");
    std::fs::write(&file, []).unwrap();
    let invalid = BaseDirService::new(vec![entry(&file, Some("org"), true, true)]);
    assert_eq!(
        invalid
            .get_one_local_for_org("org", false, true, true)
            .unwrap_err()
            .message,
        "Datastore cannot write to organization data directory, it exists but is no directory."
    );
}

#[test]
fn discovers_selected_organizations_deduplicates_and_excludes_hidden_remote_disabled_dirs() {
    let root = temp();
    let direct = root.join("direct");
    let global = root.join("global");
    let duplicate = dataset(&direct, "same");
    dataset(&global.join("org"), "same");
    let other = dataset(&global.join("org"), "other");
    dataset(&global.join("second"), "second-ds");
    dataset(&direct, ".hidden-dataset");
    dataset(&global.join(".hidden-org"), "hidden");
    std::fs::create_dir_all(direct.join("not-imported")).unwrap();
    std::fs::write(direct.join("not-a-directory"), []).unwrap();
    let mut cfg = DatastoreConfig::defaults(&root);
    cfg.base_directories = vec![
        entry(&global, None, true, true),
        entry(&direct, Some("org"), true, true),
        entry(&root.join("disabled"), Some("disabled"), true, false),
        BaseDirectory {
            path: "s3://bucket/unused".into(),
            is_remote: true,
            organization_id: None,
            allows_upload: true,
            do_scan: false,
        },
    ];
    let state = AppState::new(cfg);
    let snapshot = state
        .source_scanner
        .scan_snapshot(Some("org"), false)
        .unwrap();
    assert_eq!(snapshot.sources.len(), 3);
    assert_eq!(snapshot.real_paths.len(), 2);
    assert!(snapshot.failures.is_empty());
    let found = snapshot
        .sources
        .iter()
        .find(|s| s.data_source.id().directory_name == "same")
        .unwrap();
    assert_eq!(found.root_path.as_deref(), duplicate.to_str());
    assert!(
        snapshot
            .sources
            .iter()
            .any(|s| s.root_path.as_deref() == other.to_str())
    );
    assert!(
        snapshot
            .sources
            .iter()
            .all(|s| s.data_source.id().organization_id == "org")
    );
    assert_eq!(
        snapshot
            .sources
            .iter()
            .filter(|s| !s.data_source.is_usable())
            .count(),
        1
    );
    let all = state.source_scanner.scan_snapshot(None, false).unwrap();
    assert_eq!(all.sources.len(), 4);
    let none = state
        .source_scanner
        .scan_snapshot(Some("absent"), false)
        .unwrap();
    assert!(none.sources.is_empty());
}

#[test]
fn realpaths_distinguish_internal_external_remote_missing_and_relative_attachments() {
    let root = temp();
    let p = dataset(&root, "ds");
    let outside = root.join("outside");
    std::fs::write(&outside, []).unwrap();
    let mut data = source("ds");
    data["dataLayers"][0]["mags"] = json!([
        {"mag":[1,1,1],"path":p.join("color/1")},{"mag":[2,2,2],"path":outside},
        {"mag":[4,4,4],"path":"s3://bucket/data"},{"mag":[8,8,8],"path":p.join("missing")},{"mag":[16,16,16]}]);
    data["dataLayers"][0]["attachments"] = json!({"meshes":[
        {"name":"relative","path":"mesh.hdf5","dataFormat":"hdf5"},
        {"name":"remote","path":"https://example.org/mesh.hdf5","dataFormat":"hdf5"}]});
    let info = DataSourceWithRootPathInfo {
        data_source: serde_json::from_value(data).unwrap(),
        root_path: Some(root.to_str().unwrap().into()),
        root_real_path: Some(
            std::fs::canonicalize(&p)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        ),
    };
    let (paths, failures) = scan_real_paths(&[info]);
    assert_eq!(paths.len(), 1);
    assert_eq!(failures.len(), 2);
    let info = &paths[0];
    assert_eq!(info.mag_path_infos.len(), 3);
    assert!(info.mag_path_infos[0].has_local_data);
    assert!(!info.mag_path_infos[1].has_local_data);
    assert!(!info.mag_path_infos[2].has_local_data);
    assert_eq!(
        info.mag_path_infos[2].path,
        info.mag_path_infos[2].real_path
    );
    assert_eq!(info.attachment_path_infos.len(), 1);
    assert!(!info.attachment_path_infos[0].has_local_data);
    assert!(
        failures
            .iter()
            .any(|e| e.message == "Attachment path as stored in db must be absolute")
    );
    let no_paths = DataSourceWithRootPathInfo {
        data_source: serde_json::from_value(
            json!({"id":{"name":"bad","team":"org"},"status":"missing"}),
        )
        .unwrap(),
        root_path: None,
        root_real_path: None,
    };
    assert!(scan_real_paths(&[no_paths]).0.is_empty());
}

#[cfg(unix)]
#[test]
fn symlinked_dataset_roots_and_paths_preserve_original_and_real_identity() {
    use std::os::unix::fs::symlink;
    let root = temp();
    let real = dataset(&root.join("real"), "ds");
    let org = root.join("org");
    std::fs::create_dir(&org).unwrap();
    let link = org.join("linked");
    symlink(&real, &link).unwrap();
    let mut cfg = DatastoreConfig::defaults(&root);
    cfg.base_directories = vec![entry(&org, Some("org"), true, true)];
    let state = AppState::new(cfg);
    let result = state.source_scanner.scan_snapshot(None, false).unwrap();
    assert_eq!(result.sources[0].data_source.id().directory_name, "linked");
    assert_eq!(result.sources[0].root_path.as_deref(), link.to_str());
    assert_eq!(
        result.sources[0].root_real_path.as_deref(),
        std::fs::canonicalize(&real).unwrap().to_str()
    );
    let path = &result.real_paths[0].mag_path_infos[0];
    assert_eq!(path.path, UPath::from_local_path(&link.join("color/1")));
    assert_eq!(
        path.real_path,
        UPath::from_local_path(&std::fs::canonicalize(real.join("color/1")).unwrap())
    );
    assert!(path.has_local_data);
}

#[tokio::test]
async fn reporting_is_ordered_and_per_path_failures_are_nonfatal_but_rpc_failures_propagate() {
    let root = temp();
    let p = dataset(&root, "ds");
    let mut data = source("ds");
    data["dataLayers"][0]["mags"][0]["path"] = json!("missing");
    std::fs::write(
        p.join(FILENAME_DATASOURCE_PROPERTIES_JSON),
        serde_json::to_vec(&data).unwrap(),
    )
    .unwrap();
    let fail = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = Arc::clone(&fail);
    let wk = MockWk::start(move |call| {
        if call.path.ends_with("/datasources") && flag.load(std::sync::atomic::Ordering::SeqCst) {
            Reply::text(StatusCode::SERVICE_UNAVAILABLE, "report failed")
        } else {
            Reply::text(StatusCode::OK, "")
        }
    })
    .await;
    let mut cfg = wk.config();
    cfg.base_directories = vec![entry(&root, Some("org"), true, true)];
    let state = AppState::new(cfg);
    state
        .source_scanner
        .scan_base_directories(Some("org"), true)
        .await
        .unwrap();
    let calls = wk.calls();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].path.ends_with("/datasources"));
    assert!(calls[1].path.ends_with("/datasources/realpaths"));
    assert_eq!(calls[1].json(), json!([]));
    assert_eq!(
        calls[0].query_value("organizationId").as_deref(),
        Some("org")
    );
    assert_eq!(calls[0].json()[0]["dataSource"]["id"]["name"], "ds");
    fail.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        state
            .source_scanner
            .scan_base_directories(None, false)
            .await
            .unwrap_err()
            .status,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        wk.calls().len(),
        3,
        "failed source report does not send a realpaths report"
    );
    let mut cfg = wk.config();
    cfg.base_directories = vec![entry(&root.join("nonexistent"), None, true, true)];
    let state = AppState::new(cfg);
    let error = state
        .source_scanner
        .scan_base_directories(None, false)
        .await
        .unwrap_err();
    assert_eq!(
        error.message,
        "Could not determine base directories to scan from config."
    );
    assert_eq!(wk.calls().len(), 3);
}

#[test]
fn report_dtos_keep_play_option_fields_and_typed_error_paths() {
    let mut v = json!({"dataSource":source("ds"),"rootPath":null});
    let info: DataSourceWithRootPathInfo = serde_json::from_value(v.clone()).unwrap();
    let output = serde_json::to_value(info).unwrap();
    assert!(output.get("rootPath").is_none());
    assert!(output.get("rootRealPath").is_none());
    v["rootPath"] = json!(4);
    let error = DataSourceWithRootPathInfo::from_json(&v).unwrap_err();
    assert_eq!(
        error.to_play_json(),
        json!({"obj.rootPath":[{"msg":["error.expected.jsstring"],"args":[]}]})
    );
    let paths:DataSourcePathInfo=serde_json::from_value(json!({"dataSourceId":{"name":"ds","team":"org"},
        "magPathInfos":[{"path":"s3://bucket/a","realPath":"s3://bucket/a","hasLocalData":false}],"attachmentPathInfos":[]})).unwrap();
    assert!(!paths.is_empty());
    assert_eq!(paths.mag_path_infos[0].path.to_string(), "s3://bucket/a");
}

async fn route_app(root: &Path) -> (MockWk, AppState, axum::Router) {
    let wk = MockWk::start(|call| {
        if call.path.ends_with("/validateUserAccess") {
            Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref()==Some("admin")}),
            )
        } else {
            Reply::text(StatusCode::OK, "")
        }
    })
    .await;
    let mut cfg = wk.config();
    cfg.base_directories = vec![entry(root, None, true, true)];
    let state = AppState::new(cfg);
    (wk, state.clone(), webknossos_datastore::router(state))
}
async fn http(
    app: &axum::Router,
    method: &str,
    url: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let request = axum::http::Request::builder()
        .method(method)
        .uri(url)
        .header("x-auth-token", token);
    let request = if let Some(body) = body {
        request
            .header("content-type", "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    } else {
        request.body(axum::body::Body::empty()).unwrap()
    };
    common::send(app.clone(), request).await
}

#[tokio::test]
async fn authenticated_inbox_scan_reports_sources_then_realpaths_with_selected_scope() {
    let root = temp();
    dataset(&root.join("org"), "ds");
    dataset(&root.join("other"), "other-ds");
    let (wk, _, app) = route_app(&root).await;
    let (status, headers, body) = http(
        &app,
        "POST",
        "/data/v16/triggers/checkInboxBlocking?organizationId=org",
        "admin",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_empty());
    assert_eq!(common::header(&headers, "cache-control"), Some("no-cache"));
    assert_eq!(
        common::header(&headers, "access-control-allow-origin"),
        Some("*")
    );
    let calls = wk.calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(
        calls[0].json(),
        json!({"resourceId":"org","resourceType":"dataset","mode":"administrate"})
    );
    assert_eq!(calls[1].json().as_array().unwrap().len(), 1);
    assert_eq!(
        calls[1].json()[0]["dataSource"]["id"],
        json!({"name":"ds","team":"org"})
    );
    assert_eq!(
        calls[1].query_value("organizationId").as_deref(),
        Some("org")
    );
    assert_eq!(calls[2].json()[0]["magPathInfos"][0]["hasLocalData"], true);
    assert!(calls[1].query_value("token").is_none());
    assert!(calls[2].query_value("token").is_none());
    assert_eq!(
        http(
            &app,
            "POST",
            "/data/triggers/checkInboxBlocking",
            "admin",
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let calls = wk.calls();
    assert_eq!(
        calls[3].json(),
        json!({"resourceType":"dataset","mode":"administrate"})
    );
    assert_eq!(calls[4].json().as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn denied_scan_create_and_path_report_have_no_filesystem_or_reporting_effects() {
    let root = temp();
    let (wk, _, app) = route_app(&root).await;
    for (method, path, body) in [
        (
            "POST",
            "/data/triggers/checkInboxBlocking?organizationId=org",
            None,
        ),
        (
            "POST",
            "/data/triggers/createOrganizationDirectory?organizationId=org",
            None,
        ),
        (
            "POST",
            "/data/triggers/scanRealPathsForVirtual",
            Some(json!([])),
        ),
        (
            "GET",
            "/data/getOrganizationBaseDirectory?organizationId=org&requireAllowsUpload=true&requireLocal=true",
            None,
        ),
    ] {
        assert_eq!(
            http(&app, method, path, "denied", body).await.0,
            StatusCode::FORBIDDEN
        );
    }
    assert!(!root.join("org").exists());
    assert!(
        wk.calls()
            .iter()
            .all(|c| c.path.ends_with("/validateUserAccess"))
    );
}

#[tokio::test]
async fn create_and_lookup_organization_directory_obey_required_boolean_binders() {
    let root = temp();
    let (wk, _, app) = route_app(&root).await;
    let (status,_,body)=http(&app,"GET","/data/getOrganizationBaseDirectory?organizationId=org&requireAllowsUpload=1&requireLocal=true","admin",None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(common::json(&body), json!(root.join("org")));
    assert!(
        !root.join("org").exists(),
        "lookup does not create the directory"
    );
    assert_eq!(
        http(
            &app,
            "POST",
            "/data/triggers/createOrganizationDirectory?organizationId=org",
            "admin",
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(root.join("org").is_dir());
    assert_eq!(
        wk.calls()[1].json(),
        json!({"resourceId":"org","resourceType":"dataset","mode":"administrate"})
    );
    assert_eq!(
        http(
            &app,
            "GET",
            "/data/getOrganizationBaseDirectory?organizationId=org&requireLocal=true",
            "admin",
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        wk.calls().len(),
        2,
        "missing binders fail before access RPC"
    );
    let escape = format!("escape-{}", root.file_name().unwrap().to_str().unwrap());
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("organizationId", &format!("../{escape}"))
        .finish();
    assert_eq!(
        http(
            &app,
            "POST",
            &format!("/data/triggers/createOrganizationDirectory?{query}"),
            "admin",
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(!root.parent().unwrap().join(escape).exists());
}

#[tokio::test]
async fn virtual_realpath_route_validates_play_schema_and_reports_remote_paths() {
    let root = temp();
    let (wk, _, app) = route_app(&root).await;
    let (status, _, body) = http(
        &app,
        "POST",
        "/data/triggers/scanRealPathsForVirtual",
        "admin",
        Some(json!([{}])),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(common::json(&body)["obj[0].dataSource"].is_array());
    assert!(wk.calls().is_empty());
    let mut data = source("ds");
    data["dataLayers"][0]["mags"][0]["path"] = json!("https://example.org/array");
    let (status, _, body) = http(
        &app,
        "POST",
        "/data/triggers/scanRealPathsForVirtual",
        "admin",
        Some(json!([{"dataSource":data}])),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_empty());
    let calls = wk.calls();
    assert_eq!(
        calls[0].json(),
        json!({"resourceType":"webknossos","mode":"administrate"})
    );
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[1].json(),
        json!([{"dataSourceId":{"name":"ds","team":"org"},
        "magPathInfos":[{"path":"https://example.org/array","realPath":"https://example.org/array","hasLocalData":false}],
        "attachmentPathInfos":[]}])
    );
}

#[tokio::test]
async fn watcher_initial_delay_retries_and_completion_interval_prevent_overlap() {
    use axum::{Router, http::Uri, response::IntoResponse};
    use std::sync::atomic::{AtomicUsize, Ordering};
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let cycles = Arc::new(AtomicUsize::new(0));
    let records = Arc::new(std::sync::Mutex::new(Vec::new()));
    let (a, m, c, r) = (
        active.clone(),
        maximum.clone(),
        cycles.clone(),
        records.clone(),
    );
    let app = Router::new().fallback(move |uri: Uri| {
        let (a, m, c, r) = (a.clone(), m.clone(), c.clone(), r.clone());
        async move {
            let n = a.fetch_add(1, Ordering::SeqCst) + 1;
            m.fetch_max(n, Ordering::SeqCst);
            let index = if uri.path().ends_with("/datasources") {
                c.fetch_add(1, Ordering::SeqCst)
            } else {
                usize::MAX
            };
            let started = std::time::Instant::now();
            tokio::time::sleep(Duration::from_millis(150)).await;
            r.lock()
                .unwrap()
                .push((uri.path().to_owned(), started, std::time::Instant::now()));
            a.fetch_sub(1, Ordering::SeqCst);
            (
                if index == 0 {
                    StatusCode::SERVICE_UNAVAILABLE
                } else {
                    StatusCode::OK
                },
                "",
            )
                .into_response()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let uri = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(axum::serve(listener, app).into_future());
    let root = temp();
    let mut cfg = DatastoreConfig::defaults(&root);
    cfg.webknossos.uri = uri;
    cfg.base_directories = vec![entry(&root, Some("org"), true, true)];
    cfg.watch_file_system.initial_delay = Duration::from_millis(50);
    cfg.watch_file_system.interval = Duration::from_millis(100);
    let state = AppState::new(cfg);
    let before = std::time::Instant::now();
    let watcher = state
        .source_scanner
        .spawn_watcher(&state.config.watch_file_system)
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if records.lock().unwrap().len() >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    watcher.abort();
    let _ = watcher.await;
    let records = records.lock().unwrap().clone();
    assert_eq!(maximum.load(Ordering::SeqCst), 1);
    assert_eq!(records[0].0, "/api/datastores/standalone-9090/datasources");
    assert!(records[0].1.duration_since(before) >= Duration::from_millis(50));
    assert!(records[1].1.duration_since(records[0].2) >= Duration::from_millis(100));
    assert!(records[2].0.ends_with("/realpaths"));
    assert_eq!(cycles.load(Ordering::SeqCst), 2);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        cycles.load(Ordering::SeqCst),
        2,
        "aborted watcher schedules no further scans"
    );
    let mut watch = state.config.watch_file_system.clone();
    watch.enabled = false;
    watch.interval = Duration::ZERO;
    assert!(
        state
            .source_scanner
            .spawn_watcher(&watch)
            .unwrap()
            .is_none()
    );
    watch.enabled = true;
    assert!(state.source_scanner.spawn_watcher(&watch).is_err());
    server.abort();
}
