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
    AppState, remote_datastore_attachment_upload,
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
    let app = remote_datastore_attachment_upload::router()
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

const NAME_TAKEN: &str =
    "An attachment with this name already exists in this layer. Please choose a different name.";
const SINGLETON_FILLED: &str = "There is already an attachment of this type in this layer. Only one attachment of this type can be registered per layer.";
const ALREADY_PENDING: &str =
    "Conflict with existing pending attachment. Pass overwritePending to overwrite.";

async fn insert_attachment(
    db: &TestDb,
    dataset: &str,
    name: &str,
    typ: &str,
    path: &str,
    flags: (bool, bool),
) {
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat,uploadToPathIsPending,uploadIsPending) VALUES ($1,'segmentation',$2,$3,$4::webknossos.LAYER_ATTACHMENT_TYPE,'hdf5',$5,$6)")
        .bind(dataset).bind(name).bind(path).bind(typ).bind(flags.0).bind(flags.1)
        .execute(&db.pool).await.unwrap();
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
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat,largestSegmentId) VALUES ($1,'segmentation','segmentation','uint32',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3',5)")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'segmentation',ROW(1,1,1)::webknossos.VECTOR3,'s3://bucket/seg/1')")
        .bind(&id).execute(&db.pool).await.unwrap();
    insert_attachment(
        db,
        &id,
        "m1",
        "mesh",
        "s3://bucket/seg/meshes/m1.hdf5",
        (false, false),
    )
    .await;
    insert_attachment(
        db,
        &id,
        "si",
        "segmentIndex",
        "s3://bucket/seg/si.hdf5",
        (false, false),
    )
    .await;
    id
}

/// (path, dataFormat, credentialId, uploadToPathIsPending, uploadIsPending).
type AttachmentRow = (String, String, Option<String>, bool, bool);

async fn attachment_row(
    db: &TestDb,
    dataset: &str,
    name: &str,
    typ: &str,
) -> Option<AttachmentRow> {
    sqlx::query_as("SELECT path, dataFormat::text, credentialId, uploadToPathIsPending, uploadIsPending FROM webknossos.dataset_layer_attachments WHERE _dataset=$1 AND layerName='segmentation' AND name=$2 AND type=$3::webknossos.LAYER_ATTACHMENT_TYPE")
        .bind(dataset).bind(name).bind(typ).fetch_optional(&db.pool).await.unwrap()
}

fn pending_row(format: &str) -> Option<AttachmentRow> {
    Some((
        "./<pending upload>".to_owned(),
        format.to_owned(),
        None,
        false,
        true,
    ))
}

fn reserve_body(dataset: &str, typ: &str, name: &str, overwrite: bool) -> Value {
    json!({
        "resumableUploadInfo": {"uploadId": "upload-1", "totalFileCount": 1},
        "datasetId": dataset,
        "layerName": "segmentation",
        "attachmentType": typ,
        "attachment": {"name": name, "path": "file:///tmp/upload", "dataFormat": "hdf5", "credentialId": "ignored"},
        "overwritePending": overwrite,
    })
}

