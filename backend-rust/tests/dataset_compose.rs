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
    AppState, dataset_compose,
    service_clients::{ServiceClientConfig, ServiceClients},
};

type Calls = Arc<Mutex<Vec<(String, String)>>>;

async fn datastore(State(calls): State<Calls>, request: Request) -> Response {
    calls.lock().unwrap().push((
        request.method().to_string(),
        request.uri().path().to_owned(),
    ));
    if request.uri().path() == "/data/datasets/writeMirrors" {
        let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
        let ids: Vec<String> = serde_json::from_slice(&bytes).unwrap();
        return Json(json!([[ids[0], "/mirror"]])).into_response();
    }
    StatusCode::OK.into_response()
}

async fn seed(db: &TestDb, fixture: &Fixture, factor: f64, is_virtual: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,isVirtual,voxelSizeFactor,sortingKey) SELECT $1,'store',_id,_rootFolder,$1,$1,true,$3,ROW($4,$4,$4)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(is_virtual).bind(factor)
        .execute(&db.pool).await.unwrap();
    for (name, category, class) in [
        ("color", "color", "uint8"),
        ("seg", "segmentation", "uint32"),
    ] {
        sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,$4::webknossos.DATASET_LAYER_ELEMENT_CLASS,ROW(1,2,3,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
            .bind(&id).bind(name).bind(category).bind(class).execute(&db.pool).await.unwrap();
    }
    for mag in [1, 2] {
        sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'color',ROW($2,$2,$2)::webknossos.VECTOR3,$3)")
            .bind(&id).bind(f64::from(mag)).bind(format!("s3://data/{id}/color/{mag}"))
            .execute(&db.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'seg',ROW(1,1,1)::webknossos.VECTOR3,$2)")
        .bind(&id).bind(format!("s3://data/{id}/seg/1")).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'seg','m',$2,'mesh','hdf5')")
        .bind(&id).bind(format!("s3://data/{id}/seg/m.hdf5")).execute(&db.pool).await.unwrap();
    id
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

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn compose_and_in_place_additions_build_virtual_datasets() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let calls = Calls::default();
    let mock = Router::new().fallback(datastore).with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store',$1,'http://public.invalid','k')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let app = dataset_compose::router()
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
    let fine = seed(&db, &fixture, 4.0, false).await;
    let coarse = seed(&db, &fixture, 8.0, true).await;
    let root: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id=$1")
            .bind(&fixture.organization_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let request = |layers: Value| json!({"newDatasetName": "composed", "targetFolderId": root, "organizationId": "ignored", "voxelSize": [4, 4, 4], "layers": layers});

    let (status, body) = post(
        &app,
        "/datasets/compose",
        &fixture.token,
        request(json!([])),
    )
    .await;
    assert_eq!(
        (status, body["messages"][0]["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("Could not compose dataset."))
    );
    let foreign = db.fixture().await;
    let layers = json!([{"sourceDatasetId": fine, "sourceLayerName": "color", "targetLayerName": "c1"},
                        {"sourceDatasetId": coarse, "sourceLayerName": "color", "targetLayerName": "c1"}]);
    assert_eq!(
        post(
            &app,
            "/datasets/compose",
            &foreign.token,
            request(layers.clone())
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, body) = post(&app, "/datasets/compose", &fixture.token, request(layers)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let composed = body["newDatasetId"].as_str().unwrap().to_owned();
    // Differing voxel sizes without explicit transforms are rescaled to 4 nm.
    let rows: Vec<(String, i32, i32, String)> = sqlx::query_as("SELECT l.name,(m.mag).x::int,(l.boundingBox).width::int,m.path FROM webknossos.dataset_layers l JOIN webknossos.dataset_mags m ON m._dataset=l._dataset AND m.dataLayerName=l.name WHERE l._dataset=$1 ORDER BY l.name,(m.mag).x")
        .bind(&composed).fetch_all(&db.pool).await.unwrap();
    assert_eq!(
        rows,
        [
            ("c1".to_owned(), 1, 10, format!("s3://data/{fine}/color/1")),
            ("c1".to_owned(), 2, 10, format!("s3://data/{fine}/color/2")),
            (
                "c1_2".to_owned(),
                2,
                20,
                format!("s3://data/{coarse}/color/1")
            ),
            (
                "c1_2".to_owned(),
                4,
                20,
                format!("s3://data/{coarse}/color/2")
            ),
        ]
    );
    let meta: (String, bool, bool, Option<String>, String, f64, String) = sqlx::query_as("SELECT creationType::text,isVirtual,isUsable,_uploader,_folder,(voxelSizeFactor).x,directoryName FROM webknossos.datasets WHERE _id=$1")
        .bind(&composed).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        meta,
        (
            "Compose".into(),
            true,
            true,
            Some(fixture.user_id.clone()),
            root.clone(),
            4.0,
            format!("composed-{composed}")
        )
    );
    assert_eq!(
        calls.lock().unwrap().drain(..).collect::<Vec<_>>(),
        [("POST".to_owned(), "/data/datasets/writeMirrors".to_owned())]
    );

    // Explicit transformations: no rescaling, transformations appended.
    let transformed = json!([{"sourceDatasetId": coarse, "sourceLayerName": "color", "targetLayerName": "t",
        "transformations": [{"type": "affine", "matrix": [[2,0,0,0],[0,2,0,0],[0,0,2,0],[0,0,0,1]]}]}]);
    let (status, body) = post(
        &app,
        "/datasets/compose",
        &fixture.token,
        request(transformed),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["newDatasetId"].as_str().unwrap();
    let (transforms, factor): (i64, f64) = sqlx::query_as("SELECT (SELECT count(*) FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset=$1),(voxelSizeFactor).x FROM webknossos.datasets WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap();
    assert_eq!((transforms, factor), (1, 4.0));
    calls.lock().unwrap().clear();

    // In-place additions on the virtual composed dataset.
    let add_layer = format!("/datasets/{composed}/compose/addLayer");
    let (status, body) = post(
        &app,
        &add_layer,
        &fixture.token,
        json!({"sourceDatasetId": coarse, "sourceLayerName": "seg", "targetLayerName": "c1"}),
    )
    .await;
    assert_eq!(
        (status, body["messages"][0]["error"].as_str()),
        (
            StatusCode::BAD_REQUEST,
            Some("Could not add layer to composed dataset.")
        )
    );
    assert_eq!(
        post(
            &app,
            &format!("/datasets/{fine}/compose/addLayer"),
            &fixture.token,
            json!({"sourceDatasetId": coarse, "sourceLayerName": "seg", "targetLayerName": "x"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
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
    sqlx::query(
        "INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2),($3,$2)",
    )
    .bind(&composed)
    .bind(&fixture.team_id)
    .bind(&coarse)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        post(
            &app,
            &add_layer,
            &member.token,
            json!({"sourceDatasetId": coarse, "sourceLayerName": "seg", "targetLayerName": "seg2"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post(
            &app,
            &add_layer,
            &fixture.token,
            json!({"sourceDatasetId": coarse, "sourceLayerName": "seg", "targetLayerName": "seg2"})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        calls.lock().unwrap().drain(..).collect::<Vec<_>>(),
        [("DELETE".to_owned(), format!("/data/datasets/{composed}"))]
    );

    let add_mag = format!("/datasets/{composed}/compose/addMag");
    assert_eq!(post(&app, &add_mag, &fixture.token, json!({"sourceDatasetId": fine, "sourceLayerName": "color", "targetLayerName": "c1_2", "sourceMag": [2, 2, 2]})).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(post(&app, &add_mag, &fixture.token, json!({"sourceDatasetId": fine, "sourceLayerName": "color", "targetLayerName": "c1_2", "sourceMag": [2, 2, 2], "targetMag": [1, 1, 1]})).await.0, StatusCode::OK);
    let mags: Vec<(i32, String)> = sqlx::query_as("SELECT (mag).x::int,path FROM webknossos.dataset_mags WHERE _dataset=$1 AND dataLayerName='c1_2' ORDER BY (mag).x")
        .bind(&composed).fetch_all(&db.pool).await.unwrap();
    assert_eq!(mags[0], (1, format!("s3://data/{fine}/color/2")));
    assert_eq!(mags.len(), 3);

    let add_attachment = format!("/datasets/{composed}/compose/addAttachment");
    let attachment = json!({"sourceDatasetId": fine, "sourceLayerName": "seg", "targetLayerName": "seg2", "attachmentType": "mesh", "sourceAttachmentName": "m", "targetAttachmentName": "m-copy"});
    assert_eq!(
        post(&app, &add_attachment, &fixture.token, attachment.clone())
            .await
            .0,
        StatusCode::OK
    );
    let (status, body) = post(&app, &add_attachment, &fixture.token, attachment).await;
    assert_eq!(
        (status, body["messages"][0]["error"].as_str()),
        (
            StatusCode::BAD_REQUEST,
            Some("Could not add attachment to composed dataset.")
        )
    );
    let names: Vec<String> = sqlx::query_scalar("SELECT name FROM webknossos.dataset_layer_attachments WHERE _dataset=$1 AND layerName='seg2' ORDER BY name")
        .bind(&composed).fetch_all(&db.pool).await.unwrap();
    assert_eq!(names, ["m", "m-copy"]);
    server.abort();
    db.cleanup().await;
}
