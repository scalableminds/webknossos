//! POST /user/tasks/request (TaskController.request) against a real database
//! and a mock tracing store answering the duplicate RPC.
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
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    router,
};

const UNAVAILABLE: &str = "There is currently no task available.";
const TOO_MANY: &str = "You already have too many open tasks.";
const ASSIGNED: &str = "You have been assigned a new task.";
const URI: &str = "/api/user/tasks/request";

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

async fn post(app: &Router, token: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder().method(Method::POST).uri(URI);
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

#[derive(Clone)]
struct Mock {
    /// (path, newAnnotationId) of every RPC.
    calls: Arc<Mutex<Vec<(String, String)>>>,
    /// None: answer with two layers; Some(code): fail with that status.
    fail: Arc<Mutex<Option<u16>>>,
}

impl Mock {
    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().unwrap().clone()
    }
    fn fail_with(&self, code: Option<u16>) {
        *self.fail.lock().unwrap() = code;
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let _ = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    let new_id = query
        .iter()
        .find(|(k, _)| k == "newAnnotationId")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    mock.calls.lock().unwrap().push((path, new_id.clone()));
    if let Some(code) = *mock.fail.lock().unwrap() {
        return (StatusCode::from_u16(code).unwrap(), "upstream secret body").into_response();
    }
    let answer = AnnotationProto {
        description: "ignored".into(),
        version: 0,
        annotation_layers: vec![AnnotationLayerProto {
            tracing_id: format!("dup-skeleton-{new_id}"),
            name: "Skeleton".into(),
            typ: AnnotationLayerTypeProto::Skeleton as i32,
        }],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
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
        fail: Arc::default(),
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
    dataset: String,
    task_type: String,
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

async fn add_experience(db: &TestDb, user: &str, domain: &str, value: i32) {
    sqlx::query("INSERT INTO webknossos.user_experiences(_user,domain,value) VALUES($1,$2,$3)")
        .bind(user)
        .bind(domain)
        .bind(value)
        .execute(&db.pool)
        .await
        .unwrap();
}

async fn world(db: &TestDb, tracing_url: &str) -> World {
    let f = db.fixture().await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('request','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('request-ts',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'request',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let task_type = object_id();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Request-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    World {
        f,
        dataset,
        task_type,
    }
}

async fn member(db: &TestDb, w: &World, team: &str, manager: bool) -> UserFixture {
    let user = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    add_role(db, &user.user_id, team, manager).await;
    add_experience(db, &user.user_id, "neurons", 3).await;
    user
}

async fn team(db: &TestDb, w: &World) -> String {
    let team = object_id();
    sqlx::query("INSERT INTO webknossos.teams(_id,_organization,name) VALUES($1,$2,$3)")
        .bind(&team)
        .bind(&w.f.organization_id)
        .bind(format!("Team {team}"))
        .execute(&db.pool)
        .await
        .unwrap();
    team
}

async fn project(db: &TestDb, w: &World, team: &str, priority: i64, paused: bool) -> String {
    let project = object_id();
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name,priority,paused) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(&project).bind(&w.f.organization_id).bind(team).bind(&w.f.user_id)
        .bind(format!("Project {project}")).bind(priority).bind(paused)
        .execute(&db.pool).await.unwrap();
    project
}

/// A task needing `domain` >= `value` with `pending` instances and a
/// TracingBase owned by the org admin.
async fn task(
    db: &TestDb,
    w: &World,
    project: &str,
    domain: &str,
    value: i32,
    pending: i64,
) -> String {
    let task = object_id();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation) VALUES($1,$2,$3,$4,$5,$6,$6,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3)")
        .bind(&task).bind(project).bind(&w.task_type).bind(domain).bind(value).bind(pending)
        .execute(&db.pool).await.unwrap();
    let base = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,name,description,tracingTime) VALUES($1,$2,$3,$4,'TracingBase','Internal','Active','Base','Base description',0)")
        .bind(&base).bind(&w.dataset).bind(&task).bind(&w.f.user_id)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}')")
        .bind(&base).bind(format!("tracing-{base}")).execute(&db.pool).await.unwrap();
    task
}

