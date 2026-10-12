//! POST /annotations/:typ/:id/duplicate against a real database and a mock
//! tracing store recording every RPC.
mod common;

use std::sync::{Arc, Mutex};

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
    annotation_provider::ANNOTATION_NOT_FOUND,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    router,
};

const DUPLICATE_FAILED: &str = "Could not duplicate annotation.";

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

async fn post(app: &Router, token: Option<&str>, uri: &str) -> (StatusCode, Value) {
    let mut request = Request::builder().method(Method::POST).uri(uri);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// ---------------------------------------------------------------------------
// Mock tracing store
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Call {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    body_len: usize,
}

impl Call {
    fn param(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Clone, Copy, Debug)]
enum Mode {
    Ok,
    Status(u16),
    Garbage,
    /// Answer with a layer whose tracing id already exists in the database.
    CollidingLayer,
}

#[derive(Clone)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    mode: Arc<Mutex<Mode>>,
}

impl Mock {
    fn duplicate_calls(&self) -> Vec<Call> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call.path.ends_with("/duplicate"))
            .cloned()
            .collect()
    }
    fn set_mode(&self, mode: Mode) {
        *self.mode.lock().unwrap() = mode;
    }
}

fn layer(tracing_id: &str, name: &str, typ: AnnotationLayerTypeProto) -> AnnotationLayerProto {
    AnnotationLayerProto {
        tracing_id: tracing_id.into(),
        name: name.into(),
        typ: typ as i32,
    }
}

fn proto(layers: Vec<AnnotationLayerProto>) -> AnnotationProto {
    AnnotationProto {
        description: "ignored by WK".into(),
        version: 0,
        annotation_layers: layers,
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let body = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    mock.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        query: query.clone(),
        body_len: body.len(),
    });
    let new_id = query
        .iter()
        .find(|(k, _)| k == "newAnnotationId")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    let answer = if path.ends_with("/mergedFromIds") {
        proto(vec![layer(
            "merged-skeleton",
            "Skeleton",
            AnnotationLayerTypeProto::Skeleton,
        )])
    } else {
        match *mock.mode.lock().unwrap() {
            Mode::Ok => proto(vec![
                layer(
                    &format!("dup-skeleton-{new_id}"),
                    "Skeleton",
                    AnnotationLayerTypeProto::Skeleton,
                ),
                layer(
                    &format!("dup-volume-{new_id}"),
                    "Volume_1",
                    AnnotationLayerTypeProto::Volume,
                ),
            ]),
            Mode::CollidingLayer => proto(vec![
                layer(
                    &format!("dup-skeleton-{new_id}"),
                    "Skeleton",
                    AnnotationLayerTypeProto::Skeleton,
                ),
                layer(
                    "existing-tracing",
                    "Volume",
                    AnnotationLayerTypeProto::Volume,
                ),
            ]),
            Mode::Status(code) => {
                return (StatusCode::from_u16(code).unwrap(), "upstream secret body")
                    .into_response();
            }
            Mode::Garbage => {
                return (StatusCode::OK, vec![0xff_u8, 0xff, 0xff]).into_response();
            }
        }
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        answer.encode_to_vec(),
    )
        .into_response()
}

async fn mock_tracing_store() -> (String, Mock) {
    let mock = Mock {
        calls: Arc::default(),
        mode: Arc::new(Mutex::new(Mode::Ok)),
    };
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
    owner: UserFixture,
    member: UserFixture,
    foreign: UserFixture,
    dataset: String,
    task: String,
}

