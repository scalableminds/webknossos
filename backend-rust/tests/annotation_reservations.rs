mod common;

use axum::{
    Extension, Router,
    body::Body,
    extract::{Request, State},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use common::{TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, annotation_lifecycle,
    annotation_metadata::NOT_ALLOWED,
    annotation_provider::{AnnotationProvider, RESOURCE_NOT_FOUND},
    annotation_reservations,
    service_clients::{ServiceClientConfig, ServiceClients},
    tracingstore_client::{TRACING_STORE_NOT_FOUND, TracingStoreClient},
};

struct World {
    owner: UserFixture,
    collaborator: UserFixture,
    foreign: UserFixture,
    dataset: String,
}

/// Mock tracing store: answers largestIdOrZero with `largest` (or `status`
/// when set) after `delay`, recording each request's path and query.
#[derive(Clone)]
struct Mock(Arc<Mutex<MockState>>);
struct MockState {
    largest: i64,
    status: Option<StatusCode>,
    delay: Duration,
    calls: Vec<(String, String)>,
}
impl Mock {
    fn new(largest: i64) -> Self {
        Self(Arc::new(Mutex::new(MockState {
            largest,
            status: None,
            delay: Duration::ZERO,
            calls: Vec::new(),
        })))
    }
    fn calls(&self) -> Vec<(String, String)> {
        self.0.lock().unwrap().calls.clone()
    }
}
async fn largest(State(mock): State<Mock>, request: Request) -> Response {
    let (largest, status, delay) = {
        let mut state = mock.0.lock().unwrap();
        state.calls.push((
            request.uri().path().to_owned(),
            request.uri().query().unwrap_or_default().to_owned(),
        ));
        (state.largest, state.status, state.delay)
    };
    tokio::time::sleep(delay).await;
    match status {
        Some(status) => (status, "upstream failure").into_response(),
        None => (
            [(header::CONTENT_TYPE, "application/json")],
            largest.to_string(),
        )
            .into_response(),
    }
}
async fn tracing_store(mock: Mock) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/tracings/annotation/{id}/largestIdOrZero", get(largest))
        .with_state(mock);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

async fn world(db: &TestDb, tracing_url: &str) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let collaborator = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('reserve','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('reserve',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'reserve',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    World {
        owner,
        collaborator,
        foreign,
        dataset,
    }
}

async fn annotation(db: &TestDb, w: &World, visibility: &str, state: &str, mode: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility,state,collaborationMode) VALUES($1,$2,$3,'Explorational',$4::webknossos.ANNOTATION_VISIBILITY,$5::webknossos.ANNOTATION_STATE,$6::webknossos.ANNOTATION_COLLABORATION_MODE)")
        .bind(&id).bind(&w.dataset).bind(&w.owner.user_id).bind(visibility).bind(state).bind(mode)
        .execute(&db.pool).await.unwrap();
    id
}

