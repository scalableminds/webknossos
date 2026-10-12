mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, dataset_lifecycle,
    dataset_options::DatasetRouteConfig,
    dataset_paths,
    service_clients::{ServiceClientConfig, ServiceClients},
};

/// One recorded datastore call: method, URI (incl. query), JSON body.
type Call = (String, String, Value);

#[derive(Clone, Default)]
struct Store {
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Store {
    fn take(&self) -> Vec<Call> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}

async fn datastore(State(store): State<Store>, request: Request) -> Response {
    let method = request.method().to_string();
    let uri = request.uri().to_string();
    let path = request.uri().path().to_owned();
    let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    store
        .calls
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
        ("POST", "/data/datasets/writeMirrors") => Json(json!(
            body.as_array()
                .unwrap()
                .iter()
                .map(|id| json!([id, format!("/mirror/{}", id.as_str().unwrap())]))
                .collect::<Vec<_>>()
        ))
        .into_response(),
        ("POST", p) if p.starts_with("/data/datasets/measureUsedStorage/") => Json(json!({
            "reports": body["paths"].as_array().unwrap().iter()
                .map(|p| json!({"path": p, "usedStorageBytes": 100})).collect::<Vec<_>>()
        }))
        .into_response(),
        _ => StatusCode::OK.into_response(),
    }
}

async fn upstream() -> (String, Store, tokio::task::JoinHandle<()>) {
    let store = Store::default();
    let app = Router::new().fallback(datastore).with_state(store.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, store, task)
}

fn clients() -> ServiceClients {
    ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap()
}

