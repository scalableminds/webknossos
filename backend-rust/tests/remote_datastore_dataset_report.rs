mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::{MiscConfig, MiscState},
    remote_datastore_dataset_report,
    service_clients::{ServiceClientConfig, ServiceClients},
};

/// One recorded datastore call: method, URI (incl. query), JSON body.
type Call = (String, String, Value);

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Mock {
    fn take(&self) -> Vec<Call> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}

async fn datastore(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let uri = request.uri().to_string();
    let path = request.uri().path().to_owned();
    let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    mock.calls
        .lock()
        .unwrap()
        .push((method.clone(), uri, body.clone()));
    match (method.as_str(), path.as_str()) {
        ("POST", p) if p.starts_with("/data/datasets/measureUsedStorage/") => Json(json!({
            "reports": body["paths"].as_array().unwrap().iter()
                .map(|p| json!({"path": p, "usedStorageBytes": 100})).collect::<Vec<_>>()
        }))
        .into_response(),
        ("POST", "/data/datasets/writeMirrors") => {
            Json(json!([[body[0], "/mirror/dir"]])).into_response()
        }
        ("GET", "/data/getOrganizationBaseDirectory") => {
            Json(json!("/srv/binaryData/org")).into_response()
        }
        _ => StatusCode::OK.into_response(),
    }
}

struct Setup {
    db: TestDb,
    app: Router,
    disabled_app: Router,
    mock: Mock,
    server: tokio::task::JoinHandle<()>,
}

fn app(db: &TestDb, jobs_enabled: bool) -> Router {
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap();
    let mut misc = MiscConfig {
        jobs_enabled,
        ..MiscConfig::default()
    };
    misc.analytics.uri = String::new();
    misc.analytics.save_to_database_enabled = true;
    remote_datastore_dataset_report::router()
        .layer(Extension(clients))
        .layer(Extension(MiscState::new(misc)))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn setup() -> Setup {
    let db = TestDb::new().await;
    let mock = Mock::default();
    let upstream = Router::new().fallback(datastore).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,reportUsedStorageEnabled) VALUES ('store',$1,'http://public-store.invalid','service-key',TRUE)")
        .bind(&base)
        .execute(&db.pool).await.unwrap();
    Setup {
        app: app(&db, true),
        disabled_app: app(&db, false),
        db,
        mock,
        server,
    }
}

async fn call(app: &Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

fn report_uri(token: &str, dataset: &str) -> String {
    format!(
        "/datastores/store/reportDatasetUpload?key=service-key&token={token}&datasetId={dataset}"
    )
}

/// A dataset as left behind by reserveDatasetUpload.
async fn seed_reserved(db: &TestDb, organization: &str, uploader: &str, directory: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,_uploader,name,directoryName,isUsable,isVirtual,status,sortingKey) SELECT $1,_id,'store',_rootFolder,$3,'Upload',$4,FALSE,TRUE,'Not yet fully uploaded.',NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(organization).bind(uploader).bind(directory)
        .execute(&db.pool).await.unwrap();
    id
}

/// A usable dataset with one color layer, used as link source.
async fn seed_link_source(db: &TestDb, organization: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,name,directoryName,isUsable,isVirtual,voxelSizeFactor,voxelSizeUnit,sortingKey) SELECT $1,_id,'store',_rootFolder,'Source','source-dir',TRUE,TRUE,ROW(1,1,1)::webknossos.VECTOR3,'nanometer',NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(organization)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,'s3://bucket/source/color/1')")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

fn data_source(organization: &str, layer: &str) -> Value {
    json!({
        "id": {"name": "upload-dir", "team": organization},
        "dataLayers": [{
            "name": layer, "category": "segmentation", "dataFormat": "zarr3",
            "boundingBox": {"topLeft": [0, 0, 0], "width": 20, "height": 20, "depth": 5},
            "elementClass": "uint32", "largestSegmentId": 7,
            "mags": [{"mag": [1, 1, 1], "path": "/srv/binaryData/org/upload-dir/segmentation/1"}]
        }],
        "scale": {"factor": [11.24, 11.24, 28], "unit": "nanometer"}
    })
}

fn body(needs_conversion: bool, source: Option<Value>, links: Value, voxel_size: Value) -> Value {
    json!({
        "needsConversion": needs_conversion,
        "datasetSizeBytes": 1234,
        "dataSourceOpt": source,
        "layersToLink": links,
        "voxelSize": voxel_size,
    })
}

type DatasetRow = (bool, String, Option<i32>, Option<String>, Option<String>);

