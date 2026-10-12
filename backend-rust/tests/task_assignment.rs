//! POST /tasks/:id/assign?userId= against a real database and a mock tracing
//! store that records every RPC together with the database state observed
//! while the RPC runs (the Initializing row and the pending count).
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
use sqlx::PgPool;
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    router,
};

const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
const NOT_FOUND: &str = "Could not find or access the requested resource.";
const UNAVAILABLE: &str = "There is currently no task available.";
const BASE_ID_FAILED: &str = "Failed to retrieve annotation base id.";
const TRACING_STORE_NOT_FOUND: &str = "Tracing store could not be found or accessed.";

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
    /// (state, _user, pendingInstances of its task) of the new annotation
    /// while the RPC was running.
    observed: Option<(String, String, i64)>,
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
    /// A returned layer reuses a tracing id that already exists.
    CollidingLayer,
}

#[derive(Clone)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    mode: Arc<Mutex<Mode>>,
    pool: PgPool,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
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
        description: "ignored".into(),
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
    let new_id = query
        .iter()
        .find(|(k, _)| k == "newAnnotationId")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    let observed = sqlx::query_as("SELECT a.state::text,a._user,t.pendingInstances FROM webknossos.annotations a JOIN webknossos.tasks t ON t._id=a._task WHERE a._id=$1")
        .bind(&new_id).fetch_optional(&mock.pool).await.unwrap();
    mock.calls.lock().unwrap().push(Call {
        method,
        path,
        query,
        body_len: body.len(),
        observed,
    });
    let answer = match *mock.mode.lock().unwrap() {
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
            return (StatusCode::from_u16(code).unwrap(), "upstream secret body").into_response();
        }
        Mode::Garbage => return (StatusCode::OK, vec![0xff_u8, 0xff, 0xff]).into_response(),
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        answer.encode_to_vec(),
    )
        .into_response()
}

async fn mock_tracing_store(pool: PgPool) -> (String, Mock) {
    let mock = Mock {
        calls: Arc::default(),
        mode: Arc::new(Mutex::new(Mode::Ok)),
        pool,
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
    /// Team manager of the project team.
    manager: UserFixture,
    /// Plain member of the project team (the usual assignee).
    member: UserFixture,
    /// Same organization, no team.
    outsider: UserFixture,
    /// Admin of another organization.
    foreign: UserFixture,
    dataset: String,
    project: String,
    task_type: String,
    task: String,
    base: String,
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

async fn world(db: &TestDb, tracing_url: Option<&str>) -> World {
    let f = db.fixture().await;
    let manager = db.seed_user(&object_id(), &f.organization_id, false).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let outsider = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    add_role(db, &manager.user_id, &f.team_id, true).await;
    add_role(db, &member.user_id, &f.team_id, false).await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('assign','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    if let Some(url) = tracing_url {
        sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('assign-ts',$1,'https://trace.example.test','k')")
            .bind(url).execute(&db.pool).await.unwrap();
    }
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'assign',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (project, task_type) = (object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Assign-project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Assign-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    let mut w = World {
        f,
        manager,
        member,
        outsider,
        foreign,
        dataset,
        project,
        task_type,
        task: String::new(),
        base: String::new(),
    };
    let (task, base) = task(db, &w, 2).await;
    w.task = task;
    w.base = base;
    w
}

/// A task with `pending` open instances and a TracingBase owned by the org
/// admin (Internal, Concurrent, name/description/tags/tracingTime set).
async fn task(db: &TestDb, w: &World, pending: i64) -> (String, String) {
    let task = object_id();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,'test',0,$4,$4,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&task).bind(&w.project).bind(&w.task_type).bind(pending).execute(&db.pool).await.unwrap();
    let base = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,name,description,tags,tracingTime,created,modified) VALUES($1,$2,$3,$4,'TracingBase','Internal','Active','Concurrent','Base name','Base description',ARRAY['tag'],1234,TIMESTAMPTZ '2020-01-01T00:00:00Z',TIMESTAMPTZ '2020-01-02T00:00:00Z')")
        .bind(&base).bind(&w.dataset).bind(&task).bind(&w.f.user_id)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{\"treeCount\":1}')")
        .bind(&base).bind(format!("tracing-{base}")).execute(&db.pool).await.unwrap();
    (task, base)
}

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

fn uri(task: &str, user: &str) -> String {
    format!("/api/tasks/{task}/assign?userId={user}")
}

/// (pendingInstances, number of Task annotations of the task, total annotation
/// layers in the database).
async fn counts(db: &TestDb, task: &str) -> (i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT pendingInstances FROM webknossos.tasks WHERE _id=$1),
        (SELECT count(*) FROM webknossos.annotations WHERE _task=$1 AND typ='Task'),
        (SELECT count(*) FROM webknossos.annotation_layers)",
    )
    .bind(task)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