fn reserve_uri(token: &str) -> String {
    format!("/datastores/store/reserveAttachmentUpload?key=service-key&token={token}")
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reserve_attachment_upload_contracts() {
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
    let body = reserve_body(&dataset, "mesh", "m2", false);

    // Datastore authentication: wrong key, unknown store.
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
            "/datastores/store/reserveAttachmentUpload?key=service-key",
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
    // Malformed bodies: missing field, unknown type/format, invalid UPath.
    let mut invalid = vec![reserve_body(&dataset, "volume", "m2", false)];
    let mut missing = body.clone();
    missing.as_object_mut().unwrap().remove("overwritePending");
    invalid.push(missing);
    for (key, value) in [("dataFormat", json!("wkw")), ("path", json!("a\u{0}b"))] {
        let mut changed = body.clone();
        changed["attachment"][key] = value;
        invalid.push(changed);
    }
    for invalid in invalid {
        assert_eq!(
            call(&app, &uri, invalid).await,
            (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
        );
    }
    // Virtual-only, usable data source and existing layer.
    let materialized = seed_dataset(&db, &owner.organization_id, "mat", false, true).await;
    assert_eq!(
        call(&app, &uri, reserve_body(&materialized, "mesh", "m2", false)).await,
        (
            StatusCode::BAD_REQUEST,
            error("Attachment upload to existing dataset is only supported for virtual datasets.")
        )
    );
    let unusable = seed_dataset(&db, &owner.organization_id, "unusable", true, false).await;
    assert_eq!(
        call(&app, &uri, reserve_body(&unusable, "mesh", "m2", false)).await,
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
        call(&app, &uri, reserve_body(&no_voxel, "mesh", "m2", false)).await,
        (
            StatusCode::NOT_FOUND,
            error("Data source not found on data store server. It may still be initializing.")
        )
    );
    let mut missing_layer = body.clone();
    missing_layer["layerName"] = json!("nope");
    assert_eq!(
        call(&app, &uri, missing_layer).await,
        (
            StatusCode::BAD_REQUEST,
            error("Could not find layer “nope” in dataset.")
        )
    );
    // Existing (non-pending) attachments: named types by name, singletons
    // regardless of name; checked before the datastore match.
    assert_eq!(
        call(&app, &uri, reserve_body(&dataset, "mesh", "m1", true)).await,
        (StatusCode::BAD_REQUEST, error(NAME_TAKEN))
    );
    assert_eq!(
        call(
            &app,
            &format!(
                "/datastores/other/reserveAttachmentUpload?key=other-key&token={}",
                owner.token
            ),
            reserve_body(&dataset, "segmentIndex", "other-name", true)
        )
        .await,
        (StatusCode::BAD_REQUEST, error(SINGLETON_FILLED))
    );
    // Datastore must be the dataset's store.
    assert_eq!(
        call(
            &app,
            &format!(
                "/datastores/other/reserveAttachmentUpload?key=other-key&token={}",
                owner.token
            ),
            body.clone()
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("Cannot upload attachment to existing dataset via different datastore.")
        )
    );
    assert!(attachment_row(&db, &dataset, "m2", "mesh").await.is_none());

    // Success: same name with another type is free; placeholder path,
    // credentialId not stored.
    let expected = json!({"dataSourceId": {"name": "dir", "team": owner.organization_id}});
    assert_eq!(
        call(&app, &uri, body.clone()).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        attachment_row(&db, &dataset, "m2", "mesh").await,
        pending_row("hdf5")
    );
    assert_eq!(
        call(
            &app,
            &uri,
            reserve_body(&dataset, "agglomerate", "m1", false)
        )
        .await,
        (StatusCode::OK, expected.clone())
    );
    // Pending attachment without overwrite → conflict; overwrite replaces it.
    assert_eq!(
        call(&app, &uri, body.clone()).await,
        (StatusCode::BAD_REQUEST, error(ALREADY_PENDING))
    );
    let mut overwrite = reserve_body(&dataset, "mesh", "m2", true);
    overwrite["attachment"]["dataFormat"] = json!("zarr3");
    assert_eq!(
        call(&app, &uri, overwrite).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        attachment_row(&db, &dataset, "m2", "mesh").await,
        pending_row("zarr3")
    );
    // Pending upload-to-path attachment: conflict, then overwrite deletes the
    // row without any datastore path deletion (unlike mags).
    insert_attachment(
        &db,
        &dataset,
        "c1",
        "connectome",
        "s3://managed/c1",
        (true, false),
    )
    .await;
    assert_eq!(
        call(
            &app,
            &uri,
            reserve_body(&dataset, "connectome", "c1", false)
        )
        .await,
        (StatusCode::BAD_REQUEST, error(ALREADY_PENDING))
    );
    assert_eq!(
        call(&app, &uri, reserve_body(&dataset, "connectome", "c1", true)).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        attachment_row(&db, &dataset, "c1", "connectome").await,
        pending_row("hdf5")
    );
    // Pending singletons do not fill the slot (Scala reads only non-pending
    // attachments), so a differently named second reservation succeeds.
    assert_eq!(
        call(&app, &uri, reserve_body(&dataset, "cumsum", "a", false)).await,
        (StatusCode::OK, expected.clone())
    );
    assert_eq!(
        call(&app, &uri, reserve_body(&dataset, "cumsum", "b", false)).await,
        (StatusCode::OK, expected)
    );
    assert!(mock.take().is_empty());
    let queued: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.remote_paths_to_delete")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(queued, 0);

    server.abort();
    db.cleanup().await;
}

fn report_body(dataset: &str, typ: &str, name: &str, path: &str) -> Value {
    json!({
        "datasetId": dataset,
        "layerName": "segmentation",
        "attachmentType": typ,
        "attachment": {"name": name, "path": path, "dataFormat": "json"},
        "attachmentSizeBytes": 1234,
    })
}

const REPORT_URI: &str = "/datastores/store/reportAttachmentUpload?key=service-key";

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn report_attachment_upload_contracts() {
    let Setup {
        db,
        app,
        mock,
        server,
    } = setup().await;
    let owner = db.fixture().await;
    let dataset = seed_dataset(&db, &owner.organization_id, "dir", true, true).await;
    insert_attachment(
        &db,
        &dataset,
        "a1",
        "agglomerate",
        "./<pending upload>",
        (false, true),
    )
    .await;
    insert_attachment(
        &db,
        &dataset,
        "c1",
        "connectome",
        "s3://bucket/c1",
        (true, false),
    )
    .await;
    let body = report_body(
        &dataset,
        "agglomerate",
        "a1",
        "s3://bucket/seg/./agg/a1.hdf5",
    );

    assert_eq!(
        call(
            &app,
            &REPORT_URI.replace("service-key", "wrong"),
            body.clone()
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    let mut missing_size = body.clone();
    missing_size
        .as_object_mut()
        .unwrap()
        .remove("attachmentSizeBytes");
    let mut missing_path = body.clone();
    missing_path["attachment"]
        .as_object_mut()
        .unwrap()
        .remove("path");
    for invalid in [missing_size, missing_path] {
        assert_eq!(
            call(&app, REPORT_URI, invalid).await,
            (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
        );
    }
    let unknown = object_id();
    assert_eq!(
        call(
            &app,
            REPORT_URI,
            report_body(&unknown, "agglomerate", "a1", "s3://x")
        )
        .await,
        (
            StatusCode::NOT_FOUND,
            error(&format!(
                "Dataset “{unknown}” could not be found or accessed."
            ))
        )
    );
    // Existing, upload-to-path pending, missing and wrongly typed attachments
    // are not pending uploads.
    let not_pending = error("This attachment is not marked as pending.");
    for (typ, name) in [
        ("mesh", "m1"),
        ("connectome", "c1"),
        ("mesh", "nope"),
        ("mesh", "a1"),
    ] {
        assert_eq!(
            call(&app, REPORT_URI, report_body(&dataset, typ, name, "s3://x")).await,
            (StatusCode::BAD_REQUEST, not_pending.clone())
        );
    }
    assert!(mock.take().is_empty());

    // Success via a store that does not own the dataset (as in Scala); only
    // the path changes (dataFormat stays), and cache invalidation plus the
    // storage refresh go to the dataset's store.
    assert_eq!(
        call(
            &app,
            "/datastores/other/reportAttachmentUpload?key=other-key",
            body.clone()
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(
        attachment_row(&db, &dataset, "a1", "agglomerate").await,
        Some((
            "s3://bucket/seg/agg/a1.hdf5".to_owned(),
            "hdf5".to_owned(),
            None,
            false,
            false
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
    assert!(
        calls[1].2["paths"]
            .as_array()
            .unwrap()
            .contains(&json!("s3://bucket/seg/agg/a1.hdf5")),
        "{:?}",
        calls[1].2
    );
    let stored: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.organization_usedStorage_attachments WHERE _dataset=$1 AND name='a1'",
    )
    .bind(&dataset)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(stored, 1);

    // A second report finds nothing pending.
    assert_eq!(
        call(&app, REPORT_URI, body).await,
        (StatusCode::BAD_REQUEST, not_pending)
    );

    // Datastore RPC failure after the update: the error propagates, the
    // finished attachment stays committed (Scala has no transaction either).
    insert_attachment(
        &db,
        &dataset,
        "si2",
        "segmentStatistics",
        "./<pending upload>",
        (false, true),
    )
    .await;
    mock.fail_invalidation.store(true, Ordering::SeqCst);
    let (status, _) = call(
        &app,
        REPORT_URI,
        report_body(&dataset, "segmentStatistics", "si2", "/local/stats"),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        attachment_row(&db, &dataset, "si2", "segmentStatistics").await,
        Some((
            "/local/stats".to_owned(),
            "hdf5".to_owned(),
            None,
            false,
            false
        ))
    );

    server.abort();
    db.cleanup().await;
}
