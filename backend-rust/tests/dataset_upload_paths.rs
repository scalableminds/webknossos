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
    dataset_options::DatasetRouteConfig,
    dataset_upload_paths,
    service_clients::{ServiceClientConfig, ServiceClients},
};

type Calls = Arc<Mutex<Vec<(String, Value)>>>;

async fn datastore(State(calls): State<Calls>, request: Request) -> Response {
    let uri = request.uri().to_string();
    let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    calls.lock().unwrap().push((uri, body));
    Json(json!([])).into_response()
}

struct Setup {
    db: TestDb,
    fixture: Fixture,
    calls: Calls,
    app: Router,
    server: tokio::task::JoinHandle<()>,
}

async fn setup() -> Setup {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let calls = Calls::default();
    let mock = Router::new().fallback(datastore).with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store',$1,'http://public.invalid','k')")
        .bind(&base).execute(&db.pool).await.unwrap();
    let mut config = DatasetRouteConfig::default();
    config.upload_to_paths.prefixes = vec!["/srv/wk".into(), "s3://bucket/wk".into()];
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap();
    let app = dataset_upload_paths::router(config)
        .layer(Extension(clients))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    Setup {
        db,
        fixture,
        calls,
        app,
        server,
    }
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

async fn seed_dataset(
    db: &TestDb,
    fixture: &Fixture,
    virtual_: bool,
    status: &str,
    usable: bool,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,isVirtual,status,voxelSizeFactor,sortingKey,_uploader) SELECT $1,'store',_id,_rootFolder,$1,$1,$4,$3,$5,ROW(1,1,1)::webknossos.VECTOR3,NOW(),$6 FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(virtual_).bind(usable).bind(status).bind(&fixture.user_id)
        .execute(&db.pool).await.unwrap();
    for (name, category, class) in [
        ("color", "color", "uint8"),
        ("seg", "segmentation", "uint32"),
    ] {
        sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,$4::webknossos.DATASET_LAYER_ELEMENT_CLASS,ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
            .bind(&id).bind(name).bind(category).bind(class).execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,$2,ROW(1,1,1)::webknossos.VECTOR3,$3)")
            .bind(&id).bind(name).bind(format!("/srv/other/{id}/{name}/1")).execute(&db.pool).await.unwrap();
    }
    id
}