async fn world(db: &TestDb, tracing_url: Option<&str>) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    for user in [&owner.user_id, &member.user_id] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,false)",
        )
        .bind(user)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('dup','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    if let Some(url) = tracing_url {
        sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('dup-ts',$1,'https://trace.example.test','k')")
            .bind(url).execute(&db.pool).await.unwrap();
    }
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'dup',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    for (name, category, bbox) in [
        ("color", "color", (0, 0, 0, 100, 200, 50)),
        ("segmentation", "segmentation", (-10, 5, 0, 50, 50, 80)),
    ] {
        sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementClass,boundingBox) VALUES($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,'uint8',ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX)")
            .bind(&dataset).bind(name).bind(category)
            .bind(bbox.0).bind(bbox.1).bind(bbox.2).bind(bbox.3).bind(bbox.4).bind(bbox.5)
            .execute(&db.pool).await.unwrap();
    }
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Dup-project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Dup-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,8,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    let w = World {
        f,
        owner,
        member,
        foreign,
        dataset,
        task,
    };
    let admin = w.f.user_id.clone();
    annotation(db, &w, &admin, "TracingBase", "Internal", "Active").await;
    w
}

/// Seeds a live annotation (name/description/tags/tracingTime set) with one
/// skeleton layer `tracing-<id>`.
async fn annotation(
    db: &TestDb,
    w: &World,
    owner: &str,
    typ: &str,
    visibility: &str,
    state: &str,
) -> String {
    let id = object_id();
    let task = matches!(typ, "Task" | "TracingBase").then_some(&w.task);
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,name,description,tags,tracingTime,isLockedByOwner,created,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,'Concurrent','Name','Description',ARRAY['tag'],1234,true,TIMESTAMPTZ '2020-01-01T00:00:00Z',TIMESTAMPTZ '2020-01-02T00:00:00Z')")
        .bind(&id).bind(&w.dataset).bind(task).bind(owner).bind(typ).bind(visibility).bind(state)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{\"treeCount\":1}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

async fn annotation_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.annotations")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn layer_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.annotation_layers")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

type Row = (
    Option<String>,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    bool,
    Vec<String>,
    Option<i64>,
    bool,
);