/// An existing Task annotation of `user` for `task` in `state`.
async fn task_annotation(db: &TestDb, w: &World, task: &str, user: &str, state: &str) {
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,name,description,tracingTime) VALUES($1,$2,$3,$4,'Task','Internal',$5::webknossos.ANNOTATION_STATE,'','',0)")
        .bind(object_id()).bind(&w.dataset).bind(task).bind(user).bind(state)
        .execute(&db.pool).await.unwrap();
}

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

async fn pending(db: &TestDb, task: &str) -> i64 {
    sqlx::query_scalar("SELECT pendingInstances FROM webknossos.tasks WHERE _id=$1")
        .bind(task)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

/// (_task, _user, state, typ) of an annotation.
async fn annotation(db: &TestDb, id: &str) -> (String, String, String, String) {
    sqlx::query_as(
        "SELECT _task,_user,state::text,typ::text FROM webknossos.annotations WHERE _id=$1",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

/// Requests a task and returns (task id, annotation JSON).
async fn request_ok(db: &TestDb, app: &Router, user: &UserFixture) -> (String, Value) {
    let (status, body) = post(app, Some(&user.token)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["id"].as_str().unwrap().to_owned();
    let (task, owner, state, typ) = annotation(db, &id).await;
    assert_eq!(
        (owner.as_str(), state.as_str(), typ.as_str()),
        (user.user_id.as_str(), "Active", "Task")
    );
    (task, body)
}

async fn spawn_all<F>(futures: impl Iterator<Item = F>) -> Vec<F::Output>
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn request_picks_highest_priority_eligible_task() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let user = member(&db, &w, &w.f.team_id, false).await;
    let other_team = team(&db, &w).await;

    let low = project(&db, &w, &w.f.team_id, 10, false).await;
    let mid = project(&db, &w, &w.f.team_id, 50, false).await;
    let high = project(&db, &w, &w.f.team_id, 100, false).await;
    let paused = project(&db, &w, &w.f.team_id, 1000, true).await;
    let foreign = project(&db, &w, &other_team, 1000, false).await;
    // Ineligible despite higher priority.
    let paused_task = task(&db, &w, &paused, "neurons", 0, 5).await;
    let foreign_task = task(&db, &w, &foreign, "neurons", 0, 5).await;
    let too_hard = task(&db, &w, &high, "neurons", 4, 5).await;
    let other_domain = task(&db, &w, &high, "synapses", 0, 5).await;
    let no_pending = task(&db, &w, &high, "neurons", 0, 0).await;
    let deleted = task(&db, &w, &high, "neurons", 0, 5).await;
    sqlx::query("UPDATE webknossos.tasks SET isDeleted=TRUE WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    // Eligible: exact experience match in the highest live project.
    let best = task(&db, &w, &high, "neurons", 3, 2).await;
    let second = task(&db, &w, &mid, "neurons", 1, 1).await;
    let third = task(&db, &w, &low, "neurons", 0, 1).await;

    // 401 without credentials.
    assert_eq!(post(&app, None).await.0, StatusCode::UNAUTHORIZED);

    let (got, body) = request_ok(&db, &app, &user).await;
    assert_eq!(got, best);
    assert_eq!(body["messages"], json!([{ "success": ASSIGNED }]));
    assert_eq!(body["typ"], "Task");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(pending(&db, &best).await, 1);
    let calls = mock.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].1, body["id"].as_str().unwrap());
    assert!(
        calls[0].0.starts_with("/tracings/annotation/") && calls[0].0.ends_with("/duplicate"),
        "{:?}",
        calls[0]
    );

    // The user already holds an instance of `best` (still pending 1): next.
    assert_eq!(request_ok(&db, &app, &user).await.0, second);
    assert_eq!(request_ok(&db, &app, &user).await.0, third);
    assert_eq!(
        post(&app, Some(&user.token)).await,
        (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
    );

    // Another user still gets the remaining instance of `best`.
    let other = member(&db, &w, &w.f.team_id, false).await;
    assert_eq!(request_ok(&db, &app, &other).await.0, best);
    assert_eq!(pending(&db, &best).await, 0);

    // Untouched ineligible tasks.
    for t in [
        &paused_task,
        &foreign_task,
        &too_hard,
        &other_domain,
        &deleted,
    ] {
        assert_eq!(pending(&db, t).await, 5);
    }
    assert_eq!(pending(&db, &no_pending).await, 0);
    assert_eq!(mock.calls().len(), 4);

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn request_cancelled_previous_annotations_and_admin_teams() {
    let db = TestDb::new().await;
    let (url, _mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let plain = member(&db, &w, &w.f.team_id, false).await;
    let manager_team = team(&db, &w).await;
    let manager = member(&db, &w, &w.f.team_id, false).await;
    add_role(&db, &manager.user_id, &manager_team, true).await;
    let p = project(&db, &w, &w.f.team_id, 100, false).await;
    let t = task(&db, &w, &p, "neurons", 0, 5).await;
    task_annotation(&db, &w, &t, &plain.user_id, "Cancelled").await;
    task_annotation(&db, &w, &t, &manager.user_id, "Cancelled").await;

    // A cancelled instance still excludes the task for a plain user …
    assert_eq!(
        post(&app, Some(&plain.token)).await,
        (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
    );
    // … but not for a team manager (isTeamManagerOrAdminOfOrg).
    assert_eq!(request_ok(&db, &app, &manager).await.0, t);

    // An admin draws from every team of the organization without membership
    // and without the open-task limit, but needs experience.
    let admin_project = project(&db, &w, &manager_team, 100, false).await;
    let admin_task = task(&db, &w, &admin_project, "admin-domain", 0, 1).await;
    assert_eq!(
        post(&app, Some(&w.f.token)).await,
        (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
    );
    add_experience(&db, &w.f.user_id, "admin-domain", 0).await;
    for _ in 0..6 {
        let filler = task(&db, &w, &admin_project, "admin-domain", 0, 1).await;
        task_annotation(&db, &w, &filler, &w.f.user_id, "Active").await;
    }
    let (status, body) = post(&app, Some(&w.f.token)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        annotation(&db, body["id"].as_str().unwrap()).await.0,
        admin_task
    );

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn request_enforces_open_task_limit() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let managed_team = team(&db, &w).await;
    let user = member(&db, &w, &w.f.team_id, false).await;
    let member_project = project(&db, &w, &w.f.team_id, 100, false).await;
    let managed_project = project(&db, &w, &managed_team, 10, false).await;
    let open = task(&db, &w, &member_project, "neurons", 0, 1).await;

    // A user without any team gets tooManyOpenOnes (Scala parity).
    let teamless = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    add_experience(&db, &teamless.user_id, "neurons", 3).await;
    assert_eq!(
        post(&app, Some(&teamless.token)).await,
        (StatusCode::BAD_REQUEST, error(TOO_MANY))
    );

    // Four open (Active) task annotations: still below the limit of 5.
    // Finished ones do not count.
    for state in ["Active", "Active", "Active", "Active", "Finished"] {
        let filler = task(&db, &w, &member_project, "neurons", 0, 1).await;
        task_annotation(&db, &w, &filler, &user.user_id, state).await;
    }
    assert_eq!(request_ok(&db, &app, &user).await.0, open);

    // Fifth open task: limit reached, no managed team → tooManyOpenOnes.
    let _spare = task(&db, &w, &member_project, "neurons", 0, 1).await;
    assert_eq!(
        post(&app, Some(&user.token)).await,
        (StatusCode::BAD_REQUEST, error(TOO_MANY))
    );
    assert_eq!(mock.calls().len(), 1);

    // As a manager of another team the user may still draw from that team;
    // annotations of managed teams do not count towards the limit.
    add_role(&db, &user.user_id, &managed_team, true).await;
    let managed_task = task(&db, &w, &managed_project, "neurons", 0, 1).await;
    assert_eq!(request_ok(&db, &app, &user).await.0, managed_task);
    // Limit still reached for the member team (the spare task stays open).
    assert_eq!(
        post(&app, Some(&user.token)).await,
        (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
    );

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn concurrent_requests_never_over_assign() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let p = project(&db, &w, &w.f.team_id, 100, false).await;
    let contested = task(&db, &w, &p, "neurons", 0, 3).await;
    let mut users = Vec::new();
    for _ in 0..8 {
        users.push(member(&db, &w, &w.f.team_id, false).await);
    }
    let results = spawn_all(users.iter().map(|user| {
        let app = app.clone();
        let token = user.token.clone();
        async move { post(&app, Some(&token)).await }
    }))
    .await;
    let ok = results.iter().filter(|(s, _)| *s == StatusCode::OK).count();
    assert_eq!(ok, 3, "{results:?}");
    for (status, body) in results.iter().filter(|(s, _)| *s != StatusCode::OK) {
        assert_eq!(
            (*status, body.clone()),
            (StatusCode::BAD_REQUEST, error(UNAVAILABLE))
        );
    }
    assert_eq!(pending(&db, &contested).await, 0);
    let (count, distinct): (i64, i64) = sqlx::query_as("SELECT count(*),count(DISTINCT _user) FROM webknossos.annotations WHERE _task=$1 AND typ='Task' AND state='Active'")
        .bind(&contested).fetch_one(&db.pool).await.unwrap();
    assert_eq!((count, distinct), (3, 3));
    assert_eq!(mock.calls().len(), 3);

    // One user firing several concurrent requests never gets the same task
    // twice: four tasks with spare instances, four requests.
    let user = &users[0];
    let mut tasks = Vec::new();
    for priority in [90, 80, 70, 60] {
        let project = project(&db, &w, &w.f.team_id, priority, false).await;
        tasks.push(task(&db, &w, &project, "neurons", 0, 3).await);
    }
    let results = spawn_all((0..4).map(|_| {
        let app = app.clone();
        let token = user.token.clone();
        async move { post(&app, Some(&token)).await }
    }))
    .await;
    assert!(
        results.iter().all(|(s, _)| *s == StatusCode::OK),
        "{results:?}"
    );
    let assigned: Vec<String> = sqlx::query_scalar("SELECT _task FROM webknossos.annotations WHERE _user=$1 AND typ='Task' AND _task=ANY($2) ORDER BY _task")
        .bind(&user.user_id).bind(&tasks).fetch_all(&db.pool).await.unwrap();
    let mut expected = tasks.clone();
    expected.sort();
    assert_eq!(assigned, expected);

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn rpc_failure_aborts_cleanly() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let user = member(&db, &w, &w.f.team_id, false).await;
    let p = project(&db, &w, &w.f.team_id, 100, false).await;
    let t = task(&db, &w, &p, "neurons", 0, 1).await;
    let layers_before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM webknossos.annotation_layers")
            .fetch_one(&db.pool)
            .await
            .unwrap();

    for code in [500_u16, 400] {
        mock.fail_with(Some(code));
        let (status, body) = post(&app, Some(&user.token)).await;
        assert_eq!(status.as_u16(), code, "{body}");
        assert!(!body.to_string().contains("upstream secret body"), "{body}");
        assert_eq!(pending(&db, &t).await, 1);
        let leftovers: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM webknossos.annotations WHERE _task=$1 AND typ='Task'",
        )
        .bind(&t)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(leftovers, 0);
        let layers: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.annotation_layers")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(layers, layers_before);
    }
    assert_eq!(mock.calls().len(), 2);

    // After recovery the same instance is assignable again.
    mock.fail_with(None);
    assert_eq!(request_ok(&db, &app, &user).await.0, t);
    assert_eq!(pending(&db, &t).await, 0);

    db.cleanup().await;
}