fn new_source() -> Value {
    json!({
        "id": {"name": "ignored", "team": "ignored"},
        "scale": {"factor": [4, 4, 40], "unit": "nanometer"},
        "dataLayers": [
            {"name": "color", "category": "color", "dataFormat": "zarr3", "elementClass": "uint8",
             "boundingBox": {"topLeft": [0, 0, 0], "width": 64, "height": 64, "depth": 8},
             "mags": [{"mag": [1, 1, 1]}, {"mag": [2, 2, 1]}]},
            {"name": "seg", "category": "segmentation", "dataFormat": "zarr3", "elementClass": "uint32",
             "boundingBox": {"topLeft": [0, 0, 0], "width": 64, "height": 64, "depth": 8},
             "mags": [{"mag": 1}], "largestSegmentId": 7,
             "attachments": {"meshes": [{"name": "Mesh ä", "path": "x", "dataFormat": "hdf5"}],
                             "segmentIndex": {"name": "si", "path": "y", "dataFormat": "zarr3"}}}
        ]
    })
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn reserve_upload_to_paths_creates_pending_virtual_dataset_with_generated_paths() {
    let Setup {
        db,
        fixture,
        calls,
        app,
        server,
    } = setup().await;
    let linked = seed_dataset(&db, &fixture, false, "", true).await;
    let base = json!({
        "datasetName": "new_ds", "dataSource": new_source(),
        "layersToLink": [{"datasetId": linked, "layerName": "color", "newLayerName": "linked"}],
        "initialTeamIds": [fixture.team_id]
    });
    let path = "/datasets/reserveUploadToPaths";
    let with = |key: &str, value: Value| {
        let mut body = base.clone();
        body[key] = value;
        body
    };
    let (status, body) = post(
        &app,
        path,
        &fixture.token,
        with("datasetName", json!("x y")),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Dataset name is invalid. Please use only letters, digits, dots, underscores, hyphens."
        )
    );
    let (status, body) = post(
        &app,
        path,
        &fixture.token,
        with("pathPrefix", json!("/not/configured")),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Could not determine a configured path prefix that matches the request."
        )
    );
    let mut empty = new_source();
    empty["dataLayers"] = json!([]);
    let (status, body) = post(&app, path, &fixture.token, with("dataSource", empty)).await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Cannot reserve upload for dataset with no layers."
        )
    );
    let foreign = db.fixture().await;
    let (status, body) = post(
        &app,
        path,
        &fixture.token,
        with("initialTeamIds", json!([foreign.team_id])),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Can only assign teams the requesting user is in."
        )
    );
    let (status, _) = post(
        &app,
        path,
        &fixture.token,
        with(
            "layersToLink",
            json!([{"datasetId": linked, "layerName": "missing"}]),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.datasets")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);

    let (status, body) = post(&app, path, &fixture.token, base.clone()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["newDatasetId"].as_str().unwrap().to_owned();
    let directory = format!("new_ds-{id}");
    assert_eq!(
        body["dataSource"]["id"],
        json!({"name": directory, "team": fixture.organization_id})
    );
    let prefix = format!("/srv/wk/{}/.virtual/{directory}", fixture.organization_id);
    let layers = body["dataSource"]["dataLayers"].as_array().unwrap();
    assert_eq!(layers.len(), 2);
    assert_eq!(
        layers[0]["mags"],
        json!([{"mag": [1, 1, 1], "path": format!("{prefix}/color/1")}, {"mag": [2, 2, 1], "path": format!("{prefix}/color/2-2-1")}])
    );
    assert_eq!(
        layers[1]["attachments"]["meshes"][0]["path"],
        format!("{prefix}/seg/meshes/Mesh ae.hdf5")
    );
    assert_eq!(
        layers[1]["attachments"]["segmentIndex"]["path"],
        format!("{prefix}/seg/segmentIndex/si")
    );
    let row: (String, bool, bool, String, String, Option<String>, String) = sqlx::query_as("SELECT status,isUsable,isVirtual,creationType::text,_dataStore,_uploader,directoryName FROM webknossos.datasets WHERE _id=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        row,
        (
            "Not yet marked as fully uploaded to paths.".into(),
            false,
            true,
            "UploadToPaths".into(),
            "store".into(),
            Some(fixture.user_id.clone()),
            directory.clone()
        )
    );
    let layer_names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM webknossos.dataset_layers WHERE _dataset=$1 ORDER BY name",
    )
    .bind(&id)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(layer_names, ["color", "linked", "seg"]);
    let linked_path: String = sqlx::query_scalar(
        "SELECT path FROM webknossos.dataset_mags WHERE _dataset=$1 AND dataLayerName='linked'",
    )
    .bind(&id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(linked_path, format!("/srv/other/{linked}/color/1"));
    let teams: Vec<String> =
        sqlx::query_scalar("SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=$1")
            .bind(&id)
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(teams, std::slice::from_ref(&fixture.team_id));

    let (status, body) = post(
        &app,
        path,
        &fixture.token,
        with("requireUniqueName", json!(true)),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            StatusCode::BAD_REQUEST,
            "Dataset name “new_ds” is already taken."
        )
    );
    sqlx::query("UPDATE webknossos.organizations SET includedStorage = -1 WHERE _id=$1")
        .bind(&fixture.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        post(&app, path, &fixture.token, base).await.0,
        StatusCode::FORBIDDEN
    );
    assert!(calls.lock().unwrap().is_empty());
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn preliminary_mag_and_attachment_reservations_enforce_pending_rules() {
    let Setup {
        db,
        fixture,
        calls,
        app,
        server,
    } = setup().await;
    let uploading = seed_dataset(&db, &fixture, false, "Not yet fully uploaded.", false).await;
    let other = db
        .seed_user(&object_id(), &fixture.organization_id, true)
        .await;
    let preliminary = format!("/datasets/{uploading}/reserveUploadToPathsForPreliminary");
    let body = json!({"dataSource": new_source(), "pathPrefix": "s3://bucket/wk"});
    let (status, response) = post(&app, &preliminary, &other.token, body.clone()).await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "Cannot reserve paths for a dataset someone else uploaded."
        )
    );
    let (status, response) = post(&app, &preliminary, &fixture.token, body.clone()).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(
        response["dataSource"]["statusOpt"],
        "Not yet fully uploaded."
    );
    assert_eq!(response["dataSource"]["id"]["name"], uploading);
    assert_eq!(
        response["dataSource"]["dataLayers"][0]["mags"][0]["path"],
        format!(
            "s3://bucket/wk/{}/.virtual/{uploading}/color/1",
            fixture.organization_id
        )
    );
    let (usable, unit, mags): (bool, String, i64) = sqlx::query_as("SELECT isUsable,voxelSizeUnit::text,(SELECT count(*) FROM webknossos.dataset_mags WHERE _dataset=$1) FROM webknossos.datasets WHERE _id=$1")
        .bind(&uploading).fetch_one(&db.pool).await.unwrap();
    assert_eq!((usable, unit.as_str(), mags), (false, "nanometer", 3));
    sqlx::query("UPDATE webknossos.datasets SET status='' WHERE _id=$1")
        .bind(&uploading)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, response) = post(&app, &preliminary, &fixture.token, body).await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "Dataset is not in uploading status, got ."
        )
    );

    // Mags: only for virtual datasets, conflicts unless overwritePending.
    let disk = seed_dataset(&db, &fixture, false, "", true).await;
    let mag = json!({"layerName": "color", "mag": [2, 2, 1], "overwritePending": false, "axisOrder": {"x": 1, "y": 2, "z": 3}});
    let (status, response) = post(
        &app,
        &format!("/datasets/{disk}/reserveMagUploadToPath"),
        &fixture.token,
        mag.clone(),
    )
    .await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "Adding mags to existing datasets is only allowed for virtual datasets."
        )
    );
    let dataset = seed_dataset(&db, &fixture, true, "", true).await;
    let reserve_mag = format!("/datasets/{dataset}/reserveMagUploadToPath");
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
        .bind(&dataset)
        .bind(&fixture.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        post(&app, &reserve_mag, &member.token, mag.clone()).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, first) = post(&app, &reserve_mag, &fixture.token, mag.clone()).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let first = first.as_str().unwrap().to_owned();
    let expected_prefix = format!(
        "/srv/wk/{}/.virtual/{dataset}/color/2-2-1__",
        fixture.organization_id
    );
    assert!(
        first.starts_with(&expected_prefix) && first.len() == expected_prefix.len() + 16,
        "{first}"
    );
    let (status, response) = post(&app, &reserve_mag, &fixture.token, mag.clone()).await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "Conflict with existing pending mag. Pass overwritePending to overwrite."
        )
    );
    let mut overwrite = mag.clone();
    overwrite["overwritePending"] = json!(true);
    let (status, second) = post(&app, &reserve_mag, &fixture.token, overwrite).await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(second.as_str().unwrap(), first);
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        [(
            "/data/datasets/deletePaths?token=rpc-secret".to_owned(),
            json!([first])
        )]
    );
    let pending: Vec<(String, bool, Value)> = sqlx::query_as("SELECT path,uploadToPathIsPending,axisOrder FROM webknossos.dataset_mags WHERE _dataset=$1 AND dataLayerName='color' AND (mag).x=2")
        .bind(&dataset).fetch_all(&db.pool).await.unwrap();
    assert_eq!(
        pending,
        [(
            second.as_str().unwrap().to_owned(),
            true,
            json!({"x": 1, "y": 2, "z": 3})
        )]
    );

    // Attachments: singleton types and names must be free, pending ones conflict.
    let reserve_attachment = format!("/datasets/{dataset}/reserveAttachmentUploadToPath");
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'seg','si','/a','segmentIndex','hdf5'),($1,'seg','taken','/b','mesh','hdf5')")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    let attachment = |name: &str, typ: &str| json!({"layerName": "seg", "attachmentName": name, "attachmentType": typ, "attachmentDataformat": "hdf5"});
    let (status, response) = post(
        &app,
        &reserve_attachment,
        &fixture.token,
        attachment("other", "segmentIndex"),
    )
    .await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "There is already an attachment of this type in this layer. Only one attachment of this type can be registered per layer."
        )
    );
    let (status, response) = post(
        &app,
        &reserve_attachment,
        &fixture.token,
        attachment("taken", "mesh"),
    )
    .await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "An attachment with this name already exists in this layer. Please choose a different name."
        )
    );
    let (status, response) = post(
        &app,
        &reserve_attachment,
        &fixture.token,
        attachment("new mesh", "mesh"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(
        response,
        json!(format!(
            "/srv/wk/{}/.virtual/{dataset}/seg/meshes/new mesh.hdf5",
            fixture.organization_id
        ))
    );
    let (status, response) = post(
        &app,
        &reserve_attachment,
        &fixture.token,
        attachment("new mesh", "mesh"),
    )
    .await;
    assert_eq!(
        (status, error(&response)),
        (
            StatusCode::BAD_REQUEST,
            "Conflict with existing pending attachment. Pass overwritePending to overwrite."
        )
    );
    let mut overwrite = attachment("new mesh", "mesh");
    overwrite["overwritePending"] = json!(true);
    assert_eq!(
        post(&app, &reserve_attachment, &fixture.token, overwrite)
            .await
            .0,
        StatusCode::OK
    );
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.dataset_layer_attachments WHERE _dataset=$1 AND uploadToPathIsPending")
        .bind(&dataset).fetch_one(&db.pool).await.unwrap();
    assert_eq!(pending, 1);
    server.abort();
    db.cleanup().await;
}
