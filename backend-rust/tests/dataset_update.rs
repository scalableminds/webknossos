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
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::{MiscConfig, MiscState},
    dataset_update,
    service_clients::{ServiceClientConfig, ServiceClients},
};

#[derive(Clone, Default)]
struct Store {
    calls: Arc<Mutex<Vec<(String, String, Value)>>>,
    fail_put: Arc<Mutex<bool>>,
}

impl Store {
    fn take(&self) -> Vec<(String, String, Value)> {
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
        ("PUT", _) if *store.fail_put.lock().unwrap() => {
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        ("DELETE", "/data/datasets/deletePaths") => Json(body).into_response(),
        ("POST", "/data/datasets/writeMirrors") => {
            Json(json!([[body[0], "/mirror"]])).into_response()
        }
        _ => StatusCode::OK.into_response(),
    }
}

async fn setup() -> (TestDb, Fixture, Store, Router, tokio::task::JoinHandle<()>) {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let store = Store::default();
    let mock = Router::new().fallback(datastore).with_state(store.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store',$1,'http://public.invalid','k')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap();
    // Analytics side effects stay local (no forwarding URI).
    let mut misc = MiscConfig::default();
    misc.analytics.uri.clear();
    let app = dataset_update::router(false)
        .layer(Extension(clients))
        .layer(Extension(MiscState::new(misc)))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    (db, fixture, store, app, server)
}

async fn seed(db: &TestDb, fixture: &Fixture, is_virtual: bool, root: Option<&str>) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,isVirtual,rootPath,voxelSizeFactor,sortingKey,description,tags,defaultViewConfiguration) SELECT $1,'store',_id,_rootFolder,'Original',$1,true,$3,$4,ROW(1,1,1)::webknossos.VECTOR3,'2020-01-01','old description','{x}','{\"zoom\":3}' FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(is_virtual).bind(root)
        .execute(&db.pool).await.unwrap();
    for (name, category) in [("color", "color"), ("seg", "segmentation")] {
        sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat,largestSegmentId,mappings) VALUES ($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,'uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3',CASE WHEN $3='segmentation' THEN 5 END,CASE WHEN $3='segmentation' THEN '{agg}'::text[] END)")
            .bind(&id).bind(name).bind(category).execute(&db.pool).await.unwrap();
    }
    for (layer, mag) in [("color", 1), ("color", 2), ("seg", 1)] {
        sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,$2,ROW($3,$3,$3)::webknossos.VECTOR3,$4)")
            .bind(&id).bind(layer).bind(f64::from(mag)).bind(format!("s3://managed/{id}/{layer}/{mag}"))
            .execute(&db.pool).await.unwrap();
    }
    for (name, typ) in [("m1", "mesh"), ("a1", "agglomerate")] {
        sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'seg',$2,$3,$4::webknossos.LAYER_ATTACHMENT_TYPE,'hdf5')")
            .bind(&id).bind(name).bind(format!("s3://managed/{id}/seg/{name}")).bind(typ)
            .execute(&db.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataset_thumbnails (_dataset,dataLayerName,width,height,mappingName,image,mag,mag1BoundingBox) VALUES ($1,'',1,1,'','\\x00',ROW(1,1,1)::webknossos.VECTOR3,ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX)")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

async fn patch(app: &Router, id: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut builder = axum::http::Request::builder()
        .method("PATCH")
        .uri(format!("/datasets/{id}/updatePartial"))
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn layer(name: &str, category: &str, mags: &[i32]) -> Value {
    json!({"name": name, "category": category, "dataFormat": "zarr3", "elementClass": "uint8",
        "boundingBox": {"topLeft": [0, 0, 0], "width": 10, "height": 10, "depth": 10},
        "mags": mags.iter().map(|m| json!({"mag": [m, m, m]})).collect::<Vec<_>>()})
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn partial_fields_follow_tristate_semantics_and_permissions() {
    let (db, fixture, store, app, server) = setup().await;
    let id = seed(&db, &fixture, true, None).await;
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
    let foreign = db.fixture().await;
    assert_eq!(
        patch(&app, &id, None, json!({})).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        patch(&app, &id, Some(&foreign.token), json!({})).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        patch(&app, &id, Some(&member.token), json!({})).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, body) = patch(
        &app,
        &id,
        Some(&fixture.token),
        json!({"metadata":[{"key":"a","value":1},{"key":"a","value":2}]}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Metadata keys must be unique."
    );
    let foreign_folder: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id=$1")
            .bind(&foreign.organization_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        patch(
            &app,
            &id,
            Some(&fixture.token),
            json!({"folderId": foreign_folder})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(store.take().is_empty());

    let (status, body) = patch(&app, &id, Some(&fixture.token), json!({
        "description": null, "isPublic": true, "tags": ["t2", "t1"], "sortingKey": 1600000000000_i64,
        "metadata": [{"key": "k", "type": "string", "value": "v"}], "folderId": null
    })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["id"], id);
    assert_eq!(body["name"], "Original");
    assert_eq!(body["description"], Value::Null);
    assert_eq!(body["isPublic"], true);
    assert_eq!(body["tags"], json!(["t1", "t2"]));
    assert_eq!(body["sortingKey"], 1600000000000_i64);
    assert_eq!(
        body["metadata"],
        json!([{"key": "k", "type": "string", "value": "v"}])
    );
    assert_eq!(
        body["dataSource"]["dataLayers"].as_array().unwrap().len(),
        2
    );
    // Virtual and usable: mirror rewritten, no real-path scan for remote paths.
    let calls = store.take();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].1,
        "/data/datasets/writeMirrors?token=rpc-secret&failOnError=true"
    );
    let (status, body) = patch(&app, &id, Some(&fixture.token), json!({"name": "Renamed"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (body["name"].as_str(), body["isPublic"].as_bool()),
        (Some("Renamed"), Some(true))
    );
    let thumbnails: i64 =
        sqlx::query_scalar("SELECT count(*) FROM webknossos.dataset_thumbnails WHERE _dataset=$1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(thumbnails, 1);
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn data_source_changes_rename_drop_and_add_layers_and_queue_removed_paths() {
    let (db, fixture, store, app, server) = setup().await;
    let id = seed(&db, &fixture, true, None).await;
    let mut seg = layer("seg", "segmentation", &[1]);
    seg["largestSegmentId"] = json!(99);
    seg["attachments"] =
        json!({"meshes": [{"name": "m1", "path": "ignored", "dataFormat": "hdf5"}]});
    let mut color = layer("color2", "color", &[1]);
    color["boundingBox"]["width"] = json!(20);
    color["adminViewConfiguration"] = json!({"color": [1, 2, 3]});
    let source = |layers: Vec<Value>| json!({"id": {"name": "x", "team": "y"}, "scale": {"factor": [2, 2, 2], "unit": "micrometer"}, "dataLayers": layers});

    let mut with_mags = layer("fresh", "color", &[1]);
    with_mags["mags"] = json!([{"mag": 1}]);
    let (status, body) = patch(
        &app,
        &id,
        Some(&fixture.token),
        json!({"dataSource": source(vec![with_mags])}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "New layers may not have mags. Add empty layers instead and then add mags."
    );
    let (status, body) = patch(
        &app,
        &id,
        Some(&fixture.token),
        json!({
            "dataSource": source(vec![]), "layerRenamings": [{"oldName": "color", "newName": "seg"}]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Layer renamings create name collisions."
    );
    assert_eq!(
        patch(
            &app,
            &id,
            Some(&fixture.token),
            json!({"dataSource": {"dataLayers": []}})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(store.take().is_empty());

    let (status, body) = patch(&app, &id, Some(&fixture.token), json!({
        "dataSource": source(vec![color, seg, layer("fresh", "segmentation", &[])]),
        "layerRenamings": [{"oldName": "color", "newName": "color2"}],
        "attachmentRenamings": [{"layerName": "seg", "oldName": "m0", "attachmentType": "mesh", "newName": "unused"}]
    })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let layers = body["dataSource"]["dataLayers"].as_array().unwrap();
    let names: Vec<&str> = layers.iter().map(|l| l["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["color2", "fresh", "seg"]);
    assert_eq!(layers[0]["boundingBox"]["width"], 20);
    assert_eq!(
        layers[0]["adminViewConfiguration"],
        json!({"color": [1, 2, 3]})
    );
    assert_eq!(layers[0]["resolutions"], json!([[1, 1, 1]]));
    assert_eq!(
        layers[0]["mags"][0]["path"],
        format!("s3://managed/{id}/color/1")
    );
    assert_eq!(layers[2]["largestSegmentId"]["value"], "99");
    assert_eq!(layers[2]["mappings"], json!(["agg"]));
    assert_eq!(
        layers[2]["attachments"]["meshes"][0]["path"],
        format!("s3://managed/{id}/seg/m1")
    );
    assert_eq!(layers[2]["attachments"]["agglomerates"], json!([]));
    assert_eq!(
        body["dataSource"]["scale"],
        json!({"factor": [2, 2, 2], "unit": "micrometer"})
    );
    let calls = store.take();
    let summary: Vec<(&str, &str)> = calls.iter().map(|c| (c.0.as_str(), c.1.as_str())).collect();
    assert_eq!(
        summary,
        [
            (
                "DELETE",
                format!("/data/datasets/{id}?token=rpc-secret").as_str()
            ),
            ("DELETE", "/data/datasets/deletePaths?token=rpc-secret"),
            (
                "POST",
                "/data/datasets/writeMirrors?token=rpc-secret&failOnError=true"
            ),
        ]
    );
    assert_eq!(
        calls[1].2,
        json!([
            format!("s3://managed/{id}/color/2"),
            format!("s3://managed/{id}/seg/a1")
        ])
    );
    let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.remote_paths_to_delete")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(queued, 2);
    let (version, thumbnails, default_config): (i32, i64, Option<Value>) = sqlx::query_as("SELECT thumbnailCacheVersion,(SELECT count(*) FROM webknossos.dataset_thumbnails WHERE _dataset=$1),defaultViewConfiguration FROM webknossos.datasets WHERE _id=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        (version, thumbnails, default_config),
        (1, 0, Some(json!({"zoom": 3})))
    );

    // Re-sending the resulting source is not a change: no datastore invalidation.
    let unchanged = body["dataSource"].clone();
    let (status, _) = patch(
        &app,
        &id,
        Some(&fixture.token),
        json!({"dataSource": unchanged}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let summary: Vec<String> = store.take().into_iter().map(|c| c.1).collect();
    assert_eq!(
        summary,
        ["/data/datasets/writeMirrors?token=rpc-secret&failOnError=true"]
    );
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn disk_datasets_write_the_source_before_commit_and_roll_back_on_failure() {
    let (db, fixture, store, app, server) = setup().await;
    let id = seed(&db, &fixture, false, Some("/srv/disk")).await;
    let source = json!({"id": {"name": "x", "team": "y"}, "scale": [1, 1, 1], "dataLayers": [layer("color", "color", &[1, 2])]});
    *store.fail_put.lock().unwrap() = true;
    let (status, _) = patch(
        &app,
        &id,
        Some(&fixture.token),
        json!({"name": "Changed", "dataSource": source}),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let (name, layers): (String, i64) = sqlx::query_as("SELECT name,(SELECT count(*) FROM webknossos.dataset_layers WHERE _dataset=$1) FROM webknossos.datasets WHERE _id=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!((name.as_str(), layers), ("Original", 2));
    let calls = store.take();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].1,
        format!("/data/datasets/{id}?token=rpc-secret&rootPath=%2Fsrv%2Fdisk")
    );
    assert_eq!(calls[0].2["dataLayers"].as_array().unwrap().len(), 1);
    assert_eq!(
        calls[0].2["id"],
        json!({"name": id, "team": fixture.organization_id})
    );

    *store.fail_put.lock().unwrap() = false;
    let (status, body) = patch(
        &app,
        &id,
        Some(&fixture.token),
        json!({"name": "Changed", "dataSource": source}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["name"], "Changed");
    let summary: Vec<String> = store
        .take()
        .into_iter()
        .map(|c| format!("{} {}", c.0, c.1))
        .collect();
    assert_eq!(
        summary,
        [
            format!("PUT /data/datasets/{id}?token=rpc-secret&rootPath=%2Fsrv%2Fdisk"),
            format!("DELETE /data/datasets/{id}?token=rpc-secret"),
            "DELETE /data/datasets/deletePaths?token=rpc-secret".to_owned(),
        ]
    );
    server.abort();
    db.cleanup().await;
}