async fn row(db: &TestDb, id: &str) -> Row {
    sqlx::query_as("SELECT _task,_user,_dataset,typ::text,state::text,visibility::text,collaborationMode::text,name||'|'||description,isLockedByOwner,tags,tracingTime,created=modified FROM webknossos.annotations WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

async fn layers(db: &TestDb, id: &str) -> Vec<(String, String, String, Value)> {
    sqlx::query_as("SELECT tracingId,typ::text,name,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY name")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

fn assert_new_id(body: &Value, call: &Call) -> String {
    let new_id = body["id"].as_str().unwrap().to_owned();
    assert_eq!(new_id.len(), 24);
    assert_eq!(call.param("newAnnotationId"), Some(new_id.as_str()));
    new_id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn duplicate_creates_explorational_owned_by_requester() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let original = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Finished",
    )
    .await;
    let before = annotation_count(&db).await;

    // A team member (not the owner) may duplicate a readable annotation.
    let uri = format!("/api/annotations/Explorational/{original}/duplicate");
    let (status, body) = post(&app, Some(&w.member.token), &uri).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let calls = mock.duplicate_calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.method, "POST");
    assert_eq!(call.body_len, 0);
    assert_eq!(
        call.path,
        format!("/tracings/annotation/{original}/duplicate")
    );
    let keys: Vec<&str> = call.query.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        keys,
        [
            "token",
            "newAnnotationId",
            "isFromTask",
            "ownerId",
            "requestingUserId"
        ]
    );
    assert!(!call.param("token").unwrap().is_empty());
    assert_eq!(call.param("isFromTask"), Some("false"));
    assert_eq!(call.param("ownerId"), Some(w.owner.user_id.as_str()));
    assert_eq!(
        call.param("requestingUserId"),
        Some(w.member.user_id.as_str())
    );
    let new_id = assert_new_id(&body, call);
    assert_ne!(new_id, original);

    // Response: publicWrites of the NEW annotation.
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["name"], "");
    assert_eq!(body["description"], "Description");
    assert_eq!(body["visibility"], "Internal");
    assert_eq!(body["collaborationMode"], "OwnerOnly");
    assert_eq!(body["isLockedByOwner"], false);
    assert_eq!(body["tracingTime"], Value::Null);
    assert_eq!(body["tags"], json!(["Dataset"]));
    assert_eq!(body["teams"], json!([]));
    assert_eq!(body["task"], Value::Null);
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(body["owner"]["id"], w.member.user_id.as_str());
    assert_eq!(body["created"], body["modified"]);
    assert_eq!(
        body["annotationLayers"],
        json!([
            {"tracingId": format!("dup-skeleton-{new_id}"), "typ": "Skeleton", "name": "Skeleton", "stats": {}},
            {"tracingId": format!("dup-volume-{new_id}"), "typ": "Volume", "name": "Volume_1", "stats": {}},
        ])
    );
    // Restrictions are those of the ORIGINAL annotation for the requester
    // (member, not owner: may read, not update/finish).
    assert_eq!(body["restrictions"]["allowAccess"], true);
    assert_eq!(body["restrictions"]["allowUpdate"], false);
    assert_eq!(body["restrictions"]["allowFinish"], false);
    assert!(body.get("messages").is_none());

    // Database rows.
    assert_eq!(annotation_count(&db).await, before + 1);
    let (task, user, dataset, typ, state, visibility, mode, name_desc, locked, tags, time, same) =
        row(&db, &new_id).await;
    assert_eq!(task, None);
    assert_eq!(user, w.member.user_id);
    assert_eq!(dataset, w.dataset);
    assert_eq!(
        (
            typ.as_str(),
            state.as_str(),
            visibility.as_str(),
            mode.as_str()
        ),
        ("Explorational", "Active", "Internal", "OwnerOnly")
    );
    assert_eq!(name_desc, "|Description");
    assert!(!locked);
    assert!(tags.is_empty());
    assert_eq!(time, None);
    assert!(same);
    assert_eq!(
        layers(&db, &new_id).await,
        vec![
            (
                format!("dup-skeleton-{new_id}"),
                "Skeleton".into(),
                "Skeleton".into(),
                json!({})
            ),
            (
                format!("dup-volume-{new_id}"),
                "Volume".into(),
                "Volume_1".into(),
                json!({})
            ),
        ]
    );
    // The original is untouched.
    assert_eq!(row(&db, &original).await.1, w.owner.user_id);
    assert_eq!(layers(&db, &original).await.len(), 1);

    // The owner duplicating their own annotation via the `View` alias.
    let (status, body) = post(
        &app,
        Some(&w.owner.token),
        &format!("/api/v12/annotations/View/{original}/duplicate"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["owner"]["id"], w.owner.user_id.as_str());
    // Original is Finished and locked: the owner may read, not update.
    assert_eq!(body["restrictions"]["allowAccess"], true);
    assert_eq!(body["restrictions"]["allowUpdate"], false);
    assert_eq!(mock.duplicate_calls().len(), 2);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn duplicating_task_annotation_sends_data_source_box() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let instance = annotation(&db, &w, &w.owner.user_id, "Task", "Internal", "Active").await;

    let (status, body) = post(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/Task/{instance}/duplicate"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let call = mock.duplicate_calls().pop().unwrap();
    let keys: Vec<&str> = call.query.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        keys,
        [
            "token",
            "newAnnotationId",
            "datasetBoundingBox",
            "isFromTask",
            "ownerId",
            "requestingUserId"
        ]
    );
    // Union of (0,0,0,100,200,50) and (-10,5,0,50,50,80).
    assert_eq!(call.param("datasetBoundingBox"), Some("-10,0,0,110,200,80"));
    assert_eq!(call.param("isFromTask"), Some("true"));
    assert_eq!(call.param("ownerId"), Some(w.owner.user_id.as_str()));
    assert_eq!(call.param("requestingUserId"), Some(w.f.user_id.as_str()));
    let new_id = assert_new_id(&body, &call);
    // The copy is a task-less Explorational owned by the requester.
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["task"], Value::Null);
    let (task, user, _, typ, ..) = row(&db, &new_id).await;
    assert_eq!(
        (task, user, typ.as_str()),
        (None, w.f.user_id.clone(), "Explorational")
    );

    // Task annotation on a dataset without voxel size: data source not found
    // (404) before any RPC; nothing inserted.
    sqlx::query("UPDATE webknossos.datasets SET voxelSizeFactor=NULL WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let before = annotation_count(&db).await;
    let (status, body) = post(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/Task/{instance}/duplicate"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(DUPLICATE_FAILED))
    );
    assert_eq!(mock.duplicate_calls().len(), 1);
    // A non-task annotation on the same dataset does not need the data source.
    let explorational =
        annotation(&db, &w, &w.f.user_id, "Explorational", "Internal", "Active").await;
    let (status, _) = post(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/Explorational/{explorational}/duplicate"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(annotation_count(&db).await, before + 2);

    // Unusable dataset: 400 duplicateFailed, no RPC.
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post(
        &app,
        Some(&w.f.token),
        &format!("/api/annotations/Explorational/{explorational}/duplicate"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(DUPLICATE_FAILED))
    );
    assert_eq!(mock.duplicate_calls().len(), 2);
    assert_eq!(annotation_count(&db).await, before + 2);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn inaccessible_annotations_are_not_found() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let private = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Private",
        "Active",
    )
    .await;
    let internal = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
    )
    .await;
    let before = annotation_count(&db).await;

    // Unauthenticated: 401.
    let (status, _) = post(
        &app,
        None,
        &format!("/api/annotations/Explorational/{internal}/duplicate"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // Private annotation of another user, foreign organization admin, unknown id.
    for (token, id) in [
        (&w.member.token, private.as_str()),
        (&w.foreign.token, internal.as_str()),
        (&w.member.token, "aaaaaaaaaaaaaaaaaaaaaaaa"),
    ] {
        let (status, body) = post(
            &app,
            Some(token),
            &format!("/api/annotations/Explorational/{id}/duplicate"),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
        );
    }
    // Invalid (case-sensitive) type: 404 with the parse failure.
    let (status, body) = post(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/explorational/{internal}/duplicate"),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::NOT_FOUND,
            error("Invalid AnnotationType: explorational")
        )
    );
    // Invalid object id: 400.
    let (status, _) = post(
        &app,
        Some(&w.owner.token),
        "/api/annotations/Explorational/not-an-id/duplicate",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Cancelled annotations are not excluded by Scala (no state check).
    sqlx::query("UPDATE webknossos.annotations SET state='Cancelled' WHERE _id=$1")
        .bind(&internal)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(mock.duplicate_calls().is_empty());
    assert_eq!(annotation_count(&db).await, before);
    let (status, _) = post(
        &app,
        Some(&w.owner.token),
        &format!("/api/annotations/Explorational/{internal}/duplicate"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn failures_after_or_during_rpc_leave_no_rows() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let original = annotation(
        &db,
        &w,
        &w.owner.user_id,
        "Explorational",
        "Internal",
        "Active",
    )
    .await;
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'existing-tracing','Volume','Volume','{}')")
        .bind(&original).execute(&db.pool).await.unwrap();
    let uri = format!("/api/annotations/Explorational/{original}/duplicate");
    let (annotations, layer_rows) = (annotation_count(&db).await, layer_count(&db).await);

    // Unsuccessful upstream status is kept (ParamFailure), message replaced;
    // the upstream body never leaks.
    for (code, expected) in [
        (500, StatusCode::INTERNAL_SERVER_ERROR),
        (400, StatusCode::BAD_REQUEST),
        (404, StatusCode::NOT_FOUND),
    ] {
        mock.set_mode(Mode::Status(code));
        let (status, body) = post(&app, Some(&w.owner.token), &uri).await;
        assert_eq!((status, body), (expected, error(DUPLICATE_FAILED)));
    }
    // Invalid protobuf: 400.
    mock.set_mode(Mode::Garbage);
    let (status, body) = post(&app, Some(&w.owner.token), &uri).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(DUPLICATE_FAILED))
    );
    // Insert fails on the second layer (tracing id already used): the whole
    // insert rolls back, including the annotation row and first layer.
    mock.set_mode(Mode::CollidingLayer);
    let (status, _) = post(&app, Some(&w.owner.token), &uri).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(mock.duplicate_calls().len(), 5);
    assert_eq!(annotation_count(&db).await, annotations);
    assert_eq!(layer_count(&db).await, layer_rows);

    // No tracing store: 400 duplicateFailed, no RPC.
    sqlx::query("DELETE FROM webknossos.tracingStores")
        .execute(&db.pool)
        .await
        .unwrap();
    mock.set_mode(Mode::Ok);
    let (status, body) = post(&app, Some(&w.owner.token), &uri).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(DUPLICATE_FAILED))
    );
    assert_eq!(mock.duplicate_calls().len(), 5);
    assert_eq!(annotation_count(&db).await, annotations);

    // Unreachable tracing store: connection failure, 400.
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('dead','http://127.0.0.1:1','https://x.example.test','k')")
        .execute(&db.pool).await.unwrap();
    let (status, body) = post(&app, Some(&w.owner.token), &uri).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(DUPLICATE_FAILED))
    );
    assert_eq!(annotation_count(&db).await, annotations);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn compound_task_duplicates_merged_annotation() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let annotator = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    let instance = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,description) VALUES($1,$2,$3,$4,'Task','Internal','Finished','Instance description')")
        .bind(&instance).bind(&w.dataset).bind(&w.task).bind(&annotator.user_id)
        .execute(&db.pool).await.unwrap();
    // The compound merge stores the data source temporarily; the seeded
    // layers have no mags, which that serializer rejects (not under test).
    sqlx::query("DELETE FROM webknossos.dataset_layers")
        .execute(&db.pool)
        .await
        .unwrap();
    let uri = format!("/api/annotations/CompoundTask/{}/duplicate", w.task);

    let (status, body) = post(&app, Some(&w.f.token), &uri).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let merges = mock
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|call| call.path.ends_with("/mergedFromIds"))
        .count();
    assert_eq!(merges, 1);
    let call = mock.duplicate_calls().pop().unwrap();
    // The compound (task id) is duplicated; it has no `_task`, so no box.
    assert_eq!(
        call.path,
        format!("/tracings/annotation/{}/duplicate", w.task)
    );
    assert_eq!(call.param("isFromTask"), Some("false"));
    assert_eq!(call.param("datasetBoundingBox"), None);
    assert_eq!(call.param("ownerId"), Some(w.f.user_id.as_str()));
    assert_eq!(call.param("requestingUserId"), Some(w.f.user_id.as_str()));
    let new_id = assert_new_id(&body, &call);
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["description"], "");
    assert_eq!(body["owner"]["id"], w.f.user_id.as_str());
    // Compound restrictions of the requester (admin: access, no update/finish).
    assert_eq!(body["restrictions"]["allowAccess"], true);
    assert_eq!(body["restrictions"]["allowUpdate"], false);
    assert_eq!(body["restrictions"]["allowFinish"], false);
    let (task, user, dataset, typ, ..) = row(&db, &new_id).await;
    assert_eq!(
        (task, user, dataset, typ.as_str()),
        (
            None,
            w.f.user_id.clone(),
            w.dataset.clone(),
            "Explorational"
        )
    );

    // Scala has no restrictions gate on duplicate: a non-manager member who
    // can provide the (cached) compound may duplicate it; the response
    // carries the compound restrictions (allowAccess false).
    let (status, body) = post(&app, Some(&w.member.token), &uri).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["owner"]["id"], w.member.user_id.as_str());
    assert_eq!(body["restrictions"]["allowAccess"], false);
    let call = mock.duplicate_calls().pop().unwrap();
    // The cached compound keeps its first requester as owner.
    assert_eq!(call.param("ownerId"), Some(w.f.user_id.as_str()));
    assert_eq!(
        call.param("requestingUserId"),
        Some(w.member.user_id.as_str())
    );

    // CompoundProject with an unknown project: provider failure, 404.
    let (status, body) = post(
        &app,
        Some(&w.f.token),
        "/api/annotations/CompoundProject/aaaaaaaaaaaaaaaaaaaaaaaa/duplicate",
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    assert_eq!(mock.duplicate_calls().len(), 2);
    db.cleanup().await;
}