async fn dataset_row(db: &TestDb, id: &str) -> DatasetRow {
    sqlx::query_as("SELECT isUsable, status, inboxSourceHash, voxelSizeUnit::text, mirrorPath FROM webknossos.datasets WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

async fn layer_names(db: &TestDb, id: &str) -> Vec<String> {
    sqlx::query_scalar("SELECT name FROM webknossos.dataset_layers WHERE _dataset=$1 ORDER BY name")
        .bind(id)
        .fetch_all(&db.pool)
        .await
        .unwrap()
}

/// Analytics are fire-and-forget; poll briefly for the stored event.
async fn analytics_events(db: &TestDb, event_type: &str, expected: i64) -> Vec<Value> {
    for _ in 0..50 {
        let events: Vec<Value> = sqlx::query_scalar(
            "SELECT eventProperties FROM webknossos.analyticsEvents WHERE eventType=$1",
        )
        .bind(event_type)
        .fetch_all(&db.pool)
        .await
        .unwrap();
        if events.len() as i64 >= expected {
            return events;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("analytics event {event_type} was not stored");
}

fn paths(calls: &[Call]) -> Vec<(String, String)> {
    calls
        .iter()
        .map(|(method, uri, _)| (method.clone(), uri.split('?').next().unwrap().to_owned()))
        .collect()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn report_dataset_upload_without_conversion() {
    let Setup {
        db,
        app,
        disabled_app: _,
        mock,
        server,
    } = setup().await;
    let owner = db.fixture().await;
    let stranger = db.fixture().await;
    let org = owner.organization_id.clone();
    let dataset = seed_reserved(&db, &org, &owner.user_id, "upload-dir").await;
    let source = seed_link_source(&db, &org).await;
    let foreign_source = seed_link_source(&db, &stranger.organization_id).await;
    let uri = report_uri(&owner.token, &dataset);
    let link = json!([{"datasetId": source, "layerName": "color", "newLayerName": "linked"}]);
    let valid = body(
        false,
        Some(data_source(&org, "segmentation")),
        link.clone(),
        Value::Null,
    );

    // Datastore authentication, query binding, token and dataset lookup.
    let (status, response) = call(
        &app,
        &uri.replace("service-key", "wrong-key"),
        valid.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        response,
        json!({"granted": false, "msg": "Data store could not be found or accessed."})
    );
    let (status, _) = call(
        &app,
        &format!("/datastores/store/reportDatasetUpload?key=service-key&datasetId={dataset}"),
        valid.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, response) = call(&app, &report_uri("bogus", &dataset), valid.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(response, error("The supplied token is invalid or expired."));
    let missing = object_id();
    let (status, response) = call(&app, &report_uri(&owner.token, &missing), valid.clone()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        response,
        error(&format!(
            "Dataset “{missing}” could not be found or accessed."
        ))
    );
    let (status, _) = call(
        &app,
        &uri,
        body(
            false,
            Some(json!({"id": {"name": "x"}})),
            json!([]),
            Value::Null,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(&app, &uri, json!({"needsConversion": false})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(mock.take().is_empty());

    // Link failures: unreadable source (other organization), unknown layer,
    // duplicate names. The dataset stays untouched.
    for links in [
        json!([{"datasetId": foreign_source, "layerName": "color"}]),
        json!([{"datasetId": source, "layerName": "missing"}]),
    ] {
        let (status, response) = call(
            &app,
            &uri,
            body(
                false,
                Some(data_source(&org, "segmentation")),
                links,
                Value::Null,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(response, error("Could not resolve layers to link."));
    }
    let (status, response) = call(
        &app,
        &uri,
        body(
            false,
            Some(data_source(&org, "color")),
            json!([{"datasetId": source, "layerName": "color"}]),
            Value::Null,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(response, error("Dataset layers must have unique names."));
    assert_eq!(
        dataset_row(&db, &dataset).await,
        (false, "Not yet fully uploaded.".into(), None, None, None)
    );
    assert!(layer_names(&db, &dataset).await.is_empty());
    assert!(mock.take().is_empty());
    // The upload analytics event is tracked before the link resolution fails.
    let events = analytics_events(&db, "upload_dataset", 3).await;
    assert_eq!(
        events[0],
        json!({
            "dataset_id": dataset, "dataset_name": "Upload", "dataset_size_bytes": 1234,
            "datastore_uri": "http://public-store.invalid", "dataset_organization_id": org,
        })
    );

    // Success: data source with linked layer stored, usable; storage refresh,
    // real-path scan (local mag path) and mirror follow.
    let (status, response) = call(&app, &uri, valid.clone()).await;
    assert_eq!((status, response), (StatusCode::OK, Value::Null));
    let (usable, status_text, hash, unit, mirror) = dataset_row(&db, &dataset).await;
    assert!(usable);
    assert_eq!(status_text, "");
    assert!(hash.is_some());
    assert_eq!(unit.as_deref(), Some("nanometer"));
    assert_eq!(mirror.as_deref(), Some("/mirror/dir"));
    assert_eq!(layer_names(&db, &dataset).await, ["linked", "segmentation"]);
    let linked_path: String = sqlx::query_scalar(
        "SELECT path FROM webknossos.dataset_mags WHERE _dataset=$1 AND dataLayerName='linked'",
    )
    .bind(&dataset)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(linked_path, "s3://bucket/source/color/1");
    let calls = mock.take();
    assert_eq!(
        paths(&calls),
        [
            (
                "POST".to_owned(),
                format!("/data/datasets/measureUsedStorage/{org}")
            ),
            (
                "POST".to_owned(),
                "/data/triggers/scanRealPathsForVirtual".to_owned()
            ),
            ("POST".to_owned(), "/data/datasets/writeMirrors".to_owned()),
        ]
    );
    assert!(calls[0].1.contains("token=rpc-secret"));
    assert_eq!(
        calls[1].2[0]["dataSource"]["dataLayers"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(calls[2].2, json!([dataset]));
    let used: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1",
    )
    .bind(&dataset)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(used, 2);
    analytics_events(&db, "upload_dataset", 4).await;

    // Without a data source nothing is written; an unusable dataset only gets
    // the storage refresh (scan/mirror are no-ops for unusable datasets).
    let other = seed_reserved(&db, &org, &owner.user_id, "other-dir").await;
    let (status, _) = call(
        &app,
        &report_uri(&owner.token, &other),
        body(false, None, link, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        dataset_row(&db, &other).await,
        (false, "Not yet fully uploaded.".into(), None, None, None)
    );
    // No mags yet: refresh_for_dataset sends no measure request either.
    assert!(
        paths(&mock.take())
            .iter()
            .all(|(_, p)| p.starts_with("/data/datasets/measureUsedStorage/"))
    );

    let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.jobs")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(jobs, 0);
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn report_dataset_upload_with_conversion() {
    let Setup {
        db,
        app,
        disabled_app,
        mock,
        server,
    } = setup().await;
    let owner = db.fixture().await;
    let org = owner.organization_id.clone();
    let dataset = seed_reserved(&db, &org, &owner.user_id, "upload-dir").await;
    let uri = report_uri(&owner.token, &dataset);
    let voxel_size = json!({"factor": [11.24, 11.24, 28], "unit": "micrometer"});

    // Missing voxel size fails after the (absent) data source update.
    let (status, response) = call(&app, &uri, body(true, None, json!([]), Value::Null)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        response,
        error("Dataset needs conversion but no voxel size was supplied.")
    );
    assert!(mock.take().is_empty());

    // Jobs disabled / no worker: submitJob failure wrapped by submitFailed.
    for (router, cause) in [
        (
            &disabled_app,
            "Long-running jobs are not enabled for this WEBKNOSSOS instance.",
        ),
        (
            &app,
            "No worker supporting the requested job is available for the selected data store.",
        ),
    ] {
        let (status, response) = call(
            router,
            &uri,
            body(true, None, json!([]), voxel_size.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            response["messages"][0],
            json!({"error": "Could not start image conversion/import job."})
        );
        assert!(
            response["messages"][1]["chain"]
                .as_str()
                .unwrap()
                .ends_with(cause),
            "{response}"
        );
        let calls = mock.take();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].1,
            format!(
                "/data/getOrganizationBaseDirectory?token=rpc-secret&organizationId={org}&requireLocal=true&requireAllowsUpload=true"
            )
        );
    }

    // A worker of the dataset's store supports convert_to_wkw: job inserted.
    sqlx::query("INSERT INTO webknossos.workers (_id,_dataStore,key,supportedJobCommands) VALUES ($1,'store','worker-secret',ARRAY['convert_to_wkw'])")
        .bind(object_id()).execute(&db.pool).await.unwrap();
    let (status, _) = call(&app, &uri, body(true, None, json!([]), voxel_size.clone())).await;
    assert_eq!(status, StatusCode::OK);
    let (owner_id, store, command, args, state): (String, String, String, Value, String) =
        sqlx::query_as(
            "SELECT _owner, _dataStore, command, commandArgs, state::text FROM webknossos.jobs",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        (
            owner_id.as_str(),
            store.as_str(),
            command.as_str(),
            state.as_str()
        ),
        (owner.user_id.as_str(), "store", "convert_to_wkw", "PENDING")
    );
    assert_eq!(
        args,
        json!({
            "organization_id": org,
            "organization_base_directory": "/srv/binaryData/org",
            "organization_display_name": "Test organization",
            "dataset_name": "Upload",
            "dataset_id": dataset,
            "dataset_directory_name": "upload-dir",
            "voxel_size_factor": "11.24,11.24,28.0",
            "voxel_size_unit": "micrometer",
        })
    );
    // No storage refresh / scan / mirror in the conversion branch.
    assert_eq!(
        paths(&mock.take()),
        [(
            "GET".to_owned(),
            "/data/getOrganizationBaseDirectory".to_owned()
        )]
    );
    assert_eq!(
        analytics_events(&db, "run_job", 1).await,
        [json!({"command": "convert_to_wkw"})]
    );
    // A data source reported with conversion is stored too (bare-factor voxel size).
    let (status, _) = call(
        &app,
        &uri,
        body(
            true,
            Some(data_source(&org, "segmentation")),
            json!([]),
            json!([2, 2, 2]),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(dataset_row(&db, &dataset).await.0);
    let all: Vec<String> =
        sqlx::query_scalar("SELECT commandArgs->>'voxel_size_factor' FROM webknossos.jobs")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(all.len(), 2);
    assert!(all.contains(&"2.0,2.0,2.0".to_owned()), "{all:?}");
    server.abort();
    db.cleanup().await;
}
