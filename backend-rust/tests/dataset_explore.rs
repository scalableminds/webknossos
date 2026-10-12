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
    dataset_explore::{self, DatastoreTokenConfig},
    service_clients::{ServiceClientConfig, ServiceClients},
};

#[derive(Clone, Default)]
struct Store {
    calls: Arc<Mutex<Vec<(String, Value)>>>,
    explored: Arc<Mutex<Value>>,
}

async fn datastore(State(store): State<Store>, request: Request) -> Response {
    let uri = request.uri().to_string();
    let path = request.uri().path().to_owned();
    let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    store.calls.lock().unwrap().push((uri, body.clone()));
    match path.as_str() {
        "/data/datasets/exploreRemote" => {
            Json(store.explored.lock().unwrap().clone()).into_response()
        }
        "/data/datasets/validatePaths" => Json(json!(
            body.as_array()
                .unwrap()
                .iter()
                .map(|p| json!({"path": p, "valid": !p.as_str().unwrap().contains("forbidden")}))
                .collect::<Vec<_>>()
        ))
        .into_response(),
        "/data/datasets/writeMirrors" => Json(json!([[body[0], "/mirror"]])).into_response(),
        _ => StatusCode::OK.into_response(),
    }
}

fn source(path: &str) -> Value {
    json!({"id": {"name": "remote", "team": "org"}, "scale": {"factor": [1, 1, 1], "unit": "nanometer"},
        "dataLayers": [{"name": "img", "category": "color", "dataFormat": "zarr", "elementClass": "uint8",
            "boundingBox": {"topLeft": [0, 0, 0], "width": 5, "height": 5, "depth": 5},
            "mags": [{"mag": [1, 1, 1], "path": path}]}]})
}

