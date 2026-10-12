mod common;

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
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
    AppState, remote_datastore_mag_upload,
    service_clients::{ServiceClientConfig, ServiceClients},
};

/// One recorded datastore call: method, URI (incl. query), JSON body.
type Call = (String, String, Value);

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    fail_invalidation: Arc<AtomicBool>,
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
        ("DELETE", "/data/datasets/deletePaths") => Json(json!(
            body.as_array()
                .unwrap()
                .iter()
                .filter(|p| p.as_str().unwrap().starts_with("s3://managed"))
                .collect::<Vec<_>>()
        ))
        .into_response(),
        ("POST", p) if p.starts_with("/data/datasets/measureUsedStorage/") => Json(json!({
            "reports": body["paths"].as_array().unwrap().iter()
                .map(|p| json!({"path": p, "usedStorageBytes": 100})).collect::<Vec<_>>()
        }))
        .into_response(),
        ("DELETE", _) if mock.fail_invalidation.load(Ordering::SeqCst) => {
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        _ => StatusCode::OK.into_response(),
    }
}

struct Setup {
    db: TestDb,
    app: Router,
    mock: Mock,
    server: tokio::task::JoinHandle<()>,
}

async fn setup() -> Setup {
    let db = TestDb::new().await;
    let mock = Mock::default();
    let upstream = Router::new().fallback(datastore).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    for (store, key, url) in [
        ("store", "service-key", base.clone()),
        ("other", "other-key", "http://other.invalid".to_owned()),
    ] {
        sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,reportUsedStorageEnabled) VALUES ($1,$2,$3,$4,TRUE)")
            .bind(store).bind(url).bind(format!("http://public-{store}.invalid")).bind(key)
            .execute(&db.pool).await.unwrap();
    }
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap();
    let app = remote_datastore_mag_upload::router()
        .layer(Extension(clients))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    Setup {
        db,
        app,
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

fn forbidden() -> Value {
    json!({"granted": false, "msg": "Data store could not be found or accessed."})
}

async fn seed_dataset(
    db: &TestDb,
    organization: &str,
    directory: &str,
    is_virtual: bool,
    is_usable: bool,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,name,directoryName,isUsable,isVirtual,voxelSizeFactor,sortingKey) SELECT $1,_id,'store',_rootFolder,'Display',$2,$3,$4,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$5")
        .bind(&id).bind(directory).bind(is_usable).bind(is_virtual).bind(organization)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
        .bind(&id).execute(&db.pool).await.unwrap();
    for (mag, path) in [
        ("ROW(1,1,1)", "s3://bucket/color/1"),
        ("ROW(2,2,1)", "s3://bucket/color/2-2-1"),
    ] {
        sqlx::query(&format!("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'color',{mag}::webknossos.VECTOR3,$2)"))
            .bind(&id).bind(path).execute(&db.pool).await.unwrap();
    }
    id
}

type MagRow = (Option<String>, bool, bool, Option<Value>, Option<i32>);

async fn mag_row(db: &TestDb, dataset: &str, mag: i32) -> Option<MagRow> {
    sqlx::query_as("SELECT path, uploadToPathIsPending, uploadIsPending, axisOrder, channelIndex FROM webknossos.dataset_mags WHERE _dataset=$1 AND dataLayerName='color' AND mag=ROW($2,$2,$2)::webknossos.VECTOR3")
        .bind(dataset).bind(f64::from(mag)).fetch_optional(&db.pool).await.unwrap()
}

fn reserve_body(dataset: &str, mag: Value, overwrite: bool) -> Value {
    json!({
        "resumableUploadInfo": {"uploadId": "upload-1", "totalFileCount": 3, "filePaths": ["a"], "totalFileSizeInBytes": 10},
        "datasetId": dataset,
        "layerName": "color",
        "mag": mag,
        "overwritePending": overwrite,
    })
}