type Row = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Vec<String>,
    Option<i64>,
    bool,
    bool,
    bool,
);

async fn row(db: &TestDb, id: &str) -> Row {
    sqlx::query_as("SELECT _task,_user,_dataset,typ::text,state::text,visibility::text||'|'||collaborationMode::text,name||'|'||description,tags,tracingTime,isLockedByOwner,isDeleted,created=modified AND created > now() - INTERVAL '1 minute' FROM webknossos.annotations WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

async fn layers(db: &TestDb, id: &str) -> Vec<(String, String, String, Value)> {
    sqlx::query_as("SELECT tracingId,typ::text,name,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY name")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn assign_creates_active_task_annotation_from_tracing_base() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store(db.pool.clone()).await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);

    let (status, body) = post(
        &app,
        Some(&w.manager.token),
        &uri(&w.task, &w.member.user_id),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Exactly one duplicate RPC of the TracingBase.
    let calls = mock.calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.method, "POST");
    assert_eq!(call.body_len, 0);
    assert_eq!(
        call.path,
        format!("/tracings/annotation/{}/duplicate", w.base)
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
    assert_eq!(call.param("isFromTask"), Some("false"));
    assert_eq!(call.param("ownerId"), Some(w.f.user_id.as_str()));
    assert_eq!(
        call.param("requestingUserId"),
        Some(w.member.user_id.as_str())
    );
    let new_id = call.param("newAnnotationId").unwrap().to_owned();
    // While the RPC ran the row was Initializing and already counted.
    assert_eq!(
        call.observed,
        Some(("Initializing".into(), w.member.user_id.clone(), 1))
    );

    // Initializing → Active with the base's fields and the duplicated layers.
    assert_eq!(
        row(&db, &new_id).await,
        (
            w.task.clone(),
            w.member.user_id.clone(),
            w.dataset.clone(),
            "Task".into(),
            "Active".into(),
            "Internal|Concurrent".into(),
            "Base name|Base description".into(),
            vec!["tag".into()],
            Some(1234),
            false,
            false,
            true,
        )
    );
    assert_eq!(
        layers(&db, &new_id).await,
        [
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
    // TracingBase untouched.
    assert_eq!(layers(&db, &w.base).await.len(), 1);
    assert_eq!(counts(&db, &w.task).await.0, 1);

    // Response: TaskService.publicWrites of the updated task.
    assert_eq!(body["id"], w.task.as_str());
    assert_eq!(body["projectId"], w.project.as_str());
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(body["type"]["id"], w.task_type.as_str());
    assert_eq!(
        body["status"],
        json!({"pending": 1, "active": 1, "finished": 0})
    );
    assert!(body.get("messages").is_none());

    // The org admin may assign the same user again (no duplicate check).
    let (status, body) = post(&app, Some(&w.f.token), &uri(&w.task, &w.member.user_id)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["status"],
        json!({"pending": 0, "active": 2, "finished": 0})
    );
    assert_eq!(counts(&db, &w.task).await.0, 0);

    // No pending instances left: 400 unavailable, no RPC, nothing inserted.
    let before = counts(&db, &w.task).await;
    let (status, body) = post(
        &app,
        Some(&w.manager.token),
        &uri(&w.task, &w.member.user_id),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
    );
    assert_eq!(mock.calls().len(), 2);
    assert_eq!(counts(&db, &w.task).await, before);

    // Concurrent assignment of the last instance: exactly one wins.
    let (contested, _) = task(&db, &w, 1).await;
    let requests = (0..4).map(|_| {
        let app = app.clone();
        let uri = uri(&contested, &w.member.user_id);
        let token = w.manager.token.clone();
        async move { post(&app, Some(&token), &uri).await }
    });
    let results = futures_join_all(requests).await;
    let ok = results.iter().filter(|(s, _)| *s == StatusCode::OK).count();
    assert_eq!(ok, 1, "{results:?}");
    for (status, body) in results.iter().filter(|(s, _)| *s != StatusCode::OK) {
        assert_eq!(
            (*status, body.clone()),
            (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
        );
    }
    let (pending, task_annotations, _) = counts(&db, &contested).await;
    assert_eq!((pending, task_annotations), (0, 1));

    db.cleanup().await;
}

/// Minimal join_all without an extra dependency: spawn and await in order.
async fn futures_join_all<F>(futures: impl Iterator<Item = F>) -> Vec<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    let handles: Vec<_> = futures.map(tokio::spawn).collect();
    let mut results = Vec::new();
    for handle in handles {
        results.push(handle.await.unwrap());
    }
    results
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn assign_checks_access_and_permissions_before_assigning() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store(db.pool.clone()).await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let before = counts(&db, &w.task).await;
    let assign = uri(&w.task, &w.member.user_id);

    // Unauthenticated.
    let (status, _) = post(&app, None, &assign).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Query parameter handling.
    let (status, body) = post(
        &app,
        Some(&w.manager.token),
        &format!("/api/tasks/{}/assign", w.task),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("Missing parameter: userId"))
    );
    let (status, _) = post(&app, Some(&w.manager.token), &uri(&w.task, "nope")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Unknown user / user not readable by the requester / unknown task: 404.
    for (token, uri) in [
        (&w.manager.token, uri(&w.task, &object_id())),
        (&w.manager.token, uri(&w.task, &w.outsider.user_id)),
        (&w.foreign.token, assign.clone()),
        (&w.manager.token, uri(&object_id(), &w.member.user_id)),
    ] {
        let (status, body) = post(&app, Some(token), &uri).await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(NOT_FOUND)),
            "{uri}"
        );
    }

    // A plain team member can read the task but does not manage its team.
    let (status, body) = post(
        &app,
        Some(&w.member.token),
        &uri(&w.task, &w.member.user_id),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(NOT_ALLOWED))
    );

    // A manager of a different team who is also a project team member
    // (task readable) and can read the assignee is still not allowed.
    let other_team = object_id();
    sqlx::query("INSERT INTO webknossos.teams(_id,_organization,name) VALUES($1,$2,'Other team')")
        .bind(&other_team)
        .bind(&w.f.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let other_manager = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    add_role(&db, &other_manager.user_id, &other_team, true).await;
    add_role(&db, &other_manager.user_id, &w.f.team_id, false).await;
    add_role(&db, &w.outsider.user_id, &other_team, false).await;
    let (status, body) = post(
        &app,
        Some(&other_manager.token),
        &uri(&w.task, &w.outsider.user_id),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(NOT_ALLOWED))
    );

    // The project team manager does not manage the outsider's team: the user
    // is not readable for it (404 before any permission check).
    let (status, body) = post(
        &app,
        Some(&w.manager.token),
        &uri(&w.task, &w.outsider.user_id),
    )
    .await;
    assert_eq!((status, body), (StatusCode::NOT_FOUND, error(NOT_FOUND)));

    // Deleted task: 404.
    let (deleted, _) = task(&db, &w, 1).await;
    sqlx::query("UPDATE webknossos.tasks SET isDeleted=true WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post(
        &app,
        Some(&w.manager.token),
        &uri(&deleted, &w.member.user_id),
    )
    .await;
    assert_eq!((status, body), (StatusCode::NOT_FOUND, error(NOT_FOUND)));

    assert!(mock.calls().is_empty());
    // (Layer total differs only by the deleted task's seeded TracingBase.)
    assert_eq!(
        counts(&db, &w.task).await,
        (before.0, before.1, before.2 + 1)
    );
    assert_eq!(counts(&db, &deleted).await.0, 1);
    db.cleanup().await;
}

/// Every failure after the Initializing insert deletes it again and restores
/// the pending count; the failure is rendered like Play.
#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn assign_failures_abort_the_initializing_annotation() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store(db.pool.clone()).await;
    let w = world(&db, Some(&url)).await;
    let app = app(&db);
    let assign = uri(&w.task, &w.member.user_id);
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'existing-tracing','Volume','Volume','{}')")
        .bind(&w.base).execute(&db.pool).await.unwrap();
    let before = counts(&db, &w.task).await;
    assert_eq!(before.0, 2);
    let total_annotations = || async {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM webknossos.annotations")
            .fetch_one(&db.pool)
            .await
            .unwrap()
    };
    let annotations_before = total_annotations().await;

    // Upstream status codes are kept, the upstream body is not leaked.
    for code in [500_u16, 404, 400] {
        mock.set_mode(Mode::Status(code));
        let (status, body) = post(&app, Some(&w.manager.token), &assign).await;
        assert_eq!(status.as_u16(), code, "{body}");
        assert!(!body.to_string().contains("upstream secret body"));
        assert_eq!(counts(&db, &w.task).await, before);
    }
    // Invalid protobuf: plain Fox failure, 400.
    mock.set_mode(Mode::Garbage);
    let (status, _) = post(&app, Some(&w.manager.token), &assign).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(counts(&db, &w.task).await, before);
    // A duplicated layer colliding with an existing tracing id fails the
    // transactional updateInitialized (crate 409), which leaves no layers.
    mock.set_mode(Mode::CollidingLayer);
    let (status, _) = post(&app, Some(&w.manager.token), &assign).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(counts(&db, &w.task).await, before);
    // Every RPC saw its own Initializing row with the pending count taken.
    let calls = mock.calls();
    assert_eq!(calls.len(), 5);
    for call in &calls {
        assert_eq!(
            call.observed,
            Some(("Initializing".into(), w.member.user_id.clone(), 1))
        );
    }
    mock.set_mode(Mode::Ok);

    // Unusable dataset: 400 before any RPC.
    sqlx::query("UPDATE webknossos.datasets SET isUsable=false WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post(&app, Some(&w.manager.token), &assign).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "Dataset “{}” is not imported or incomplete.",
                w.dataset
            ))
        )
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable=true WHERE _id=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();

    // Dataset not readable by the requester (context user): 400.
    sqlx::query("DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset=$1")
        .bind(&w.dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post(&app, Some(&w.manager.token), &assign).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "Dataset “{}” for annotation “{}” does not exist or could not be accessed.",
                w.dataset, w.base
            ))
        )
    );
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&w.dataset)
        .bind(&w.f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(counts(&db, &w.task).await, before);

    // No tracing store: 400 Msg.TracingStore.notFound.
    sqlx::query("DELETE FROM webknossos.tracingStores")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post(&app, Some(&w.manager.token), &assign).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(TRACING_STORE_NOT_FOUND))
    );
    assert_eq!(counts(&db, &w.task).await, before);

    // Cancelled TracingBase: no base id.
    sqlx::query("UPDATE webknossos.annotations SET state='Cancelled' WHERE _id=$1")
        .bind(&w.base)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = post(&app, Some(&w.manager.token), &assign).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(BASE_ID_FAILED))
    );

    assert_eq!(counts(&db, &w.task).await, before);
    assert_eq!(total_annotations().await, annotations_before);
    assert_eq!(mock.calls().len(), 5);
    let leftovers: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM webknossos.annotations WHERE state='Initializing'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(leftovers, 0);
    db.cleanup().await;
}