async fn post(app: &Router, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(path)
        .header("x-auth-token", token)
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

fn error(body: &Value) -> &str {
    body["messages"][0]["error"].as_str().unwrap_or_default()
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn explore_add_virtual_and_duplicate_create_datasets_through_the_datastore() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let store = Store::default();
    *store.explored.lock().unwrap() =
        json!({"dataSource": source("s3://bucket/a.zarr/0"), "report": "Found 1 layer"});
    let mock = Router::new().fallback(datastore).with_state(store.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store',$1,'http://public.invalid','k')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let app = dataset_explore::router(DatastoreTokenConfig {
        expiry: Duration::from_secs(3600),
        idle_timeout: Duration::from_secs(3600),
    })
    .layer(Extension(
        ServiceClients::new(ServiceClientConfig {
            request_timeout: Duration::from_secs(5),
            connect_timeout: Duration::from_secs(1),
            max_response_bytes: 1 << 20,
            rpc_token: "rpc".into(),
        })
        .unwrap(),
    ))
    .with_state(AppState {
        pool: db.pool.clone(),
    });

    // exploreRemote: credentials stored, datastore called with a fresh user DataStore token.
    let (status, body) = post(&app, "/datasets/exploreRemote", &fixture.token, json!([{"remoteUri": "s3://bucket/a.zarr/.zattrs", "credentialIdentifier": "key", "credentialSecret": "secret"}])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["report"], "Found 1 layer");
    let (credential_id, name, user): (String, String, String) =
        sqlx::query_as("SELECT _id,name,_user FROM webknossos.credentials")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (name.as_str(), user.as_str()),
        ("s3://bucket/a.zarr/", fixture.user_id.as_str())
    );
    let (uri, sent) = store.calls.lock().unwrap().remove(0);
    let token = uri
        .strip_prefix("/data/datasets/exploreRemote?token=")
        .unwrap()
        .to_owned();
    let token_user: String = sqlx::query_scalar(
        "SELECT _user FROM webknossos.tokens WHERE value=$1 AND tokenType='DataStore'",
    )
    .bind(&token)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(token_user, fixture.user_id);
    assert_eq!(
        sent,
        json!({"layerParameters": [{"remoteUri": "s3://bucket/a.zarr/.zattrs", "credentialId": credential_id}], "organizationId": fixture.organization_id})
    );
    let (status, body) = post(
        &app,
        "/datasets/exploreRemote",
        &fixture.token,
        json!([{"remoteUri": "a"}, {"remoteUri": "b", "dataStoreName": "store"}]),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (StatusCode::BAD_REQUEST, "Received invalid URI: a")
    );
    let (status, body) = post(
        &app,
        "/datasets/exploreRemote",
        &fixture.token,
        json!([{"remoteUri": "s3://a"}, {"remoteUri": "s3://b", "dataStoreName": "store"}]),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "All layers must be on the same data store for exploration."
        )
    );

    // exploreAndAddRemote with a folder path that is created below the root.
    let add = json!({"remoteUri": "s3://bucket/a.zarr", "datasetName": "explored", "folderPath": "/Test root/new/sub"});
    let (status, body) = post(
        &app,
        "/datasets/exploreAndAddRemote",
        &fixture.token,
        add.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body.as_str().unwrap().to_owned();
    let (creation, folder_name, path, uploader): (String, String, String, Option<String>) = sqlx::query_as("SELECT d.creationType::text,f.name,m.path,d._uploader FROM webknossos.datasets d JOIN webknossos.folders f ON f._id=d._folder JOIN webknossos.dataset_mags m ON m._dataset=d._id WHERE d._id=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        (
            creation.as_str(),
            folder_name.as_str(),
            path.as_str(),
            uploader.as_deref()
        ),
        (
            "ExploreAndAdd",
            "sub",
            "s3://bucket/a.zarr/0",
            Some(fixture.user_id.as_str())
        )
    );
    let (status, body) = post(
        &app,
        "/datasets/exploreAndAddRemote",
        &fixture.token,
        add.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let folders: i64 =
        sqlx::query_scalar("SELECT count(*) FROM webknossos.folders WHERE name IN ('new','sub')")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(folders, 2);
    let mut bad_folder = add.clone();
    bad_folder["folderPath"] = json!("/Wrong root/x");
    let (status, body) = post(
        &app,
        "/datasets/exploreAndAddRemote",
        &fixture.token,
        bad_folder,
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Could not get or create folder during dataset exploration."
        )
    );
    *store.explored.lock().unwrap() =
        json!({"dataSource": source("/forbidden/local"), "report": ""});
    let (status, body) = post(
        &app,
        "/datasets/exploreAndAddRemote",
        &fixture.token,
        add.clone(),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Cannot directly add a data source with local paths that leave the dataset, or with paths that match the WEBKNOSSOS reserved paths."
        )
    );
    *store.explored.lock().unwrap() = json!({"report": "nothing found"});
    let (status, body) = post(&app, "/datasets/exploreAndAddRemote", &fixture.token, add).await;
    assert_eq!(
        (status, error(&body)),
        (StatusCode::BAD_REQUEST, "Could not explore remote dataset.")
    );

    // addVirtualDataset: team managers, admins and dataset managers only.
    let registration = json!({"dataSource": source("s3://bucket/b"), "dataStoreName": "store", "importUrl": "https://import.test/b"});
    let member = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    assert_eq!(
        post(
            &app,
            "/datasets/addVirtualDataset/virtual_ds",
            &member.token,
            registration.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut unknown = registration.clone();
    unknown["dataStoreName"] = json!("missing");
    assert_eq!(
        post(
            &app,
            "/datasets/addVirtualDataset/virtual_ds",
            &fixture.token,
            unknown
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (status, body) = post(
        &app,
        "/datasets/addVirtualDataset/virtual_ds",
        &fixture.token,
        registration,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let virtual_id = body["newDatasetId"].as_str().unwrap().to_owned();
    let (import_url, directory): (Option<String>, String) =
        sqlx::query_as("SELECT importURL,directoryName FROM webknossos.datasets WHERE _id=$1")
            .bind(&virtual_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (import_url.as_deref(), directory),
        (
            Some("https://import.test/b"),
            format!("virtual_ds-{virtual_id}")
        )
    );

    // duplicateToOrga: superusers only, virtual datasets only.
    let target = db.fixture().await;
    let duplicate = format!(
        "/datasets/{virtual_id}/duplicateToOrga?targetOrganizationId={}",
        target.organization_id
    );
    let (status, body) = post(&app, &duplicate, &fixture.token, json!({})).await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::FORBIDDEN,
            "This route is only allowed for super users."
        )
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=true WHERE _id=$1")
        .bind(&fixture.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.datasets SET description='desc', metadata='[{\"key\":\"k\",\"type\":\"string\",\"value\":\"v\"}]' WHERE _id=$1")
        .bind(&virtual_id).execute(&db.pool).await.unwrap();
    let (status, body) = post(&app, &duplicate, &fixture.token, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let copy = body.as_str().unwrap().to_owned();
    let row: (String, String, Option<String>, String, String, i64) = sqlx::query_as("SELECT d._organization,d.name,d.description,d.creationType::text,d.directoryName,(SELECT count(*) FROM webknossos.dataset_mags WHERE _dataset=d._id) FROM webknossos.datasets d WHERE d._id=$1")
        .bind(&copy).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        row,
        (
            target.organization_id.clone(),
            "virtual_ds".to_owned(),
            Some("desc".to_owned()),
            "DuplicateToOrga".to_owned(),
            format!("virtual_ds-{copy}"),
            1
        )
    );
    let bad = format!("/datasets/{virtual_id}/duplicateToOrga?targetOrganizationId=missing");
    assert_eq!(
        post(&app, &bad, &fixture.token, json!({})).await.0,
        StatusCode::BAD_REQUEST
    );
    server.abort();
    db.cleanup().await;
}
