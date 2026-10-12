mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, dataset_remote,
    service_clients::{ServiceClientConfig, ServiceClients},
};

#[derive(Clone)]
struct StoreState {
    requests: Arc<Mutex<Vec<String>>>,
    response: Arc<Mutex<(StatusCode, Value)>>,
}

async fn find_data(State(state): State<StoreState>, request: Request) -> Response {
    state
        .requests
        .lock()
        .unwrap()
        .push(request.uri().to_string());
    let (status, value) = state.response.lock().unwrap().clone();
    (status, Json(value)).into_response()
}

async fn upstream() -> (String, StoreState, tokio::task::JoinHandle<()>) {
    let state = StoreState {
        requests: Arc::new(Mutex::new(Vec::new())),
        response: Arc::new(Mutex::new((StatusCode::OK, json!({"position":[1,2,3]})))),
    };
    let router = Router::new()
        .route("/data/datasets/{id}/layers/{name}/findData", get(find_data))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (base, state, task)
}

async fn seed(db: &TestDb, fixture: &Fixture, base: &str) -> String {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,onlyAllowedOrganization) VALUES ('remote-store',$1,'http://public.invalid','store-key-secret',$2)")
        .bind(base).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey,sharingToken) SELECT $1,'remote-store',_id,_rootFolder,'Remote','Remote',true,ROW(1,1,1)::webknossos.VECTOR3,NOW(),'dataset-share' FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    for name in ["z-later", "a-first"] {
        sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,$2,'color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'wkw')")
            .bind(&id).bind(name).execute(&db.pool).await.unwrap();
    }
    id
}

fn app(db: &TestDb) -> Router {
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(2),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 4096,
        rpc_token: "process-rpc-secret".to_owned(),
    })
    .unwrap();
    dataset_remote::router()
        .layer(Extension(clients))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
) -> (StatusCode, Value, String) {
    let mut builder = axum::http::Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8(bytes.to_vec()).unwrap()))
    };
    (status, body, content_type)
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn health_uses_real_private_service_and_rpc_token_after_sharing_aware_access() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, upstream_state, server) = upstream().await;
    let id = seed(&db, &fixture, &base).await;
    let application = app(&db);
    let path = format!("/datasets/{id}/health");
    assert_eq!(
        request(&application, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert!(upstream_state.requests.lock().unwrap().is_empty());
    let (status, body, content_type) = request(
        &application,
        "GET",
        &format!("{path}?sharingToken=dataset-share"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, "Ok");
    assert!(content_type.starts_with("text/plain"));
    assert_eq!(
        upstream_state.requests.lock().unwrap().as_slice(),
        [format!(
            "/data/datasets/{id}/layers/a-first/findData?token=process-rpc-secret"
        )]
    );
    *upstream_state.response.lock().unwrap() = (StatusCode::OK, json!({"position":null}));
    assert_eq!(
        request(&application, "GET", &path, Some(&fixture.token))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    *upstream_state.response.lock().unwrap() = (
        StatusCode::FORBIDDEN,
        json!({"error":"secret upstream body"}),
    );
    let (status, error, _) = request(&application, "GET", &path, Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(!error.to_string().contains("secret"));
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    let calls = upstream_state.requests.lock().unwrap().len();
    assert_eq!(
        request(&application, "GET", &path, Some(&fixture.token))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(upstream_state.requests.lock().unwrap().len(), calls);
    sqlx::query("UPDATE webknossos.datasets SET isDeleted=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("{path}?sharingToken=dataset-share"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn storage_details_and_cache_clear_have_exact_shapes_and_permissions() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let (base, _, server) = upstream().await;
    let id = seed(&db, &fixture, &base).await;
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
        .bind(&id)
        .bind(&fixture.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    // usedStorage rows reference real mags/attachments (FKs mags_ref, attachments_ref).
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'a-first',ROW(1,2,4)::webknossos.VECTOR3,'private/mag')")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'a-first','mesh-file','private/mesh','mesh','hdf5')")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_mags (_dataset,layerName,mag,path,_organization,usedStorageBytes,lastUpdated) VALUES ($1,'a-first',ROW(1,2,4)::webknossos.VECTOR3,'private/mag',$2,42,'2020-01-01')")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_attachments (_dataset,layerName,name,path,type,_organization,usedStorageBytes,lastUpdated) VALUES ($1,'a-first','mesh-file','private/mesh','mesh',$2,55,'2020-01-01')")
        .bind(&id).bind(&fixture.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_thumbnails (_dataset,dataLayerName,width,height,mappingName,image,mag,mag1BoundingBox) VALUES ($1,'',10,10,'',decode('010203','hex'),ROW(1,1,1)::webknossos.VECTOR3,ROW(0,0,0,10,10,1)::webknossos.BOUNDING_BOX)")
        .bind(&id).execute(&db.pool).await.unwrap();
    let application = app(&db);
    let storage = format!("/datasets/{id}/usedStorageDetails");
    assert_eq!(
        request(&application, "GET", &storage, Some(&member.token))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, details, _) = request(&application, "GET", &storage, Some(&fixture.token)).await;
    assert_eq!(status, StatusCode::OK, "{details}");
    assert_eq!(
        details,
        json!([
            {"layerName":"a-first","name":"1-2-4","usedStorageBytes":42,"lastUpdated":1577836800000_i64},
            {"layerName":"a-first","name":"mesh-file","attachmentType":"mesh","usedStorageBytes":55,"lastUpdated":1577836800000_i64}
        ])
    );
    let clear = format!("/datasets/{id}/clearThumbnailCache");
    assert_eq!(
        request(&application, "PUT", &clear, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&application, "PUT", &clear, Some(&member.token))
            .await
            .0,
        StatusCode::OK
    );
    let (count,version):(i64,i32)=sqlx::query_as("SELECT (SELECT count(*) FROM webknossos.dataset_thumbnails WHERE _dataset=$1),thumbnailCacheVersion FROM webknossos.datasets WHERE _id=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!((count, version), (0, 1));
    let foreign = db.fixture().await;
    assert_eq!(
        request(&application, "PUT", &clear, Some(&foreign.token))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &application,
            "PUT",
            &format!("/datasets/{}/clearThumbnailCache", object_id()),
            Some(&fixture.token)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&application, "GET", &storage, Some(&fixture.token))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    server.abort();
    db.cleanup().await;
}
