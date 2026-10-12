mod common;

use axum::{
    Extension, Router,
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
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    annotation_lifecycle::{self, ARCHIVED, CANCEL_SUCCESS, COLLABORATION_TYPES_ONLY},
    annotation_metadata::NOT_ALLOWED,
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationIdentifier, AnnotationProvider,
        RESOURCE_NOT_FOUND,
    },
    id::ObjectId,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    service_clients::ServiceClientConfig,
    tracingstore_client::TracingStoreClient,
};

struct World {
    f: Fixture,
    owner: UserFixture,
    manager: UserFixture,
    outsider: UserFixture,
    foreign: UserFixture,
    dataset: String,
    task: String,
    project: String,
    task_type: String,
}

async fn world(db: &TestDb, tracing_url: &str) -> World {
    let f = db.fixture().await;
    let owner = db.seed_user(&object_id(), &f.organization_id, false).await;
    let manager = db.seed_user(&object_id(), &f.organization_id, false).await;
    let outsider = db.seed_user(&object_id(), &f.organization_id, false).await;
    let foreign = db
        .seed_user(&object_id(), &format!("foreign-{}", object_id()), true)
        .await;
    for (user, manages) in [(&owner.user_id, false), (&manager.user_id, true)] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,$3)",
        )
        .bind(user)
        .bind(&f.team_id)
        .bind(manages)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('lifecycle','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('lifecycle',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'lifecycle',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Lifecycle project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Lifecycle type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,10,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
        .bind(&task).bind(&project).bind(&task_type).execute(&db.pool).await.unwrap();
    World {
        f,
        owner,
        manager,
        outsider,
        foreign,
        dataset,
        task,
        project,
        task_type,
    }
}

async fn annotation(
    db: &TestDb,
    w: &World,
    typ: &str,
    visibility: &str,
    state: &str,
    mode: &str,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,isLockedByOwner,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,$8::webknossos.ANNOTATION_COLLABORATION_MODE,true,TIMESTAMPTZ '2020-01-01T00:00:00Z')")
        .bind(&id).bind(&w.dataset).bind(if matches!(typ,"Task"|"TracingBase"){Some(&w.task)}else{None})
        .bind(&w.owner.user_id).bind(typ).bind(visibility).bind(state).bind(mode).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

fn app(db: &TestDb) -> (Router, AnnotationProvider) {
    let provider = AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig::default()).unwrap(),
    );
    let app = Router::new()
        .nest("/api", annotation_lifecycle::router())
        .layer(Extension(provider.clone()))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    (app, provider)
}

