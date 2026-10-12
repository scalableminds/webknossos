//! POST /annotations/:typ/:id/merge/:mergedTyp/:mergedId,
//! POST /annotations/:id/merge/:mergedTyp/:mergedId and
//! PUT /annotations/:typ/:id/reset against a real database and a mock
//! tracing store.
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
    annotation_merge::{MERGE_FAILED, MERGE_SUCCESS},
    annotation_provider::{ANNOTATION_NOT_FOUND, RESOURCE_NOT_FOUND},
    annotation_reset::{RESET_FAILED, RESET_SUCCESS},
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    router,
};

fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

async fn send(app: &Router, method: Method, token: &str, uri: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-auth-token", token)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// ---------------------------------------------------------------------------
// Mock tracing store: mergedFromIds answers two layers, resetToBase answers
// 200; `fail` makes every call answer that status. Calls are recorded.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Call {
    method: Method,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
}

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    fail: Arc<Mutex<Option<StatusCode>>>,
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn fail_with(&self, status: Option<StatusCode>) {
        *self.fail.lock().unwrap() = status;
    }
}

/// Tracing IDs are unique per merge (annotation_layers.tracingId is unique).
fn merged_proto(new_id: &str) -> AnnotationProto {
    AnnotationProto {
        description: String::new(),
        version: 0,
        annotation_layers: vec![
            AnnotationLayerProto {
                tracing_id: format!("skeleton-{new_id}"),
                name: "Skeleton".into(),
                typ: AnnotationLayerTypeProto::Skeleton as i32,
            },
            AnnotationLayerProto {
                tracing_id: format!("volume-{new_id}"),
                name: "Volume".into(),
                typ: AnnotationLayerTypeProto::Volume as i32,
            },
        ],
        earliest_accessible_version: 0,
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: Vec::new(),
    }
}

async fn mock_handler(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query: Vec<(String, String)> =
        serde_urlencoded::from_str(request.uri().query().unwrap_or("")).unwrap();
    let new_id = query
        .iter()
        .find(|(key, _)| key == "newAnnotationId")
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    mock.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        query,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    });
    if let Some(status) = *mock.fail.lock().unwrap() {
        return status.into_response();
    }
    if path.ends_with("/mergedFromIds") {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/x-protobuf")],
            merged_proto(&new_id).encode_to_vec(),
        )
            .into_response()
    } else if path.ends_with("/resetToBase") {
        StatusCode::OK.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
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

fn query_value<'a>(call: &'a Call, key: &str) -> Option<&'a str> {
    call.query
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

struct World {
    f: Fixture,
    owner: UserFixture,
    member: UserFixture,
    manager: UserFixture,
    foreign: UserFixture,
    dataset: String,
    task: String,
}