fn app(db: &TestDb) -> Router {
    let provider = AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig::default()).unwrap(),
    );
    Router::new()
        .nest("/api", annotation_reservations::router(false))
        .nest("/api", annotation_lifecycle::router())
        .layer(Extension(provider))
        .layer(Extension(
            ServiceClients::new(ServiceClientConfig::default()).unwrap(),
        ))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn send(
    app: &Router,
    method: Method,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-auth-token", token);
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    let body = body.map_or_else(Body::empty, |body| Body::from(body.to_string()));
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn reserve(
    app: &Router,
    token: &str,
    id: &str,
    tracing: &str,
    domain: &str,
    count: i64,
    release: &[i64],
) -> (StatusCode, Value) {
    send(
        app,
        Method::POST,
        token,
        &format!("/api/annotations/{id}/reserveIds"),
        Some(json!({"domain":domain,"tracingId":tracing,"numberOfIdsToReserve":count,"idsToRelease":release})),
    )
    .await
}

async fn reserved(
    app: &Router,
    token: &str,
    id: &str,
    tracing: &str,
    domain: &str,
) -> (StatusCode, Value) {
    send(
        app,
        Method::GET,
        token,
        &format!("/api/annotations/{id}/reservedIds?tracingId={tracing}&domain={domain}"),
        None,
    )
    .await
}

fn error(message: &str) -> Value {
    json!({"messages":[{"error":message}]})
}

async fn rows(db: &TestDb, id: &str) -> Vec<(String, String, String, i64)> {
    sqlx::query_as("SELECT tracingId,domain::text,_user,id FROM webknossos.annotation_reserved_ids WHERE _annotation=$1 ORDER BY tracingId,domain,id")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn permissions_validation_and_limit_are_checked_before_any_reservation() {
    let db = TestDb::new().await;
    let mock = Mock::new(7);
    let w = world(&db, &tracing_store(mock.clone()).await).await;
    let app = app(&db);
    let owner_only = annotation(&db, &w, "Internal", "Active", "OwnerOnly").await;
    let private = annotation(&db, &w, "Private", "Active", "Concurrent").await;
    let finished = annotation(&db, &w, "Internal", "Finished", "Concurrent").await;
    let (owner, collaborator, foreign) = (&w.owner.token, &w.collaborator.token, &w.foreign.token);

    // Missing, unreadable and foreign annotations are 404 (provider lookup).
    let missing = object_id();
    for (token, id) in [
        (owner, &missing),
        (collaborator, &private),
        (foreign, &owner_only),
    ] {
        let (status, body) = reserved(&app, token, id, "t", "Segment").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
        let (status, _) = reserve(&app, token, id, "t", "Segment", 1, &[]).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    // Readable but not updatable: GET allowed, POST 403.
    assert_eq!(
        reserved(&app, collaborator, &owner_only, "t", "Segment").await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        reserve(&app, collaborator, &owner_only, "t", "Segment", 1, &[]).await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    assert_eq!(
        reserve(&app, owner, &finished, "t", "Segment", 1, &[]).await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    // Domain validation: query is case-sensitive Empty -> 404; body is JSON 400.
    assert_eq!(
        reserved(&app, owner, &owner_only, "t", "segment").await,
        (StatusCode::NOT_FOUND, error(RESOURCE_NOT_FOUND))
    );
    let (status, _) = reserve(&app, owner, &owner_only, "t", "segment", 1, &[]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send(
        &app,
        Method::GET,
        owner,
        &format!("/api/annotations/{owner_only}/reservedIds?domain=Segment"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send(
        &app,
        Method::POST,
        owner,
        &format!("/api/annotations/{owner_only}/reserveIds"),
        Some(json!({"domain":"Segment","tracingId":"t","numberOfIdsToReserve":1})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Per-request limit (10), checked after the update permission.
    assert_eq!(
        reserve(&app, owner, &owner_only, "t", "Segment", 11, &[]).await,
        (
            StatusCode::FORBIDDEN,
            error("Cannot reserve more than 10 ids in one request.")
        )
    );
    assert_eq!(
        reserve(&app, collaborator, &owner_only, "t", "Segment", 11, &[]).await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    assert!(mock.calls().is_empty());
    assert!(rows(&db, &owner_only).await.is_empty());
    assert_eq!(
        reserve(&app, owner, &owner_only, "t", "Segment", 10, &[]).await,
        (
            StatusCode::OK,
            json!([8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
        )
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn first_reservation_uses_tracingstore_maximum_then_continues_and_releases() {
    let db = TestDb::new().await;
    let mock = Mock::new(41);
    let w = world(&db, &tracing_store(mock.clone()).await).await;
    let app = app(&db);
    let id = annotation(&db, &w, "Internal", "Active", "Concurrent").await;
    let (owner, collaborator) = (&w.owner.token, &w.collaborator.token);

    assert_eq!(
        reserve(&app, owner, &id, "vol", "Segment", 3, &[]).await,
        (StatusCode::OK, json!([42, 43, 44]))
    );
    let calls = mock.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].0,
        format!("/tracings/annotation/{id}/largestIdOrZero")
    );
    let query: Vec<(String, String)> = serde_urlencoded::from_str(&calls[0].1).unwrap();
    assert!(query.contains(&("tracingId".into(), "vol".into())));
    assert!(query.contains(&("domain".into(), "Segment".into())));
    assert!(query.iter().any(|(k, v)| k == "token" && !v.is_empty()));
    // Subsequent reservations continue from the database maximum, any user.
    assert_eq!(
        reserve(&app, collaborator, &id, "vol", "Segment", 2, &[]).await,
        (StatusCode::OK, json!([45, 46]))
    );
    assert_eq!(mock.calls().len(), 1);
    // Other domains and tracings are independent and ask the tracing store.
    assert_eq!(
        reserve(&app, owner, &id, "vol", "SegmentGroup", 1, &[]).await,
        (StatusCode::OK, json!([42]))
    );
    assert_eq!(
        reserve(&app, owner, &id, "skel", "Segment", 0, &[]).await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(mock.calls().len(), 3);
    // Reads are per user, tracing and domain.
    assert_eq!(
        reserved(&app, owner, &id, "vol", "Segment").await,
        (StatusCode::OK, json!([42, 43, 44]))
    );
    assert_eq!(
        reserved(&app, collaborator, &id, "vol", "Segment").await,
        (StatusCode::OK, json!([45, 46]))
    );
    assert_eq!(
        reserved(&app, collaborator, &id, "skel", "Segment").await,
        (StatusCode::OK, json!([]))
    );
    // Release only affects the caller's own ids in that tracing and domain.
    assert_eq!(
        reserve(&app, owner, &id, "vol", "Segment", 0, &[42, 43, 45, 46]).await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        reserved(&app, owner, &id, "vol", "Segment").await,
        (StatusCode::OK, json!([44]))
    );
    assert_eq!(
        reserved(&app, collaborator, &id, "vol", "SegmentGroup").await,
        (StatusCode::OK, json!([]))
    );
    // Reserve and release in one request; the maximum is computed first.
    assert_eq!(
        reserve(&app, collaborator, &id, "vol", "Segment", 1, &[45, 46]).await,
        (StatusCode::OK, json!([47]))
    );
    assert_eq!(
        reserved(&app, collaborator, &id, "vol", "Segment").await,
        (StatusCode::OK, json!([47]))
    );
    // As in Scala, the next start is the remaining maximum + 1.
    assert_eq!(
        reserve(&app, collaborator, &id, "vol", "Segment", 0, &[47]).await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        reserve(&app, collaborator, &id, "vol", "Segment", 1, &[]).await,
        (StatusCode::OK, json!([45]))
    );
    assert_eq!(mock.calls().len(), 3);

    // Upstream failure keeps its status and reserves nothing.
    let before = rows(&db, &id).await;
    mock.0.lock().unwrap().status = Some(StatusCode::BAD_REQUEST);
    let (status, _) = reserve(&app, owner, &id, "fresh", "Tree", 2, &[44]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(rows(&db, &id).await, before);
    // No live tracing store -> Msg.TracingStore.notFound.
    mock.0.lock().unwrap().status = None;
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=true")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        reserve(&app, owner, &id, "fresh", "Tree", 2, &[]).await,
        (StatusCode::BAD_REQUEST, error(TRACING_STORE_NOT_FOUND))
    );
    // Existing reservations never need the tracing store.
    assert_eq!(
        reserve(&app, owner, &id, "vol", "Segment", 1, &[]).await,
        (StatusCode::OK, json!([46]))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn concurrent_reservations_do_not_overlap_and_serialize_with_mode_changes() {
    let db = TestDb::new().await;
    let mock = Mock::new(100);
    mock.0.lock().unwrap().delay = Duration::from_millis(100);
    let w = world(&db, &tracing_store(mock.clone()).await).await;
    let id = annotation(&db, &w, "Internal", "Active", "Concurrent").await;

    // Independent routers/providers model separate application instances.
    let tasks: Vec<_> = (0..20)
        .map(|n| {
            let app = app(&db);
            let token = if n % 2 == 0 {
                w.owner.token.clone()
            } else {
                w.collaborator.token.clone()
            };
            let id = id.clone();
            tokio::spawn(async move { reserve(&app, &token, &id, "vol", "Node", 5, &[]).await })
        })
        .collect();
    let mut all = BTreeSet::new();
    for task in tasks {
        let (status, body) = task.await.unwrap();
        assert_eq!(status, StatusCode::OK, "{body}");
        for value in body.as_array().unwrap() {
            assert!(all.insert(value.as_i64().unwrap()), "duplicate {value}");
        }
    }
    assert_eq!(all, (101..=200).collect::<BTreeSet<i64>>());
    assert_eq!(mock.calls().len(), 1);
    assert_eq!(rows(&db, &id).await.len(), 100);

    // Leaving Concurrent mode deletes all reservations under the same lock.
    // The first reservation holds the lock during its slow tracing-store RPC;
    // the mode change queues behind it and later reservations (already past
    // the provider check) queue behind the mode change and must be rejected.
    mock.0.lock().unwrap().delay = Duration::from_millis(300);
    let racer = annotation(&db, &w, "Internal", "Active", "Concurrent").await;
    let spawn_reservation = || {
        let app = app(&db);
        let token = w.collaborator.token.clone();
        let racer = racer.clone();
        tokio::spawn(async move { reserve(&app, &token, &racer, "vol", "Tree", 2, &[]).await })
    };
    let mut tasks = vec![spawn_reservation()];
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mode_change = {
        let app = app(&db);
        let token = w.owner.token.clone();
        let path = format!(
            "/api/annotations/Explorational/{racer}/collaborationMode?collaborationMode=OwnerOnly"
        );
        tokio::spawn(async move { send(&app, Method::PATCH, &token, &path, None).await })
    };
    tokio::time::sleep(Duration::from_millis(50)).await;
    tasks.extend((0..6).map(|_| spawn_reservation()));
    assert_eq!(mode_change.await.unwrap().0, StatusCode::OK);
    let mut statuses = Vec::new();
    for task in tasks {
        let (status, body) = task.await.unwrap();
        assert!(
            status == StatusCode::OK || status == StatusCode::FORBIDDEN,
            "{status} {body}"
        );
        statuses.push(status);
    }
    assert_eq!(statuses[0], StatusCode::OK);
    assert!(statuses.contains(&StatusCode::FORBIDDEN), "{statuses:?}");
    mock.0.lock().unwrap().delay = Duration::ZERO;
    let owner_app = app(&db);
    assert!(rows(&db, &racer).await.is_empty());
    assert_eq!(
        reserve(
            &owner_app,
            &w.collaborator.token,
            &racer,
            "vol",
            "Tree",
            1,
            &[]
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    // The owner may still reserve in OwnerOnly mode.
    assert_eq!(
        reserve(&owner_app, &w.owner.token, &racer, "vol", "Tree", 1, &[]).await,
        (StatusCode::OK, json!([101]))
    );
    db.cleanup().await;
}