async fn send(
    app: &Router,
    method: Method,
    token: &str,
    path: &str,
) -> (StatusCode, Value, Vec<u8>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-auth-token", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        bytes,
    )
}
fn error(s: &str) -> Value {
    json!({"messages":[{"error":s}]})
}
async fn state(db: &TestDb, id: &str) -> (String, String, bool, i64) {
    sqlx::query_as("SELECT state::text,collaborationMode::text,isDeleted,floor(extract(epoch FROM modified)*1000)::bigint FROM webknossos.annotations WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}
async fn reserve(db: &TestDb, w: &World, id: &str) {
    for (domain, user) in [("Segment", &w.owner.user_id), ("Tree", &w.manager.user_id)] {
        sqlx::query("INSERT INTO webknossos.annotation_reserved_ids(_annotation,tracingId,domain,_user,id) VALUES($1,$2,$3::webknossos.ANNOTATION_ID_DOMAIN,$4,1)")
            .bind(id).bind(format!("tracing-{id}")).bind(domain).bind(user).execute(&db.pool).await.unwrap();
    }
}
async fn reservations(db: &TestDb, id: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM webknossos.annotation_reserved_ids WHERE _annotation=$1",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn cancel_requires_manager_access_and_preserves_non_task_rows_and_dependencies() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let id = annotation(&db, &w, "Task", "Internal", "Active", "Concurrent").await;
    reserve(&db, &w, &id).await;
    sqlx::query("INSERT INTO webknossos.annotation_mutexes(_annotation,_user,sessionId,expiry) VALUES($1,$2,'other-session',now()+interval '1 hour')")
        .bind(&id).bind(&w.owner.user_id).execute(&db.pool).await.unwrap();
    let (app, _) = app(&db);
    let path = format!("/api/annotations/View/{id}");
    for token in ["", &w.owner.token, &w.outsider.token] {
        let (status, body, _) = send(&app, Method::DELETE, token, &path).await;
        if token.is_empty() {
            assert_eq!(status, StatusCode::UNAUTHORIZED);
        } else {
            assert_eq!(
                (status, body),
                (StatusCode::NOT_FOUND, error(RESOURCE_NOT_FOUND))
            );
        }
    }
    let before = state(&db, &id).await;
    let pending_before: i64 =
        sqlx::query_scalar("SELECT pendingInstances::bigint FROM webknossos.tasks WHERE _id=$1")
            .bind(&w.task)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let (status, body, _) = send(&app, Method::DELETE, &w.manager.token, &path).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::OK,
            json!({"messages":[{"success":CANCEL_SUCCESS}]})
        )
    );
    let after = state(&db, &id).await;
    assert_eq!(after.0, "Cancelled");
    let pending_after: i64 =
        sqlx::query_scalar("SELECT pendingInstances::bigint FROM webknossos.tasks WHERE _id=$1")
            .bind(&w.task)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(pending_after, pending_before + 1);
    assert_eq!(
        (&after.1, after.2, after.3),
        (&before.1, before.2, before.3)
    );
    assert_eq!(reservations(&db, &id).await, 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM webknossos.annotation_layers WHERE _annotation=$1"
        )
        .bind(&id)
        .fetch_one(&db.pool)
        .await
        .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM webknossos.annotation_mutexes WHERE _annotation=$1"
        )
        .bind(&id)
        .fetch_one(&db.pool)
        .await
        .unwrap(),
        1
    );
    let (status, body, _) = send(
        &app,
        Method::DELETE,
        &w.manager.token,
        &format!("/api/annotations/pretty-{}", id.to_ascii_uppercase()),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::OK,
            json!({"messages":[{"success":CANCEL_SUCCESS}]})
        )
    );

    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT pendingInstances::bigint FROM webknossos.tasks WHERE _id=$1"
        )
        .bind(&w.task)
        .fetch_one(&db.pool)
        .await
        .unwrap(),
        pending_after
    );
    for typ in ["Explorational", "TracingBase", "Orphan"] {
        let id = annotation(&db, &w, typ, "Public", "Finished", "OwnerOnly").await;
        let before = state(&db, &id).await;
        let (status, body, _) = send(
            &app,
            Method::DELETE,
            &w.f.token,
            &format!("/api/annotations/Task/{id}"),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::OK, json!({"messages":[{"success":ARCHIVED}]}))
        );
        assert_eq!(state(&db, &id).await, before);
        let (status, body, _) = send(
            &app,
            Method::DELETE,
            &w.foreign.token,
            &format!("/api/annotations/{id}"),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(RESOURCE_NOT_FOUND))
        );
    }
    let deleted = annotation(&db, &w, "Task", "Public", "Active", "OwnerOnly").await;
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=true WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    for missing in [deleted, object_id()] {
        for path in [
            format!("/api/annotations/Task/{missing}"),
            format!("/api/annotations/{missing}"),
        ] {
            let (status, body, _) = send(&app, Method::DELETE, &w.f.token, &path).await;
            assert_eq!(
                (status, body),
                (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
            );
        }
    }
    let private = annotation(&db, &w, "Task", "Private", "Active", "OwnerOnly").await;
    let (status, body, _) = send(
        &app,
        Method::DELETE,
        &w.manager.token,
        &format!("/api/annotations/Task/{private}"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    let (status, _, _) = send(
        &app,
        Method::DELETE,
        &w.f.token,
        &format!("/api/annotations/{private}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body, _) = send(
        &app,
        Method::DELETE,
        &w.f.token,
        &format!("/api/annotations/task/{id}"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error("Invalid AnnotationType: task"))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn collaboration_modes_require_actual_owner_and_release_only_when_leaving_concurrent() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let (app, _) = app(&db);
    let (status, body, _) = send(
        &app,
        Method::PATCH,
        &w.owner.token,
        &format!("/api/annotations/Task/{}/collaborationMode", object_id()),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Missing parameter: collaborationMode")
        )
    );
    for typ in ["Explorational", "Task"] {
        let id = annotation(&db, &w, typ, "Internal", "Finished", "Concurrent").await;
        reserve(&db, &w, &id).await;
        let path = |mode: &str| {
            format!("/api/annotations/Orphan/{id}/collaborationMode?collaborationMode={mode}")
        };
        for token in [&w.f.token, &w.manager.token, &w.outsider.token] {
            let (status, body, _) = send(&app, Method::PATCH, token, &path("OwnerOnly")).await;
            assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
        }
        let (status, body, _) =
            send(&app, Method::PATCH, &w.owner.token, &path("concurrent")).await;
        assert_eq!(
            (status, body),
            (StatusCode::NOT_FOUND, error(RESOURCE_NOT_FOUND))
        );
        for (mode, count) in [("Concurrent", 2), ("Exclusive", 0)] {
            let (status, _, bytes) = send(&app, Method::PATCH, &w.owner.token, &path(mode)).await;
            assert_eq!(status, StatusCode::OK);
            assert!(bytes.is_empty());
            assert_eq!(reservations(&db, &id).await, count);
        }
        reserve(&db, &w, &id).await;
        for mode in ["OwnerOnly", "Concurrent", "Concurrent"] {
            let (status, _, _) = send(&app, Method::PATCH, &w.owner.token, &path(mode)).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(reservations(&db, &id).await, 2);
        }
        let (status, _, _) = send(&app, Method::PATCH, &w.owner.token, &path("OwnerOnly")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(reservations(&db, &id).await, 0);
        let row = state(&db, &id).await;
        assert_eq!(
            (row.0, row.1, row.2, row.3),
            ("Finished".into(), "OwnerOnly".into(), false, 1577836800000)
        );
    }
    let base = annotation(&db, &w, "TracingBase", "Internal", "Active", "Concurrent").await;
    let (status, body, _) = send(
        &app,
        Method::PATCH,
        &w.f.token,
        &format!("/api/annotations/Task/{base}/collaborationMode?collaborationMode=bogus"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(COLLABORATION_TYPES_ONLY))
    );
    let missing = object_id();
    let (status, body, _) = send(
        &app,
        Method::PATCH,
        &w.owner.token,
        &format!("/api/annotations/Task/{missing}/collaborationMode?collaborationMode=OwnerOnly"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(ANNOTATION_NOT_FOUND))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn collaboration_release_failure_rolls_back_mode_and_cancel_failure_preserves_state() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let id = annotation(&db, &w, "Task", "Internal", "Finished", "Concurrent").await;
    reserve(&db, &w, &id).await;
    let (app, _) = app(&db);
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_reservation_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$; CREATE TRIGGER reject_reservation_delete BEFORE DELETE ON webknossos.annotation_reserved_ids FOR EACH ROW EXECUTE FUNCTION webknossos.reject_reservation_delete();")
        .execute(&db.pool).await.unwrap();
    let before = state(&db, &id).await;
    let (status, _, _) = send(
        &app,
        Method::PATCH,
        &w.owner.token,
        &format!("/api/annotations/Task/{id}/collaborationMode?collaborationMode=OwnerOnly"),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(state(&db, &id).await, before);
    assert_eq!(reservations(&db, &id).await, 2);
    sqlx::query("UPDATE webknossos.projects SET isDeleted=true WHERE _id=$1")
        .bind(&w.project)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _, _) = send(
        &app,
        Method::DELETE,
        &w.f.token,
        &format!("/api/annotations/Task/{id}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(state(&db, &id).await, before);
    db.cleanup().await;
}

#[derive(Clone, Default)]
struct Mock(Arc<Mutex<usize>>);
async fn mock(State(mock): State<Mock>, request: Request) -> Response {
    assert!(request.uri().path().ends_with("/mergedFromIds"));
    assert!(to_bytes(request.into_body(), 1024 * 1024).await.is_ok());
    *mock.0.lock().unwrap() += 1;
    let proto = AnnotationProto {
        description: String::new(),
        version: 0,
        earliest_accessible_version: 0,
        annotation_layers: vec![AnnotationLayerProto {
            tracing_id: "merged".into(),
            name: "Skeleton".into(),
            typ: AnnotationLayerTypeProto::Skeleton as i32,
        }],
        skeleton_may_have_pending_updates: None,
        editable_mappings_may_have_pending_updates: None,
        user_states: vec![],
    };
    (
        [(header::CONTENT_TYPE, "application/x-protobuf")],
        proto.encode_to_vec(),
    )
        .into_response()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn finished_cancellation_invalidates_three_compounds_and_compound_routes_keep_real_provider_semantics()
 {
    let db = TestDb::new().await;
    let observations = Mock::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let mock_app = Router::new()
        .route("/{*path}", any(mock))
        .with_state(observations.clone());
    let server = tokio::spawn(async move { axum::serve(listener, mock_app).await.unwrap() });
    let w = world(&db, &url).await;
    let finished = annotation(&db, &w, "Task", "Internal", "Finished", "OwnerOnly").await;
    let active = annotation(&db, &w, "Task", "Internal", "Active", "OwnerOnly").await;
    let (app, provider) = app(&db);
    let keys = [
        ("CompoundTask", &w.task),
        ("CompoundProject", &w.project),
        ("CompoundTaskType", &w.task_type),
    ];
    for (typ, id) in keys {
        provider
            .provide(
                AccessContext::requester(Some(&webknossos_backend::auth::AuthUser {
                    id: w.f.user_id.clone(),
                    organization_id: w.f.organization_id.clone(),
                    is_admin: true,
                    is_dataset_manager: false,
                    is_superuser: false,
                })),
                typ,
                &ObjectId::parse(id).unwrap(),
            )
            .await
            .unwrap();
    }
    assert_eq!(*observations.0.lock().unwrap(), 3);
    // Canceling an active task instance preserves existing finished compounds.
    let (status, _, _) = send(
        &app,
        Method::DELETE,
        &w.manager.token,
        &format!("/api/annotations/{active}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for (typ, id) in keys {
        assert!(
            provider
                .find_in_cache(&ObjectId::parse(id).unwrap())
                .is_some(),
            "{typ}"
        );
    }
    // Cached compound owner is the admin; cancel returns archive success and
    // does not cancel the constituent annotation or remove any cache.
    let (status, body, _) = send(
        &app,
        Method::DELETE,
        &w.f.token,
        &format!("/api/annotations/CompoundTask/{}", w.task),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::OK, json!({"messages":[{"success":ARCHIVED}]}))
    );
    assert_eq!(state(&db, &finished).await.0, "Finished");
    let (status, body, _) = send(
        &app,
        Method::PATCH,
        &w.f.token,
        &format!(
            "/api/annotations/CompoundTask/{}/collaborationMode?collaborationMode=Concurrent",
            w.task
        ),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(COLLABORATION_TYPES_ONLY))
    );
    assert_eq!(*observations.0.lock().unwrap(), 3);
    // Inject a failed state UPDATE: cache and row survive the failed request.
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$; CREATE TRIGGER reject_cancel BEFORE UPDATE ON webknossos.annotations FOR EACH ROW EXECUTE FUNCTION webknossos.reject_cancel();")
        .execute(&db.pool).await.unwrap();
    let (status, _, _) = send(
        &app,
        Method::DELETE,
        &w.manager.token,
        &format!("/api/annotations/View/{finished}"),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(state(&db, &finished).await.0, "Finished");
    for (_, id) in keys {
        assert!(
            provider
                .find_in_cache(&ObjectId::parse(id).unwrap())
                .is_some()
        );
    }
    sqlx::query("DROP TRIGGER reject_cancel ON webknossos.annotations")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _, _) = send(
        &app,
        Method::DELETE,
        &w.manager.token,
        &format!("/api/annotations/View/{finished}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for (typ, id) in keys {
        let identifier = AnnotationIdentifier::parse(typ, &ObjectId::parse(id).unwrap()).unwrap();
        assert!(provider.find_in_cache(&identifier.identifier).is_none());
    }
    assert_eq!(state(&db, &finished).await.0, "Cancelled");
    assert_eq!(*observations.0.lock().unwrap(), 3);
    server.abort();
    db.cleanup().await;
}
