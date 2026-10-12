//! POST /tasks/createFromFiles (TaskController.createFromFiles) against a real
//! database and a mock tracing store that records every RPC.
mod common;

use std::{
    io::{Cursor, Write},
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use prost::Message;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    proto::{
        AnnotationLayerTypeProto, AnnotationProto,
        datastore::{SkeletonTracingsWithIds, VolumeTracing},
    },
    router,
};
use zip::write::SimpleFileOptions;

const NOT_FOUND: &str = "Could not find or access the requested resource.";
const BOUNDARY: &str = "wkTaskBoundary7MA4YWxk";

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

enum Part<'a> {
    Data(&'a str, String),
    File(&'a str, Vec<u8>),
}

fn multipart(parts: &[Part]) -> Vec<u8> {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        match part {
            Part::Data(name, value) => {
                body.extend_from_slice(
                    format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                        .as_bytes(),
                );
            }
            Part::File(file_name, bytes) => {
                body.extend_from_slice(
                    format!(
                        "Content-Disposition: form-data; name=\"nmlFile\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
                    )
                    .as_bytes(),
                );
                body.extend_from_slice(bytes);
                body.extend_from_slice(b"\r\n");
            }
        }
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

async fn send(
    app: &Router,
    token: Option<&str>,
    content_type: &str,
    body: Vec<u8>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/tasks/createFromFiles")
        .header(header::CONTENT_TYPE, content_type);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn upload(app: &Router, token: &str, parts: &[Part<'_>]) -> (StatusCode, Value) {
    send(
        app,
        Some(token),
        &format!("multipart/form-data; boundary={BOUNDARY}"),
        multipart(parts),
    )
    .await
}

fn form(task_type: &str, project: &str) -> Value {
    json!({
        "taskTypeId": task_type,
        "neededExperience": {"domain": "nml", "value": 1},
        "pendingInstances": 3,
        "projectName": project,
    })
}

fn form_part(value: &Value) -> Part<'static> {
    Part::Data("formJSON", value.to_string())
}

const TASK_BOX: &str = r#"<taskBoundingBox topLeftX="1" topLeftY="2" topLeftZ="3" width="40" height="50" depth="60"/>"#;
const VOLUME: &str = r#"<volume id="1" location="data_Volume.zip" name="Volume"/>"#;

/// An NML on `dataset` (by id) with one two-node tree, edit position 5,6,7,
/// rotation 0,45,0, description `description`, extra parameter elements
/// (e.g. [`TASK_BOX`]) and extra top-level elements (e.g. [`VOLUME`]).
fn nml(dataset: &str, description: &str, params: &str, extra: &str) -> Vec<u8> {
    format!(
        r#"<things><parameters><experiment name="Dataset" datasetId="{dataset}" description="{description}"/><editPosition x="5" y="6" z="7"/><editRotation xRot="0" yRot="45" zRot="0"/>{params}</parameters><thing id="3" name="uploaded tree"><nodes><node id="11" x="5" y="6" z="7"/><node id="12" x="8" y="9" z="10"/></nodes><edges><edge source="11" target="12"/></edges></thing>{extra}</things>"#
    )
    .into_bytes()
}

fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

// ---------------------------------------------------------------------------
// Mock tracing store
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Call {
    path: String,
    query: Vec<(String, String)>,
    content_type: Option<String>,
    body: Vec<u8>,
}

impl Call {
    fn param(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }
    fn paths(&self) -> Vec<String> {
        self.calls().into_iter().map(|c| c.path).collect()
    }
    fn with_path(&self, suffix: &str) -> Vec<Call> {
        self.calls()
            .into_iter()
            .filter(|c| c.path.ends_with(suffix))
            .collect()
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned());
    let body = to_bytes(request.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    mock.calls.lock().unwrap().push(Call {
        path: path.clone(),
        query,
        content_type,
        body: body.clone(),
    });
    if path.ends_with("/saveMultiple") {
        let request = SkeletonTracingsWithIds::decode(body.as_slice()).unwrap();
        let answer: Vec<Value> = request
            .tracings
            .iter()
            .map(|t| match &t.tracing {
                Some(_) => json!({"status":"Full","value":true}),
                None => json!({"status":"Empty"}),
            })
            .collect();
        return axum::Json(answer).into_response();
    }
    StatusCode::OK.into_response()
}

async fn mock_tracing_store() -> (String, Mock) {
    let mock = Mock::default();
    let router = Router::new()
        .route("/{*path}", any(mock_handler))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), mock)
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

struct World {
    f: Fixture,
    /// Team manager of team A (the dataset's team and Project-A's team).
    manager: UserFixture,
    /// Plain member of team A.
    member: UserFixture,
    /// Same organization, no team.
    outsider: UserFixture,
    /// Admin of another organization.
    foreign: UserFixture,
    dataset: String,
    skeleton_type: String,
    volume_type: String,
    hybrid_type: String,
    mock: Mock,
    app: Router,
}

async fn add_role(db: &TestDb, user: &str, team: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
    )
    .bind(user)
    .bind(team)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn add_task_type(
    db: &TestDb,
    organization: &str,
    team: &str,
    tracing_type: &str,
    mag_min: Option<i32>,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed,tracingType,settings_magRestrictions_min) VALUES($1,$2,$3,$4,'',true,true,$4::webknossos.TASKTYPE_TRACINGTYPES,$5)")
        .bind(&id).bind(organization).bind(team).bind(tracing_type).bind(mag_min)
        .execute(&db.pool).await.unwrap();
    id
}

async fn world(db: &TestDb) -> World {
    let (url, mock) = mock_tracing_store().await;
    let f = db.fixture().await;
    let org = f.organization_id.clone();
    let manager = db.seed_user(&object_id(), &org, false).await;
    let member = db.seed_user(&object_id(), &org, false).await;
    let outsider = db.seed_user(&object_id(), &org, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    add_role(db, &manager.user_id, &f.team_id, true).await;
    add_role(db, &member.user_id, &f.team_id, false).await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('task-ds','http://127.0.0.1:9','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('task-ts',$1,'https://trace.example.test','k')")
        .bind(&url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,isPublic,voxelSizeFactor,voxelSizeUnit) SELECT $1,'task-ds',_id,_rootfolder,'Dataset','dir',now(),true,false,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&org).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES($1,'color','color'::webknossos.DATASET_LAYER_CATEGORY,'uint8'::webknossos.DATASET_LAYER_ELEMENT_CLASS,ROW(0,0,0,100,200,50)::webknossos.BOUNDING_BOX,'wkw')")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    for mag in [1, 2, 4] {
        sqlx::query("INSERT INTO webknossos.dataset_mags(_dataset,dataLayerName,mag,path) VALUES($1,'color',ROW($2,$2,$2)::webknossos.vector3,$3)")
            .bind(&dataset).bind(mag).bind(format!("color/{mag}"))
            .execute(&db.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Project-A')")
        .bind(object_id()).bind(&org).bind(&f.team_id).bind(&f.user_id)
        .execute(&db.pool).await.unwrap();
    let skeleton_type = add_task_type(db, &org, &f.team_id, "skeleton", None).await;
    let volume_type = add_task_type(db, &org, &f.team_id, "volume", None).await;
    let hybrid_type = add_task_type(db, &org, &f.team_id, "hybrid", Some(2)).await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    World {
        f,
        manager,
        member,
        outsider,
        foreign,
        dataset,
        skeleton_type,
        volume_type,
        hybrid_type,
        mock,
        app,
    }
}

async fn count(db: &TestDb, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&db.pool).await.unwrap()
}

/// (tasks, TracingBase annotations).
async fn totals(db: &TestDb) -> (i64, i64) {
    (
        count(db, "SELECT count(*) FROM webknossos.tasks").await,
        count(
            db,
            "SELECT count(*) FROM webknossos.annotations WHERE typ='TracingBase'",
        )
        .await,
    )
}

/// (boundingBox, editPosition, editRotation, creationInfo, pending, domain).
async fn task_row(
    db: &TestDb,
    id: &str,
) -> (Option<String>, String, String, Option<String>, i64, String) {
    sqlx::query_as("SELECT CASE WHEN t.boundingBox IS NULL THEN NULL ELSE concat_ws(',',(t.boundingBox).x,(t.boundingBox).y,(t.boundingBox).z,(t.boundingBox).width,(t.boundingBox).height,(t.boundingBox).depth) END,
        concat_ws(',',(t.editPosition).x,(t.editPosition).y,(t.editPosition).z),
        concat_ws(',',(t.editRotation).x,(t.editRotation).y,(t.editRotation).z), t.creationInfo, t.pendingInstances, t.neededExperience_domain
        FROM webknossos.tasks t WHERE t._id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

/// TracingBase of a task: (id, description, layers (tracingId, typ, name)).
async fn base_of(db: &TestDb, task: &str) -> (String, String, Vec<(String, String, String)>) {
    let (id, description): (String, String) = sqlx::query_as(
        "SELECT _id,description FROM webknossos.annotations WHERE _task=$1 AND typ='TracingBase'",
    )
    .bind(task)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let layers = sqlx::query_as("SELECT tracingId,typ::text,name FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY typ")
        .bind(&id).fetch_all(&db.pool).await.unwrap();
    (id, description, layers)
}

fn items(body: &Value) -> &Vec<Value> {
    body["tasks"].as_array().unwrap()
}

fn task_ids(body: &Value) -> Vec<String> {
    items(body)
        .iter()
        .filter(|t| t["status"] == 200)
        .map(|t| t["success"]["id"].as_str().unwrap().to_owned())
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn one_nml_creates_one_task_with_the_uploaded_skeleton_as_base() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&form(&w.skeleton_type, "Project-A")),
            Part::File("readme.txt", b"not an annotation".to_vec()),
            Part::File(
                "Tracing.NML",
                nml(&w.dataset, "Uploaded description", TASK_BOX, ""),
            ),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["warnings"], json!([]));
    assert_eq!(items(&body).len(), 1);
    let task = &items(&body)[0];
    assert_eq!(task["status"], 200, "{task}");
    assert_eq!(task["success"]["projectName"], "Project-A");
    assert_eq!(task["success"]["datasetId"], json!(w.dataset));
    assert_eq!(task["success"]["type"]["id"], json!(w.skeleton_type));
    assert_eq!(task["success"]["creationInfo"], "Tracing.NML");
    assert_eq!(
        task["success"]["status"],
        json!({"pending":3,"active":0,"finished":0})
    );
    // The NML's task bounding box becomes the task box.
    assert_eq!(
        task["success"]["boundingBox"],
        json!({"topLeft":[1,2,3],"width":40,"height":50,"depth":60})
    );
    let id = &task_ids(&body)[0];
    assert_eq!(
        task_row(&db, id).await,
        (
            Some("1,2,3,40,50,60".into()),
            "5,6,7".into(),
            "0,45,0".into(),
            Some("Tracing.NML".into()),
            3,
            "nml".into()
        )
    );

    assert_eq!(
        w.mock.paths(),
        [
            "/tracings/skeleton/saveMultiple",
            "/tracings/annotation/save"
        ]
    );
    let save = &w.mock.with_path("/saveMultiple")[0];
    let saved = SkeletonTracingsWithIds::decode(save.body.as_slice()).unwrap();
    assert_eq!(saved.tracings.len(), 1);
    // The uploaded skeleton is the base (not a fresh one-node base).
    let skeleton = saved.tracings[0].tracing.as_ref().unwrap();
    assert_eq!(skeleton.trees.len(), 1);
    assert_eq!(skeleton.trees[0].name, "uploaded tree");
    assert_eq!(skeleton.trees[0].nodes.len(), 2);
    assert_eq!(skeleton.dataset_name, "Dataset");
    assert_eq!(skeleton.edit_position.y, 6);
    let tracing_id = saved.tracing_id[0].string_value.clone().unwrap();
    let (base_id, description, layers) = base_of(&db, id).await;
    assert_eq!(description, "Uploaded description");
    assert_eq!(
        layers,
        [(tracing_id.clone(), "Skeleton".into(), "Skeleton".into())]
    );
    let proto_call = &w.mock.with_path("/annotation/save")[0];
    assert_eq!(proto_call.param("annotationId"), Some(base_id.as_str()));
    let proto = AnnotationProto::decode(proto_call.body.as_slice()).unwrap();
    assert_eq!(proto.annotation_layers.len(), 1);
    assert_eq!(proto.annotation_layers[0].tracing_id, tracing_id);
    assert_eq!(totals(&db).await, (1, 1));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn zip_with_several_nmls_creates_several_tasks_and_failed_files_become_items() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let archive = zip(&[
        ("first.nml", &nml(&w.dataset, "one", TASK_BOX, "")),
        ("sub/second.nml", &nml(&w.dataset, "two", "", "")),
        ("notes.txt", b"ignored"),
    ]);
    let unknown = object_id();
    // The form box overrides the parsed task bounding boxes.
    let mut params = form(&w.skeleton_type, "Project-A");
    params["boundingBox"] = json!({"topLeft": [7, 8, 9], "width": 1, "height": 2, "depth": 3});
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&params),
            Part::File("batch.zip", archive),
            Part::File("broken.nml", b"<things><parameters>".to_vec()),
            Part::File("unknown.nml", nml(&unknown, "", "", "")),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = items(&body);
    assert_eq!(results.len(), 4, "{body}");
    // One zip's NMLs come out in reverse entry order (Scala prepends).
    assert_eq!(results[0]["success"]["creationInfo"], "sub/second.nml");
    assert_eq!(results[1]["success"]["creationInfo"], "first.nml");
    for item in &results[..2] {
        assert_eq!(item["status"], 200, "{item}");
        assert_eq!(
            item["success"]["boundingBox"],
            json!({"topLeft":[7,8,9],"width":1,"height":2,"depth":3})
        );
    }
    assert_eq!(results[2]["status"], 400);
    let broken = results[2]["error"].as_str().unwrap();
    assert!(
        broken.starts_with("Couldn’t parse file: broken.nml. "),
        "{broken}"
    );
    assert_eq!(
        results[3],
        json!({"status": 400, "error": format!("Couldn’t parse file: unknown.nml. Dataset “{unknown}” could not be found or accessed.")})
    );
    let ids = task_ids(&body);
    let (_, first_description, _) = base_of(&db, &ids[0]).await;
    let (_, second_description, _) = base_of(&db, &ids[1]).await;
    assert_eq!(
        (first_description.as_str(), second_description.as_str()),
        ("two", "one")
    );

    // saveMultiple carries one entry per item, empty for the failed files.
    let saved =
        SkeletonTracingsWithIds::decode(w.mock.with_path("/saveMultiple")[0].body.as_slice())
            .unwrap();
    assert_eq!(saved.tracings.len(), 4);
    assert!(saved.tracings[0].tracing.is_some() && saved.tracings[1].tracing.is_some());
    assert!(saved.tracings[2].tracing.is_none() && saved.tracings[3].tracing.is_none());
    assert_eq!(w.mock.with_path("/annotation/save").len(), 2);
    assert_eq!(totals(&db).await, (2, 2));

    // Only failing files: every item is a failure, no RPC, no rows.
    w.mock.clear();
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&form(&w.skeleton_type, "Project-A")),
            Part::File("broken.nml", b"<things>".to_vec()),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["warnings"], json!([]));
    assert_eq!(items(&body).len(), 1);
    assert_eq!(body["tasks"][0]["status"], 400);
    assert!(w.mock.calls().is_empty());
    assert_eq!(totals(&db).await, (2, 2));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn volume_layers_with_data_zips_are_forwarded_as_initial_data() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let data = b"PK fake volume data".to_vec();
    // Volume task type: the uploaded volume (no task box → data source box)
    // with its data zip; the skeleton is dropped.
    let archive = zip(&[
        ("volume.nml", &nml(&w.dataset, "vol", "", VOLUME)),
        ("data_Volume.zip", &data),
    ]);
    let multi_layer = nml(
        &w.dataset,
        "",
        "",
        r#"<volume id="1" location="a.zip" name="A"/><volume id="2" location="b.zip" name="B"/>"#,
    );
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&form(&w.volume_type, "Project-A")),
            Part::File("upload.zip", archive),
            Part::File("multi.nml", multi_layer),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(items(&body)[0]["status"], 200, "{body}");
    assert_eq!(
        items(&body)[1],
        json!({"status": 400, "error": "Cannot create tasks from multi-layer volume annotations."})
    );
    // No form box and no parsed task box: the task has no bounding box.
    assert_eq!(items(&body)[0]["success"]["boundingBox"], Value::Null);
    let id = &task_ids(&body)[0];
    let saves = w.mock.with_path("/tracings/volume/save");
    assert_eq!(saves.len(), 1);
    let tracing_id = saves[0].param("newTracingId").unwrap().to_owned();
    let volume = VolumeTracing::decode(saves[0].body.as_slice()).unwrap();
    let bbox = volume.bounding_box;
    // addVolumeFallbackBoundingBoxes: the data source box.
    assert_eq!(
        (bbox.top_left.x, bbox.width, bbox.height, bbox.depth),
        (0, 100, 200, 50)
    );
    assert_eq!(volume.dataset_name, "Dataset");
    assert_eq!((volume.edit_position.x, volume.edit_position.z), (5, 7));
    let (base_id, description, layers) = base_of(&db, id).await;
    assert_eq!(description, "vol");
    assert_eq!(
        layers,
        [(tracing_id.clone(), "Volume".into(), "Volume".into())]
    );
    let initial = w.mock.with_path("/initialData");
    assert_eq!(initial.len(), 1);
    assert_eq!(
        initial[0].path,
        format!("/tracings/volume/{tracing_id}/initialData")
    );
    // Scala quirk kept: volume data goes to the task parameters'
    // newAnnotationId (also sent in saveMultiple), not the TracingBase id.
    let saved =
        SkeletonTracingsWithIds::decode(w.mock.with_path("/saveMultiple")[0].body.as_slice())
            .unwrap();
    assert!(saved.tracings[0].tracing.is_none());
    let new_annotation_id = saved.annotation_id[0].string_value.clone().unwrap();
    assert_eq!(
        initial[0].param("annotationId"),
        Some(new_annotation_id.as_str())
    );
    assert_ne!(new_annotation_id, base_id);
    assert_eq!(initial[0].param("minMag"), None);
    assert_eq!(
        initial[0].content_type.as_deref(),
        Some("application/octet-stream")
    );
    assert_eq!(initial[0].body, data);
    let proto =
        AnnotationProto::decode(w.mock.with_path("/annotation/save")[0].body.as_slice()).unwrap();
    assert_eq!(
        proto
            .annotation_layers
            .iter()
            .map(|l| l.typ)
            .collect::<Vec<_>>(),
        [AnnotationLayerTypeProto::Volume as i32]
    );

    // Hybrid task type: uploaded skeleton + volume with data (minMag from the
    // task type), and a skeleton-only NML that gets a fresh volume base.
    w.mock.clear();
    let archive = zip(&[
        ("hybrid.nml", &nml(&w.dataset, "", TASK_BOX, VOLUME)),
        ("data_Volume.zip", &data),
    ]);
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&form(&w.hybrid_type, "Project-A")),
            Part::File("hybrid.zip", archive),
            Part::File("plain.nml", nml(&w.dataset, "", "", "")),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(items(&body).iter().all(|t| t["status"] == 200), "{body}");
    let saves = w.mock.with_path("/tracings/volume/save");
    assert_eq!(saves.len(), 2);
    let uploaded = VolumeTracing::decode(saves[0].body.as_slice()).unwrap();
    // The parsed task box is kept for the uploaded volume.
    assert_eq!(
        (
            uploaded.bounding_box.top_left.x,
            uploaded.bounding_box.width
        ),
        (1, 40)
    );
    let fresh = VolumeTracing::decode(saves[1].body.as_slice()).unwrap();
    assert_eq!(fresh.segments.len(), 0);
    assert!(fresh.mags.iter().all(|m| m.x >= 2), "{:?}", fresh.mags);
    let initial = w.mock.with_path("/initialData");
    assert_eq!(initial.len(), 1, "only the uploaded volume has data");
    assert_eq!(
        initial[0].path,
        format!(
            "/tracings/volume/{}/initialData",
            saves[0].param("newTracingId").unwrap()
        )
    );
    assert_eq!(initial[0].param("minMag"), Some("2"));
    assert_eq!(initial[0].body, data);
    let saved =
        SkeletonTracingsWithIds::decode(w.mock.with_path("/saveMultiple")[0].body.as_slice())
            .unwrap();
    let uploaded_skeleton = saved.tracings[0].tracing.as_ref().unwrap();
    assert_eq!(uploaded_skeleton.trees[0].name, "uploaded tree");
    let plain_skeleton = saved.tracings[1].tracing.as_ref().unwrap();
    assert_eq!(plain_skeleton.trees[0].nodes.len(), 2);
    for id in task_ids(&body) {
        let (_, _, layers) = base_of(&db, &id).await;
        let types: Vec<&str> = layers.iter().map(|l| l.1.as_str()).collect();
        assert_eq!(types, ["Skeleton", "Volume"]);
    }

    // Volume task type with a skeleton-only NML: nothing to save.
    w.mock.clear();
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&form(&w.volume_type, "Project-A")),
            Part::File("plain.nml", nml(&w.dataset, "", "", "")),
        ],
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Each task needs to either be skeleton or volume.")
        )
    );
    assert!(w.mock.calls().is_empty());

    // Hybrid task type: any failed file fails the whole request
    // (fillInMissingTracings uses Fox.serialCombined).
    let (status, body) = upload(
        &w.app,
        &w.manager.token,
        &[
            form_part(&form(&w.hybrid_type, "Project-A")),
            Part::File("plain.nml", nml(&w.dataset, "", "", "")),
            Part::File("broken.nml", b"<things><parameters>".to_vec()),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let message = body["messages"][0]["error"].as_str().unwrap();
    assert!(
        message.starts_with("Couldn’t parse file: broken.nml. "),
        "{message}"
    );
    assert!(w.mock.calls().is_empty());
    assert_eq!(totals(&db).await, (3, 3));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn invalid_requests_and_permission_failures_create_nothing() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let file = || Part::File("a.nml", nml(&w.dataset, "", "", ""));
    let valid = form(&w.skeleton_type, "Project-A");
    let unknown_type = object_id();

    // 401 before anything else.
    let (status, _) = send(
        &w.app,
        None,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
        multipart(&[form_part(&valid), file()]),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // Not a multipart body.
    let (status, body) = send(
        &w.app,
        Some(&w.manager.token),
        "application/json",
        valid.to_string().into_bytes(),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Could not parse task creation multipart request.")
        )
    );
    let cases: Vec<(&UserFixture, Vec<Part>, StatusCode, String)> = vec![
        // No .nml/.zip file (checked before formJSON).
        (
            &w.manager,
            vec![Part::File("a.txt", b"x".to_vec())],
            StatusCode::BAD_REQUEST,
            "Could not extract NML file.".into(),
        ),
        (
            &w.manager,
            vec![file()],
            StatusCode::BAD_REQUEST,
            "Could not parse task creation multipart request: no form data.".into(),
        ),
        (
            &w.manager,
            vec![Part::Data("formJSON", "{not json".into()), file()],
            StatusCode::BAD_REQUEST,
            "Could not create task.".into(),
        ),
        (
            &w.manager,
            vec![
                Part::Data(
                    "formJSON",
                    json!({"taskTypeId": w.skeleton_type}).to_string(),
                ),
                file(),
            ],
            StatusCode::BAD_REQUEST,
            "Could not create task.".into(),
        ),
        // Task type unknown / not readable (no team, other organization).
        (
            &w.manager,
            vec![form_part(&form(&unknown_type, "Project-A")), file()],
            StatusCode::NOT_FOUND,
            format!("Task type “{unknown_type}” could not be found or accessed."),
        ),
        (
            &w.outsider,
            vec![form_part(&valid), file()],
            StatusCode::NOT_FOUND,
            format!(
                "Task type “{}” could not be found or accessed.",
                w.skeleton_type
            ),
        ),
        (
            &w.foreign,
            vec![form_part(&valid), file()],
            StatusCode::NOT_FOUND,
            format!(
                "Task type “{}” could not be found or accessed.",
                w.skeleton_type
            ),
        ),
        (
            &w.manager,
            vec![form_part(&form(&w.skeleton_type, "Nope")), file()],
            StatusCode::NOT_FOUND,
            "Project with name “Nope” could not be found or accessed.".into(),
        ),
        // Team member without manager rights: Fox.assertTrue → empty.
        (
            &w.member,
            vec![form_part(&valid), file()],
            StatusCode::NOT_FOUND,
            NOT_FOUND.into(),
        ),
        // Volume batch limit counts uploaded files.
        (
            &w.manager,
            std::iter::once(form_part(&form(&w.volume_type, "Project-A")))
                .chain((0..101).map(|_| Part::File("v.nml", b"<things/>".to_vec())))
                .collect(),
            StatusCode::BAD_REQUEST,
            "Cannot create more than 100 tasks in one request.".into(),
        ),
    ];
    for (user, parts, expected_status, message) in cases {
        let (status, body) = upload(&w.app, &user.token, &parts).await;
        assert_eq!((status, body), (expected_status, error(&message)));
    }
    assert!(w.mock.calls().is_empty());
    assert_eq!(totals(&db).await, (0, 0));

    // An organization admin without team roles may create tasks.
    let (status, body) = upload(&w.app, &w.f.token, &[form_part(&valid), file()]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(items(&body)[0]["status"], 200, "{body}");
    assert_eq!(totals(&db).await, (1, 1));
    db.cleanup().await;
}