fn app(db: &TestDb, allow_delete: bool, jobs_enabled: bool) -> Router {
    dataset_lifecycle::router(allow_delete, jobs_enabled)
        .layer(Extension(clients()))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = axum::http::Request::builder()
        .method(Method::from_bytes(method.as_bytes()).unwrap())
        .uri(path);
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let body = match body {
        Some(body) => {
            builder = builder.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn seed_store(db: &TestDb, name: &str, url: &str, report_storage: bool) {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,reportUsedStorageEnabled) VALUES ($1,$2,$3,'k',$4)")
        .bind(name).bind(url).bind(format!("http://public-{name}.invalid")).bind(report_storage)
        .execute(&db.pool).await.unwrap();
}

struct DatasetSpec<'a> {
    store: &'a str,
    is_virtual: bool,
    is_usable: bool,
    status: &'a str,
    root_path: Option<&'a str>,
}

async fn seed_dataset(db: &TestDb, fixture: &Fixture, spec: DatasetSpec<'_>) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,isVirtual,status,rootPath,voxelSizeFactor,sortingKey) SELECT $1,$3,_id,_rootFolder,$1,$1,$4,$5,$6,$7,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(spec.store).bind(spec.is_usable)
        .bind(spec.is_virtual).bind(spec.status).bind(spec.root_path)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

async fn seed_mag(
    db: &TestDb,
    id: &str,
    mag: i32,
    path: &str,
    real_path: Option<&str>,
    pending: bool,
) {
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,realPath,uploadToPathIsPending) VALUES ($1,'color',ROW($2,$2,$2)::webknossos.VECTOR3,$3,$4,$5)")
        .bind(id).bind(f64::from(mag)).bind(path).bind(real_path).bind(pending)
        .execute(&db.pool).await.unwrap();
}

async fn member(db: &TestDb, fixture: &Fixture, dataset: &str) -> String {
    let member = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,false)",
    )
    .bind(&member.user_id)
    .bind(&fixture.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2)")
        .bind(dataset)
        .bind(&fixture.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    member.token
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn path_deletion_service_routes_require_the_configured_key() {
    let db = TestDb::new().await;
    for (path, offset) in [("s3://managed/b", 1), ("s3://managed/a", 2)] {
        sqlx::query("INSERT INTO webknossos.remote_paths_to_delete (path,created) VALUES ($1,NOW() - make_interval(mins => $2))")
            .bind(path).bind(offset).execute(&db.pool).await.unwrap();
    }
    let state = AppState {
        pool: db.pool.clone(),
    };
    let unconfigured =
        dataset_paths::router(DatasetRouteConfig::default()).with_state(state.clone());
    let configured = dataset_paths::router(DatasetRouteConfig {
        external_path_deletion_key: Some("deletion-key".into()),
        ..Default::default()
    })
    .with_state(state);
    let (status, body) = call(
        &unconfigured,
        "GET",
        "/datasets/pathsToDelete?key=",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Wrong key for external path deletion service."
    );
    assert_eq!(
        call(&configured, "GET", "/datasets/pathsToDelete", None, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &configured,
            "GET",
            "/datasets/pathsToDelete?key=wrong",
            None,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, body) = call(
        &configured,
        "GET",
        "/datasets/pathsToDelete?key=deletion-key",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!(["s3://managed/a", "s3://managed/b"]));
    let mark = "/datasets/pathsToDelete/markAsDeleted";
    assert_eq!(
        call(
            &configured,
            "POST",
            &format!("{mark}?key=wrong"),
            None,
            Some(json!(["s3://managed/a"]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &configured,
            "POST",
            &format!("{mark}?key=deletion-key"),
            None,
            Some(json!({"no":"array"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, _) = call(
        &configured,
        "POST",
        &format!("{mark}?key=deletion-key"),
        None,
        Some(json!(["s3://managed/a", "unknown"])),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = call(
        &configured,
        "GET",
        "/datasets/pathsToDelete?key=deletion-key",
        None,
        None,
    )
    .await;
    assert_eq!(body, json!(["s3://managed/b"]));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn delete_handles_virtual_paths_disk_datasets_and_annotation_soft_delete() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, store, server) = upstream().await;
    seed_store(&db, "store", &base, false).await;
    let virtual_spec = || DatasetSpec {
        store: "store",
        is_virtual: true,
        is_usable: true,
        status: "",
        root_path: None,
    };
    let virtual_id = seed_dataset(&db, &fixture, virtual_spec()).await;
    seed_mag(&db, &virtual_id, 1, "s3://managed/own/1", None, false).await;
    seed_mag(&db, &virtual_id, 2, "/local/own/2", None, false).await;
    seed_mag(&db, &virtual_id, 4, "s3://managed/shared", None, false).await;
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'color','mesh','s3://managed/own/mesh.hdf5','mesh','hdf5'),($1,'color','zipped','/local/a.zip|zip:mesh','mesh','zarr3')")
        .bind(&virtual_id).execute(&db.pool).await.unwrap();
    let other = seed_dataset(&db, &fixture, virtual_spec()).await;
    seed_mag(&db, &other, 1, "s3://managed/shared", None, false).await;
    let member_token = member(&db, &fixture, &virtual_id).await;
    let foreign = db.fixture().await;

    let application = app(&db, true, false);
    let path = format!("/datasets/{virtual_id}");
    assert_eq!(
        call(&application, "DELETE", &path, None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&application, "DELETE", &path, Some(&foreign.token), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&application, "DELETE", &path, Some(&member_token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, body) = call(
        &app(&db, false, false),
        "DELETE",
        &path,
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Dataset deletion is not enabled for this WEBKNOSSOS instance."
    );
    assert!(store.take().is_empty());

    let (status, body) = call(&application, "DELETE", &path, Some(&fixture.token), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let calls = store.take();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "DELETE");
    assert_eq!(calls[0].1, "/data/datasets/deletePaths?token=rpc-secret");
    let mut sent: Vec<String> = serde_json::from_value(calls[0].2.clone()).unwrap();
    sent.sort();
    // Shared paths and zip entries are never deleted.
    assert_eq!(
        sent,
        [
            "/local/own/2",
            "s3://managed/own/1",
            "s3://managed/own/mesh.hdf5"
        ]
    );
    let queued: Vec<String> =
        sqlx::query_scalar("SELECT path FROM webknossos.remote_paths_to_delete ORDER BY path")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(queued, ["s3://managed/own/1", "s3://managed/own/mesh.hdf5"]);
    let remaining: i64 = sqlx::query_scalar("SELECT (SELECT count(*) FROM webknossos.datasets WHERE _id=$1)+(SELECT count(*) FROM webknossos.dataset_mags WHERE _dataset=$1)+(SELECT count(*) FROM webknossos.dataset_layers WHERE _dataset=$1)+(SELECT count(*) FROM webknossos.dataset_allowedTeams WHERE _dataset=$1)")
        .bind(&virtual_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(remaining, 0);
    assert_eq!(
        call(&application, "DELETE", &path, Some(&fixture.token), None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    // Disk-based dataset: blocked while another dataset references its directory.
    let disk = seed_dataset(
        &db,
        &fixture,
        DatasetSpec {
            store: "store",
            is_virtual: false,
            is_usable: false,
            status: "Not yet fully uploaded.",
            root_path: Some("/srv/org/disk"),
        },
    )
    .await;
    seed_mag(
        &db,
        &other,
        2,
        "/elsewhere",
        Some("/srv/org/disk/color/1"),
        false,
    )
    .await;
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ) VALUES ($1,$2,$3,'Explorational')")
        .bind(object_id()).bind(&disk).bind(&fixture.user_id).execute(&db.pool).await.unwrap();
    let job = object_id();
    sqlx::query("INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs) VALUES ($1,$2,'store','convert_to_wkw',jsonb_build_object('dataset_id',$3::text))")
        .bind(&job).bind(&fixture.user_id).bind(&disk).execute(&db.pool).await.unwrap();
    let disk_path = format!("/datasets/{disk}");
    let (status, body) = call(
        &application,
        "DELETE",
        &disk_path,
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        format!("Cannot delete dataset because 1 other datasets reference its data: {other}")
    );
    assert!(store.take().is_empty());
    sqlx::query("DELETE FROM webknossos.dataset_mags WHERE _dataset=$1 AND path='/elsewhere'")
        .bind(&other)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _) = call(
        &app(&db, true, true),
        "DELETE",
        &disk_path,
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let calls = store.take();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        (calls[0].0.as_str(), calls[0].1.as_str()),
        (
            "DELETE",
            format!(
                "/data/datasets/{disk}/deleteOnDisk?token=rpc-secret&rootPath=%2Fsrv%2Forg%2Fdisk"
            )
            .as_str()
        )
    );
    // Annotations keep the row as a soft-deleted, unusable dataset.
    let (status_text, usable, layers): (String, bool, i64) = sqlx::query_as("SELECT status,isUsable,(SELECT count(*) FROM webknossos.dataset_layers WHERE _dataset=$1) FROM webknossos.datasets WHERE _id=$1")
        .bind(&disk).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        (status_text.as_str(), usable, layers),
        ("Deleted by user.", false, 0)
    );
    let job_state: Option<String> =
        sqlx::query_scalar("SELECT manualState::text FROM webknossos.jobs WHERE _id=$1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(job_state.as_deref(), Some("CANCELLED"));
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn mirrors_and_finish_upload_routes_drive_datastore_side_effects() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, store, server) = upstream().await;
    seed_store(&db, "store", &base, true).await;
    seed_store(
        &db,
        "second",
        &base.replace("127.0.0.1", "localhost"),
        false,
    )
    .await;
    let application = app(&db, true, false);
    let usable_virtual = DatasetSpec {
        store: "store",
        is_virtual: true,
        is_usable: true,
        status: "",
        root_path: None,
    };
    let mirrored = seed_dataset(&db, &fixture, usable_virtual).await;
    let member_token = member(&db, &fixture, &mirrored).await;
    let path = format!("/datasets/{mirrored}/writeMirror");
    assert_eq!(
        call(&application, "POST", &path, Some(&member_token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&application, "POST", &path, Some(&fixture.token), None)
            .await
            .0,
        StatusCode::OK
    );
    let calls = store.take();
    assert_eq!(
        calls,
        [(
            "POST".to_owned(),
            "/data/datasets/writeMirrors?token=rpc-secret&failOnError=true".to_owned(),
            json!([mirrored])
        )]
    );
    let mirror: Option<String> =
        sqlx::query_scalar("SELECT mirrorPath FROM webknossos.datasets WHERE _id=$1")
            .bind(&mirrored)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(mirror, Some(format!("/mirror/{mirrored}")));
    let disk = seed_dataset(
        &db,
        &fixture,
        DatasetSpec {
            store: "store",
            is_virtual: false,
            is_usable: true,
            status: "",
            root_path: Some("/srv/disk"),
        },
    )
    .await;
    let (status, body) = call(
        &application,
        "POST",
        &format!("/datasets/{disk}/writeMirror"),
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Can only write on-disk dataset mirrors for virtual (db-based) datasets."
    );

    // writeAllMirrors: superusers only, grouped per datastore, non-failing mode.
    let second = seed_dataset(
        &db,
        &fixture,
        DatasetSpec {
            store: "second",
            is_virtual: true,
            is_usable: true,
            status: "",
            root_path: None,
        },
    )
    .await;
    assert_eq!(
        call(
            &application,
            "POST",
            "/datasets/writeAllMirrors",
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=true WHERE _id=$1")
        .bind(&fixture.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &application,
            "POST",
            "/datasets/writeAllMirrors",
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let calls = store.take();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|c| {
        c.1.ends_with("writeMirrors?token=rpc-secret&failOnError=false")
    }));
    assert_eq!(calls[0].2, json!([second]));
    assert_eq!(calls[1].2, json!([mirrored]));
    let mirror: Option<String> =
        sqlx::query_scalar("SELECT mirrorPath FROM webknossos.datasets WHERE _id=$1")
            .bind(&second)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(mirror, Some(format!("/mirror/{second}")));

    // finishUploadToPaths on a pending virtual dataset with a local mag.
    let pending = seed_dataset(
        &db,
        &fixture,
        DatasetSpec {
            store: "store",
            is_virtual: true,
            is_usable: false,
            status: "Not yet marked as fully uploaded to paths.",
            root_path: None,
        },
    )
    .await;
    seed_mag(&db, &pending, 1, "/local/pending/1", None, false).await;
    let finish = format!("/datasets/{pending}/finishUploadToPaths");
    assert_eq!(
        call(&application, "POST", &finish, Some(&fixture.token), None)
            .await
            .0,
        StatusCode::OK
    );
    let calls = store.take();
    let summary: Vec<(String, String)> = calls.iter().map(|c| (c.0.clone(), c.1.clone())).collect();
    assert_eq!(
        summary,
        [
            (
                "POST".to_owned(),
                "/data/triggers/scanRealPathsForVirtual?token=rpc-secret".to_owned()
            ),
            (
                "POST".to_owned(),
                "/data/datasets/writeMirrors?token=rpc-secret&failOnError=true".to_owned()
            ),
            (
                "POST".to_owned(),
                format!(
                    "/data/datasets/measureUsedStorage/{}?token=rpc-secret",
                    fixture.organization_id
                )
            ),
        ]
    );
    assert_eq!(
        calls[0].2[0]["dataSource"]["dataLayers"][0]["mags"][0]["path"],
        "/local/pending/1"
    );
    assert!(calls[0].2[0].get("rootPath").is_none());
    assert_eq!(calls[2].2, json!({"paths":["/local/pending/1"]}));
    let (usable, status_text, bytes): (bool, String, i64) = sqlx::query_as("SELECT isUsable,status,(SELECT sum(usedStorageBytes)::bigint FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1) FROM webknossos.datasets WHERE _id=$1")
        .bind(&pending).fetch_one(&db.pool).await.unwrap();
    assert_eq!((usable, status_text.as_str(), bytes), (true, "", 100));
    let (status, body) = call(&application, "POST", &finish, Some(&fixture.token), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Dataset is not in uploading-to-paths status, got ."
    );

    // finishMagUploadToPath on the disk dataset: data source written to disk.
    seed_mag(&db, &disk, 2, "/srv/disk/color/2", None, true).await;
    let mag_body = json!({"layerName":"color","mag":[2,2,2],"overwritePending":false});
    let finish_mag = format!("/datasets/{disk}/finishMagUploadToPath");
    assert_eq!(
        call(
            &application,
            "POST",
            &finish_mag,
            Some(&fixture.token),
            Some(json!({"layerName":"color","mag":[2,2,2]}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &application,
            "POST",
            &finish_mag,
            Some(&member_token),
            Some(mag_body.clone())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &application,
            "POST",
            &finish_mag,
            Some(&fixture.token),
            Some(mag_body.clone())
        )
        .await
        .0,
        StatusCode::OK
    );
    let calls = store.take();
    let summary: Vec<(String, String)> = calls.iter().map(|c| (c.0.clone(), c.1.clone())).collect();
    assert_eq!(
        summary,
        [
            (
                "PUT".to_owned(),
                format!("/data/datasets/{disk}?token=rpc-secret&rootPath=%2Fsrv%2Fdisk")
            ),
            (
                "POST".to_owned(),
                format!(
                    "/data/datasets/measureUsedStorage/{}?token=rpc-secret",
                    fixture.organization_id
                )
            ),
            (
                "DELETE".to_owned(),
                format!("/data/datasets/{disk}?token=rpc-secret")
            ),
        ]
    );
    assert_eq!(
        calls[0].2["dataLayers"][0]["mags"][0]["mag"],
        json!([2, 2, 2])
    );
    let (status, body) = call(
        &application,
        "POST",
        &finish_mag,
        Some(&fixture.token),
        Some(mag_body),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "This mag is not marked as pending upload to path."
    );

    // finishAttachmentUploadToPath on a virtual dataset.
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat,uploadToPathIsPending) VALUES ($1,'color','agg','s3://bucket/agg','agglomerate','zarr3',true)")
        .bind(&mirrored).execute(&db.pool).await.unwrap();
    let attachment = json!({"layerName":"color","attachmentName":"agg","attachmentType":"agglomerate","attachmentDataformat":"zarr3"});
    let finish_attachment = format!("/datasets/{mirrored}/finishAttachmentUploadToPath");
    assert_eq!(
        call(
            &application,
            "POST",
            &finish_attachment,
            Some(&fixture.token),
            Some(attachment.clone())
        )
        .await
        .0,
        StatusCode::OK
    );
    let summary: Vec<(String, String)> = store
        .take()
        .iter()
        .map(|c| (c.0.clone(), c.1.clone()))
        .collect();
    assert_eq!(
        summary,
        [
            (
                "POST".to_owned(),
                format!(
                    "/data/datasets/measureUsedStorage/{}?token=rpc-secret",
                    fixture.organization_id
                )
            ),
            (
                "DELETE".to_owned(),
                format!("/data/datasets/{mirrored}?token=rpc-secret")
            ),
            (
                "POST".to_owned(),
                "/data/datasets/writeMirrors?token=rpc-secret&failOnError=true".to_owned()
            ),
        ]
    );
    let rows: Vec<(String, i64)> = sqlx::query_as("SELECT name,usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _dataset=$1")
        .bind(&mirrored).fetch_all(&db.pool).await.unwrap();
    assert_eq!(rows, [("agg".to_owned(), 100)]);
    assert_eq!(
        call(
            &application,
            "POST",
            &finish_attachment,
            Some(&fixture.token),
            Some(attachment)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    server.abort();
    db.cleanup().await;
}