fn reserve_uri(token: &str) -> String {
    format!("/datastores/store/reserveMagUpload?key=service-key&token={token}")
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reserve_mag_upload_contracts() {
    let Setup {
        db,
        app,
        mock,
        server,
    } = setup().await;
    let owner = db.fixture().await;
    let stranger = db.fixture().await;
    let outsider = db
        .seed_user(&object_id(), &stranger.organization_id, false)
        .await;
    let dataset = seed_dataset(&db, &owner.organization_id, "dir", true, true).await;
    let uri = reserve_uri(&owner.token);
    let mag4 = json!({"mag": 4, "axisOrder": {"x": 1, "y": 2, "z": 3, "c": 0}, "channelIndex": 1});

    // Datastore authentication: wrong key, unknown store.
    let body = reserve_body(&dataset, mag4.clone(), false);
    assert_eq!(
        call(&app, &uri.replace("service-key", "wrong"), body.clone()).await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(
        call(&app, &uri.replace("/store/", "/missing/"), body.clone()).await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    // User token: missing parameter, invalid token, no read access.
    assert_eq!(
        call(
            &app,
            "/datastores/store/reserveMagUpload?key=service-key",
            body.clone()
        )
        .await,
        (StatusCode::BAD_REQUEST, error("Invalid query parameters."))
    );
    assert_eq!(
        call(&app, &reserve_uri("bogus"), body.clone()).await,
        (
            StatusCode::BAD_REQUEST,
            error("The supplied token is invalid or expired.")
        )
    );
    assert_eq!(
        call(&app, &reserve_uri(&outsider.token), body.clone()).await,
        (
            StatusCode::NOT_FOUND,
            error("Could not find or access the requested resource.")
        )
    );
    // Malformed body and mag locators.
    for invalid in [
        json!({"datasetId": dataset, "layerName": "color", "mag": 4, "overwritePending": false}),
        reserve_body(&dataset, json!({"mag": [1, 2]}), false),
        reserve_body(&dataset, json!({"mag": 4, "axisOrder": {"x": 1}}), false),
    ] {
        assert_eq!(
            call(&app, &uri, invalid).await,
            (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
        );
    }
    // Virtual-only, usable data source and existing layer.
    let materialized = seed_dataset(&db, &owner.organization_id, "mat", false, true).await;
    assert_eq!(
        call(&app, &uri, reserve_body(&materialized, mag4.clone(), false)).await,
        (
            StatusCode::BAD_REQUEST,
            error("Mag upload to existing dataset is only supported for virtual datasets.")
        )
    );
    let unusable = seed_dataset(&db, &owner.organization_id, "unusable", true, false).await;
    assert_eq!(
        call(&app, &uri, reserve_body(&unusable, mag4.clone(), false)).await,
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "Dataset “{unusable}” is not imported or incomplete."
            ))
        )
    );
    let no_voxel = seed_dataset(&db, &owner.organization_id, "novoxel", true, true).await;
    sqlx::query("UPDATE webknossos.datasets SET voxelSizeFactor=NULL WHERE _id=$1")
        .bind(&no_voxel)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, &uri, reserve_body(&no_voxel, mag4.clone(), false)).await,
        (
            StatusCode::NOT_FOUND,
            error("Data source not found on data store server. It may still be initializing.")
        )
    );
    let mut missing_layer = reserve_body(&dataset, mag4.clone(), false);
    missing_layer["layerName"] = json!("nope");
    assert_eq!(
        call(&app, &uri, missing_layer).await,
        (
            StatusCode::BAD_REQUEST,
            error("Could not find layer “nope” in dataset.")
        )
    );
    // maxDim conflicts with existing (non-pending) mags.
    for (mag, shown) in [(json!([2, 1, 1]), "(2, 1, 1)"), (json!(1), "(1, 1, 1)")] {
        assert_eq!(
            call(
                &app,
                &uri,
                reserve_body(&dataset, json!({"mag": mag}), false)
            )
            .await,
            (
                StatusCode::BAD_REQUEST,
                error(&format!(
                    "New mag {shown} conflicts with existing mag of the layer."
                ))
            )
        );
    }
    // Datastore must be the dataset's store.
    assert_eq!(
        call(
            &app,
            &format!(
                "/datastores/other/reserveMagUpload?key=other-key&token={}",
                owner.token
            ),
            body.clone()
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("Cannot upload mag to existing dataset via different datastore.")
        )
    );
    assert!(mag_row(&db, &dataset, 4).await.is_none());

    // Success.
    let expected = json!({"dataSourceId": {"name": "dir", "team": owner.organization_id}});
    assert_eq!(
        call(&app, &uri, body.clone()).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        mag_row(&db, &dataset, 4).await,
        Some((
            None,
            false,
            true,
            Some(json!({"x": 1, "y": 2, "z": 3, "c": 0})),
            Some(1)
        ))
    );
    // Pending mag without overwrite → conflict; overwrite replaces the row.
    assert_eq!(
        call(&app, &uri, body.clone()).await,
        (
            StatusCode::BAD_REQUEST,
            error("Conflict with existing pending mag. Pass overwritePending to overwrite.")
        )
    );
    assert_eq!(
        call(&app, &uri, reserve_body(&dataset, json!({"mag": 4}), true)).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        mag_row(&db, &dataset, 4).await,
        Some((None, false, true, None, None))
    );
    // Pending mags do not take part in the maxDim conflict check (only the
    // pending rule applies), and no datastore call was needed so far.
    assert!(mock.take().is_empty());

    // A pending upload-to-path mag: conflict, then overwrite deletes its
    // (real) path at the datastore and queues the managed S3 path.
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,realPath,uploadToPathIsPending) VALUES ($1,'color',ROW(16,16,16)::webknossos.VECTOR3,'s3://bucket/old16','s3://managed/old16',TRUE)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    let mag16 = reserve_body(&dataset, json!({"mag": 16}), false);
    assert_eq!(
        call(&app, &uri, mag16.clone()).await,
        (
            StatusCode::BAD_REQUEST,
            error("Conflict with existing pending mag. Pass overwritePending to overwrite.")
        )
    );
    let mut overwrite16 = mag16.clone();
    overwrite16["overwritePending"] = json!(true);
    assert_eq!(
        call(&app, &uri, overwrite16).await,
        (StatusCode::OK, expected)
    );
    assert_eq!(
        mag_row(&db, &dataset, 16).await,
        Some((None, false, true, None, None))
    );
    let calls = mock.take();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "DELETE");
    assert!(
        calls[0]
            .1
            .starts_with("/data/datasets/deletePaths?token=rpc-secret")
    );
    assert_eq!(calls[0].2, json!(["s3://managed/old16"]));
    let queued: Vec<String> =
        sqlx::query_scalar("SELECT path FROM webknossos.remote_paths_to_delete")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(queued, vec!["s3://managed/old16".to_owned()]);

    server.abort();
    db.cleanup().await;
}