async fn world(db: &TestDb, tracing_url: &str) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let manager = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    for (user, is_manager) in [
        (&owner.user_id, false),
        (&member.user_id, false),
        (&manager.user_id, true),
    ] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
        )
        .bind(user)
        .bind(&f.team_id)
        .bind(is_manager)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('mr','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('mr-ts',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'mr',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams(_dataset,_team) VALUES($1,$2)")
        .bind(&dataset)
        .bind(&f.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Merge-project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Merge-type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,8,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    let w = World {
        f,
        owner,
        member,
        manager,
        foreign,
        dataset,
        task,
    };
    let admin = w.f.user_id.clone();
    annotation(db, &w, &admin, "TracingBase", "Internal").await;
    w
}

/// Seeds a live annotation with one skeleton layer.
async fn annotation(db: &TestDb, w: &World, owner: &str, typ: &str, visibility: &str) -> String {
    let id = object_id();
    let task = matches!(typ, "Task" | "TracingBase").then_some(&w.task);
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,name,description,tags,created,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,'Active','OwnerOnly','Name','Description',ARRAY['tag'],TIMESTAMPTZ '2020-01-01T00:00:00Z',TIMESTAMPTZ '2020-01-02T00:00:00Z')")
        .bind(&id).bind(&w.dataset).bind(task).bind(owner).bind(typ).bind(visibility)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{\"treeCount\":1}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
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

fn app(db: &TestDb) -> Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn merge_creates_explorational_owned_by_requester() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let a = annotation(&db, &w, &w.owner.user_id, "Explorational", "Public").await;
    let b = annotation(&db, &w, &w.member.user_id, "Explorational", "Private").await;
    let before = annotation_count(&db).await;

    let (status, body) = send(
        &app,
        Method::POST,
        &w.member.token,
        &format!("/api/annotations/Explorational/{a}/merge/Explorational/{b}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let new_id = body["id"].as_str().unwrap().to_owned();
    assert_ne!(new_id, a);
    assert_ne!(new_id, b);
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["visibility"], "Internal");
    assert_eq!(body["name"], "");
    assert_eq!(body["description"], "");
    assert_eq!(body["task"], Value::Null);
    assert_eq!(body["datasetId"], w.dataset.as_str());
    assert_eq!(body["owner"]["id"], w.member.user_id.as_str());
    assert_eq!(body["collaborationMode"], "OwnerOnly");
    assert_eq!(body["restrictions"]["allowAccess"], true);
    assert_eq!(body["restrictions"]["allowUpdate"], true);
    assert_eq!(
        body["annotationLayers"],
        json!([
            {"tracingId":format!("skeleton-{new_id}"),"typ":"Skeleton","name":"Skeleton","stats":{}},
            {"tracingId":format!("volume-{new_id}"),"typ":"Volume","name":"Volume","stats":{}}
        ])
    );
    assert_eq!(body["messages"], json!([{"success": MERGE_SUCCESS}]));

    // Exactly one RPC with Scala's query parameters and body.
    let calls = mock.calls();
    assert_eq!(calls.len(), 1, "{calls:?}");
    let call = &calls[0];
    assert_eq!(call.method, Method::POST);
    assert_eq!(call.path, "/tracings/annotation/mergedFromIds");
    assert!(query_value(call, "token").is_some_and(|t| !t.is_empty()));
    assert_eq!(query_value(call, "toTemporaryStore"), Some("false"));
    assert_eq!(query_value(call, "newAnnotationId"), Some(new_id.as_str()));
    assert_eq!(
        query_value(call, "requestingUserId"),
        Some(w.member.user_id.as_str())
    );
    assert_eq!(query_value(call, "remapSegmentIds"), Some("true"));
    assert_eq!(
        call.body,
        json!({
            "annotationIds": [a, b],
            "ownerIds": [w.owner.user_id, w.member.user_id],
            "additionalBoundingBoxes": []
        })
    );

    // Persisted row and layers.
    assert_eq!(annotation_count(&db).await, before + 1);
    let row: (String, String, Option<String>, String, String, String, String, String, bool) = sqlx::query_as(
        "SELECT _user,_dataset,_task,typ::text,visibility::text,state::text,name,collaborationMode::text,isDeleted FROM webknossos.annotations WHERE _id=$1",
    )
    .bind(&new_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        row,
        (
            w.member.user_id.clone(),
            w.dataset.clone(),
            None,
            "Explorational".into(),
            "Internal".into(),
            "Active".into(),
            String::new(),
            "OwnerOnly".into(),
            false
        )
    );
    let layers: Vec<(String, String, String, Value)> = sqlx::query_as(
        "SELECT tracingId,typ::text,name,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(&new_id)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        layers,
        vec![
            (
                format!("skeleton-{new_id}"),
                "Skeleton".into(),
                "Skeleton".into(),
                json!({})
            ),
            (
                format!("volume-{new_id}"),
                "Volume".into(),
                "Volume".into(),
                json!({})
            ),
        ]
    );

    // remapSegmentIds=false is forwarded.
    let (status, body) = send(
        &app,
        Method::POST,
        &w.member.token,
        &format!(
            "/api/annotations/Explorational/{a}/merge/Explorational/{b}?remapSegmentIds=false"
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let calls = mock.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(query_value(&calls[1], "remapSegmentIds"), Some("false"));

    // Invalid boolean is a 400 before any RPC.
    let (status, _) = send(
        &app,
        Method::POST,
        &w.member.token,
        &format!("/api/annotations/Explorational/{a}/merge/Explorational/{b}?remapSegmentIds=yes"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(mock.calls().len(), 2);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn untyped_merge_resolves_stored_type() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let task_annotation = annotation(&db, &w, &w.owner.user_id, "Task", "Internal").await;
    let b = annotation(&db, &w, &w.f.user_id, "Explorational", "Internal").await;

    // Admin requester; the first annotation's stored type (Task) is used.
    let (status, body) = send(
        &app,
        Method::POST,
        &w.f.token,
        &format!("/api/annotations/{task_annotation}/merge/Explorational/{b}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["owner"]["id"], w.f.user_id.as_str());
    assert_eq!(body["messages"], json!([{"success": MERGE_SUCCESS}]));
    let calls = mock.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].body["annotationIds"], json!([task_annotation, b]));
    assert_eq!(
        calls[0].body["ownerIds"],
        json!([w.owner.user_id, w.f.user_id])
    );

    // Unknown first annotation: 404 before any RPC.
    let missing = object_id();
    let (status, body) = send(
        &app,
        Method::POST,
        &w.f.token,
        &format!("/api/annotations/{missing}/merge/Explorational/{b}"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, error(ANNOTATION_NOT_FOUND));
    assert_eq!(mock.calls().len(), 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn merge_permission_and_not_found_failures() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let private = annotation(&db, &w, &w.owner.user_id, "Explorational", "Private").await;
    let own = annotation(&db, &w, &w.member.user_id, "Explorational", "Internal").await;
    let before = annotation_count(&db).await;

    // Another user's private annotation (first or merged side) is not found.
    for uri in [
        format!("/api/annotations/Explorational/{private}/merge/Explorational/{own}"),
        format!("/api/annotations/Explorational/{own}/merge/Explorational/{private}"),
        format!("/api/annotations/{private}/merge/Explorational/{own}"),
        format!(
            "/api/annotations/Explorational/{own}/merge/Explorational/{}",
            object_id()
        ),
    ] {
        let (status, body) = send(&app, Method::POST, &w.member.token, &uri).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}: {body}");
        assert_eq!(body, error(ANNOTATION_NOT_FOUND), "{uri}");
    }
    // Foreign organization administrator cannot read either annotation.
    let (status, body) = send(
        &app,
        Method::POST,
        &w.foreign.token,
        &format!("/api/annotations/Explorational/{own}/merge/Explorational/{own}"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, error(ANNOTATION_NOT_FOUND));
    // Malformed ObjectId and missing authentication.
    let (status, _) = send(
        &app,
        Method::POST,
        &w.member.token,
        &format!("/api/annotations/Explorational/not-an-id/merge/Explorational/{own}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/annotations/Explorational/{own}/merge/Explorational/{own}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    assert!(mock.calls().is_empty());
    assert_eq!(annotation_count(&db).await, before);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn merge_rpc_failure_leaves_no_new_rows() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let a = annotation(&db, &w, &w.member.user_id, "Explorational", "Internal").await;
    let b = annotation(&db, &w, &w.member.user_id, "Explorational", "Internal").await;
    let (annotations, layers) = (annotation_count(&db).await, layer_count(&db).await);

    // Unsuccessful upstream status is kept (RPCRequest ParamFailure).
    mock.fail_with(Some(StatusCode::INTERNAL_SERVER_ERROR));
    let (status, body) = send(
        &app,
        Method::POST,
        &w.member.token,
        &format!("/api/annotations/Explorational/{a}/merge/Explorational/{b}"),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, error(MERGE_FAILED));
    assert_eq!(mock.calls().len(), 1);

    // Unreachable tracing store: plain failure (400).
    sqlx::query("UPDATE webknossos.tracingStores SET url='http://127.0.0.1:1'")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = send(
        &app,
        Method::POST,
        &w.member.token,
        &format!("/api/annotations/Explorational/{a}/merge/Explorational/{b}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error(MERGE_FAILED));

    assert_eq!(annotation_count(&db).await, annotations);
    assert_eq!(layer_count(&db).await, layers);
    db.cleanup().await;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reset_by_manager_or_admin_calls_reset_to_base() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let task_annotation = annotation(&db, &w, &w.owner.user_id, "Task", "Internal").await;
    let before = annotation_count(&db).await;

    for (index, token) in [&w.manager.token, &w.f.token].into_iter().enumerate() {
        let (status, body) = send(
            &app,
            Method::PUT,
            token,
            &format!("/api/annotations/Task/{task_annotation}/reset"),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["id"], task_annotation.as_str());
        assert_eq!(body["typ"], "Task");
        assert_eq!(body["task"]["id"], w.task.as_str());
        assert_eq!(body["owner"]["id"], w.owner.user_id.as_str());
        assert_eq!(body["messages"], json!([{"success": RESET_SUCCESS}]));
        let calls = mock.calls();
        assert_eq!(calls.len(), index + 1);
        let call = calls.last().unwrap();
        assert_eq!(call.method, Method::POST);
        assert_eq!(
            call.path,
            format!("/tracings/annotation/{task_annotation}/resetToBase")
        );
        assert!(query_value(call, "token").is_some_and(|t| !t.is_empty()));
        assert_eq!(call.query.len(), 1, "only the RPC token");
    }
    // No main-application rows are written.
    assert_eq!(annotation_count(&db).await, before);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reset_denials_and_failures() {
    let db = TestDb::new().await;
    let (url, mock) = mock_tracing_store().await;
    let w = world(&db, &url).await;
    let app = app(&db);
    let task_annotation = annotation(&db, &w, &w.owner.user_id, "Task", "Internal").await;
    let explorational = annotation(&db, &w, &w.owner.user_id, "Explorational", "Internal").await;

    // Ordinary owner: Fox.assertTrue(false) is Fox.empty → 404 Msg.notFound.
    let (status, body) = send(
        &app,
        Method::PUT,
        &w.owner.token,
        &format!("/api/annotations/Task/{task_annotation}/reset"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, error(RESOURCE_NOT_FOUND));

    // Unreadable / unknown annotation: provider 404.
    for (token, id) in [
        (&w.foreign.token, &task_annotation),
        (&w.f.token, &object_id()),
    ] {
        let (status, body) = send(
            &app,
            Method::PUT,
            token,
            &format!("/api/annotations/Task/{id}/reset"),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, error(ANNOTATION_NOT_FOUND));
    }

    // Non-task annotation (admin passes the grant): tasksOnly → 400 Reset.failed.
    let (status, body) = send(
        &app,
        Method::PUT,
        &w.f.token,
        &format!("/api/annotations/Explorational/{explorational}/reset"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, error(RESET_FAILED));
    assert!(mock.calls().is_empty());

    // Upstream failure keeps its status.
    mock.fail_with(Some(StatusCode::SERVICE_UNAVAILABLE));
    let (status, body) = send(
        &app,
        Method::PUT,
        &w.f.token,
        &format!("/api/annotations/Task/{task_annotation}/reset"),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, error(RESET_FAILED));
    assert_eq!(mock.calls().len(), 1);
    db.cleanup().await;
}