fn report_body(dataset: &str, mag: Value) -> Value {
    json!({"datasetId": dataset, "layerName": "color", "mag": mag, "magSizeBytes": 1234})
}

const REPORT_URI: &str = "/datastores/store/reportMagUpload?key=service-key";

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn report_mag_upload_contracts() {
    let Setup {
        db,
        app,
        mock,
        server,
    } = setup().await;
    let owner = db.fixture().await;
    let dataset = seed_dataset(&db, &owner.organization_id, "dir", true, true).await;
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,uploadIsPending) VALUES ($1,'color',ROW(4,4,4)::webknossos.VECTOR3,TRUE)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,uploadToPathIsPending) VALUES ($1,'color',ROW(8,8,8)::webknossos.VECTOR3,'s3://bucket/8',TRUE)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    let mag4 = json!({"mag": [4, 4, 4], "path": "s3://bucket/color/./4"});
    let body = report_body(&dataset, mag4.clone());

    assert_eq!(
        call(
            &app,
            &REPORT_URI.replace("service-key", "wrong"),
            body.clone()
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(
        call(
            &app,
            REPORT_URI,
            json!({"datasetId": dataset, "layerName": "color", "mag": mag4})
        )
        .await,
        (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
    );
    let unknown = object_id();
    assert_eq!(
        call(&app, REPORT_URI, report_body(&unknown, mag4.clone())).await,
        (
            StatusCode::NOT_FOUND,
            error(&format!(
                "Dataset “{unknown}” could not be found or accessed."
            ))
        )
    );
    let not_pending = error("This mag is not marked as pending.");
    // Existing, upload-to-path pending and missing mags are not pending uploads,
    // with or without a path.
    for mag in [
        json!({"mag": 1, "path": "s3://x"}),
        json!({"mag": 1}),
        json!({"mag": 8, "path": "s3://x"}),
        json!({"mag": 32}),
    ] {
        assert_eq!(
            call(&app, REPORT_URI, report_body(&dataset, mag)).await,
            (StatusCode::BAD_REQUEST, not_pending.clone())
        );
    }
    assert_eq!(
        call(&app, REPORT_URI, report_body(&dataset, json!({"mag": 4}))).await,
        (
            StatusCode::BAD_REQUEST,
            error("Mag path is required in upload.")
        )
    );
    assert!(mock.take().is_empty());

    // Success: the reporting store need not own the dataset (as in Scala);
    // the cache invalidation and storage refresh go to the dataset's store.
    let other_uri = "/datastores/other/reportMagUpload?key=other-key";
    assert_eq!(
        call(&app, other_uri, body.clone()).await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(
        mag_row(&db, &dataset, 4).await,
        Some((
            Some("s3://bucket/color/4".to_owned()),
            false,
            false,
            None,
            None
        ))
    );
    let calls = mock.take();
    assert_eq!(calls.len(), 2, "{calls:?}");
    assert_eq!(
        (calls[0].0.as_str(), calls[0].1.as_str()),
        (
            "DELETE",
            format!("/data/datasets/{dataset}?token=rpc-secret").as_str()
        )
    );
    assert_eq!(calls[1].0, "POST");
    assert_eq!(
        calls[1].1,
        format!(
            "/data/datasets/measureUsedStorage/{}?token=rpc-secret",
            owner.organization_id
        )
    );
    let mut measured: Vec<String> = calls[1].2["paths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_owned())
        .collect();
    measured.sort();
    assert_eq!(
        measured,
        vec![
            "s3://bucket/8",
            "s3://bucket/color/1",
            "s3://bucket/color/2-2-1",
            "s3://bucket/color/4"
        ]
    );
    let stored: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1",
    )
    .bind(&dataset)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(stored, 4);

    // A second report finds nothing pending.
    assert_eq!(
        call(&app, REPORT_URI, body).await,
        (StatusCode::BAD_REQUEST, not_pending)
    );

    // Datastore RPC failure after the update: the error propagates, the
    // finished mag stays committed (Scala has no transaction here either).
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,uploadIsPending) VALUES ($1,'color',ROW(64,64,64)::webknossos.VECTOR3,TRUE)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    mock.fail_invalidation.store(true, Ordering::SeqCst);
    let (status, _) = call(
        &app,
        REPORT_URI,
        report_body(&dataset, json!({"mag": 64, "path": "/local/64"})),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        mag_row(&db, &dataset, 64).await,
        Some((Some("/local/64".to_owned()), false, false, None, None))
    );

    server.abort();
    db.cleanup().await;
}
