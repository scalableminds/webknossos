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
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationIdentifier, AnnotationProvider,
    },
    annotation_reopen::{self, REOPEN_FAILED, REOPEN_SUCCESS, owner_wait_elapsed},
    application_info::{MiscConfig, MiscState, default_features},
    auth::AuthUser,
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
    for (user, manages) in [
        (&owner.user_id, false),
        (&manager.user_id, true),
        (&outsider.user_id, false),
    ] {
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
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('reopen','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('reopen',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'reopen',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Reopen project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Reopen type','',true,true)")
        .bind(&task_type).bind(&f.organization_id).bind(&f.team_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasks(_id,_project,_tasktype,neededexperience_domain,neededexperience_value,totalinstances,pendinginstances,editposition,editrotation,boundingbox) VALUES($1,$2,$3,'test',0,10,7,ROW(0,0,0)::webknossos.vector3,ROW(0,0,0)::webknossos.vector3,ROW(1,2,3,10,20,30)::webknossos.BOUNDING_BOX)")
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

/// Seeds a Public annotation of the owner, `modified` set to now() plus the
/// given (possibly negative) number of seconds.
async fn annotation(
    db: &TestDb,
    w: &World,
    typ: &str,
    state: &str,
    modified_offset: i64,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,tracingTime,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,'Public',$6::webknossos.ANNOTATION_STATE,1234,now()+make_interval(secs=>$7))")
        .bind(&id).bind(&w.dataset).bind(if matches!(typ,"Task"|"TracingBase"){Some(&w.task)}else{None})
        .bind(&w.owner.user_id).bind(typ).bind(state).bind(modified_offset as f64).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

fn app_with(db: &TestDb, reopen_seconds: Option<i64>) -> (Router, AnnotationProvider) {
    let provider = AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig::default()).unwrap(),
    );
    let mut features = default_features();
    if let Some(seconds) = reopen_seconds {
        features.insert("taskReopenAllowedInSeconds".into(), json!(seconds));
    }
    let app = Router::new()
        .nest("/api", annotation_reopen::router(false))
        .layer(Extension(provider.clone()))
        .layer(Extension(MiscState::new(MiscConfig {
            features,
            ..MiscConfig::default()
        })))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    (app, provider)
}

fn app(db: &TestDb) -> (Router, AnnotationProvider) {
    app_with(db, None)
}

async fn reopen(app: &Router, token: &str, typ: &str, id: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/annotations/{typ}/{id}/reopen"))
                .header("x-auth-token", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn error(s: &str) -> Value {
    json!({"messages":[{"error":s}]})
}

fn reopen_failed() -> (StatusCode, Value) {
    (StatusCode::BAD_REQUEST, error(REOPEN_FAILED))
}

/// (state, modified ms, tracingTime)
async fn row(db: &TestDb, id: &str) -> (String, i64, Option<i64>) {
    sqlx::query_as("SELECT state::text,floor(extract(epoch FROM modified)*1000)::bigint,tracingTime FROM webknossos.annotations WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

async fn pending(db: &TestDb, w: &World) -> i64 {
    sqlx::query_scalar("SELECT pendingInstances::bigint FROM webknossos.tasks WHERE _id=$1")
        .bind(&w.task)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

#[test]
fn pure_owner_gate_is_strictly_after_configured_plus_ten_seconds() {
    let modified = 1_700_000_000_000;
    assert!(!owner_wait_elapsed(modified, modified, 30));
    assert!(!owner_wait_elapsed(modified + 39_999, modified, 30));
    // Equality with modified + 40 s is not yet past.
    assert!(!owner_wait_elapsed(modified + 40_000, modified, 30));
    assert!(owner_wait_elapsed(modified + 40_001, modified, 30));
    assert!(!owner_wait_elapsed(modified + 10_000, modified, 0));
    assert!(owner_wait_elapsed(modified + 10_001, modified, 0));
    // Negative configuration shortens the wait; overflow never passes.
    assert!(!owner_wait_elapsed(modified, modified, -10));
    assert!(owner_wait_elapsed(modified + 1, modified, -10));
    assert!(!owner_wait_elapsed(i64::MAX, i64::MAX - 1, 30));
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn owner_time_gate_and_success_response_shape() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let (app, _) = app(&db);

    // Unauthenticated requests never reach the gate.
    let fresh = annotation(&db, &w, "Explorational", "Finished", -20).await;
    assert_eq!(
        reopen(&app, "", "Explorational", &fresh).await.0,
        StatusCode::UNAUTHORIZED
    );
    // Default 30 s + 10 s: 20 s and 35 s after modification are too early.
    let early = annotation(&db, &w, "Explorational", "Finished", -35).await;
    for id in [&fresh, &early] {
        let before = row(&db, id).await;
        assert_eq!(
            reopen(&app, &w.owner.token, "Explorational", id).await,
            reopen_failed()
        );
        assert_eq!(row(&db, id).await, before);
    }

    let id = annotation(&db, &w, "Explorational", "Finished", -60).await;
    let before = row(&db, &id).await;
    let (status, body) = reopen(&app, &w.owner.token, "Explorational", &id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["messages"], json!([{"success": REOPEN_SUCCESS}]));
    assert_eq!(body["state"], "Active");
    assert_eq!(body["id"], id);
    assert_eq!(body["typ"], "Explorational");
    assert_eq!(body["datasetId"], w.dataset);
    assert_eq!(body["tracingTime"], 1234);
    // modified/tracingTime are untouched; only the state changes.
    assert_eq!(body["modified"], before.1);
    for key in [
        "created",
        "isLockedByOwner",
        "name",
        "description",
        "annotationLayers",
        "visibility",
        "collaborationMode",
        "tags",
        "teams",
        "owner",
        "contributors",
        "restrictions",
        "settings",
        "task",
        "user",
        "tracingStore",
        "dataStore",
    ] {
        assert!(body.get(key).is_some(), "missing {key} in {body}");
    }
    assert_eq!(
        body["annotationLayers"][0]["tracingId"],
        format!("tracing-{id}")
    );
    let after = row(&db, &id).await;
    assert_eq!(after, ("Active".into(), before.1, before.2));

    // Already Active: the Finished gate fails, also for administrators.
    for token in [&w.owner.token, &w.f.token] {
        assert_eq!(
            reopen(&app, token, "Explorational", &id).await,
            reopen_failed()
        );
    }
    for state in ["Active", "Cancelled", "Initializing"] {
        let other = annotation(&db, &w, "Explorational", state, -3600).await;
        assert_eq!(
            reopen(&app, &w.f.token, "Explorational", &other).await,
            reopen_failed(),
            "{state}"
        );
        assert_eq!(row(&db, &other).await.0, state);
    }

    // The configured feature value is honoured: 0 s + 10 s.
    let (short, _) = app_with(&db, Some(0));
    let five = annotation(&db, &w, "Explorational", "Finished", -5).await;
    let fifteen = annotation(&db, &w, "Explorational", "Finished", -15).await;
    assert_eq!(
        reopen(&short, &w.owner.token, "Explorational", &five).await,
        reopen_failed()
    );
    assert_eq!(
        reopen(&short, &w.owner.token, "Explorational", &fifteen)
            .await
            .0,
        StatusCode::OK
    );
    // A modification timestamp in the future never passes the owner gate.
    let (zero_wait, _) = app_with(&db, Some(-10));
    let future = annotation(&db, &w, "Explorational", "Finished", 3600).await;
    assert_eq!(
        reopen(&zero_wait, &w.owner.token, "Explorational", &future).await,
        reopen_failed()
    );
    // Missing annotations fail in the provider before the reopen gate, with
    // the DAO failure's default 400 status (no explicit status on the first
    // provideAnnotation).
    let (status, body) = reopen(&app, &w.owner.token, "Explorational", &object_id()).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(ANNOTATION_NOT_FOUND))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn managers_and_admins_bypass_time_gate_and_others_fail() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let (app, _) = app(&db);
    // TaskService.publicWrites needs the task's base annotation.
    annotation(&db, &w, "TracingBase", "Finished", -3600).await;
    let id = annotation(&db, &w, "Task", "Finished", 0).await;
    let old = annotation(&db, &w, "Task", "Finished", -3600).await;
    // Inserting task annotations moves pendingInstances (database trigger);
    // reopening Finished -> Active must not.
    let pending_before = pending(&db, &w).await;
    // Ownership alone does not bypass; plain team members and foreign
    // administrators are not allowed even though the annotation is readable.
    for token in [&w.owner.token, &w.outsider.token, &w.foreign.token] {
        assert_eq!(reopen(&app, token, "Task", &id).await, reopen_failed());
        assert_eq!(row(&db, &id).await.0, "Finished");
    }
    // Also for the outsider long after the owner's wait.
    assert_eq!(
        reopen(&app, &w.outsider.token, "Task", &old).await,
        reopen_failed()
    );
    let (status, body) = reopen(&app, &w.manager.token, "Task", &id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["state"], "Active");
    assert_eq!(body["messages"], json!([{"success": REOPEN_SUCCESS}]));
    assert_eq!(row(&db, &id).await.0, "Active");
    assert_eq!(pending(&db, &w).await, pending_before);

    // Owner-organization administrator bypasses the gate for fresh
    // explorationals (no task) and task annotations alike.
    for typ in ["Explorational", "Task"] {
        let id = annotation(&db, &w, typ, "Finished", 0).await;
        let pending_before = pending(&db, &w).await;
        let (status, body) = reopen(&app, &w.f.token, typ, &id).await;
        assert_eq!(status, StatusCode::OK, "{typ}: {body}");
        assert_eq!(row(&db, &id).await.0, "Active");
        assert_eq!(pending(&db, &w).await, pending_before);
    }

    // Scala resolves the task and project even for administrators: a
    // soft-deleted task makes every reopen fail.
    let orphaned = annotation(&db, &w, "Task", "Finished", -3600).await;
    sqlx::query("UPDATE webknossos.tasks SET isDeleted=true WHERE _id=$1")
        .bind(&w.task)
        .execute(&db.pool)
        .await
        .unwrap();
    for token in [&w.f.token, &w.owner.token, &w.manager.token] {
        assert_eq!(
            reopen(&app, token, "Task", &orphaned).await,
            reopen_failed()
        );
    }
    assert_eq!(row(&db, &orphaned).await.0, "Finished");
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
async fn successful_task_reopen_invalidates_three_compounds_and_compounds_fail() {
    let db = TestDb::new().await;
    let observations = Mock::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let mock_app = Router::new()
        .route("/{*path}", any(mock))
        .with_state(observations.clone());
    let server = tokio::spawn(async move { axum::serve(listener, mock_app).await.unwrap() });
    let w = world(&db, &url).await;
    let finished = annotation(&db, &w, "Task", "Finished", 0).await;
    let base = annotation(&db, &w, "TracingBase", "Finished", 0).await;
    // Keeps the compounds mergeable after `finished` is reopened.
    annotation(&db, &w, "Task", "Finished", -3600).await;
    let explorational = annotation(&db, &w, "Explorational", "Finished", -3600).await;
    let (app, provider) = app(&db);
    let admin = AuthUser {
        id: w.f.user_id.clone(),
        organization_id: w.f.organization_id.clone(),
        is_admin: true,
        is_dataset_manager: false,
        is_superuser: false,
    };
    let keys = [
        ("CompoundTask", &w.task),
        ("CompoundProject", &w.project),
        ("CompoundTaskType", &w.task_type),
    ];
    let prime = async || {
        for (typ, id) in keys {
            provider
                .provide(
                    AccessContext::requester(Some(&admin)),
                    typ,
                    &ObjectId::parse(id).unwrap(),
                )
                .await
                .unwrap();
        }
    };
    let cached = || {
        keys.map(|(typ, id)| {
            let identifier =
                AnnotationIdentifier::parse(typ, &ObjectId::parse(id).unwrap()).unwrap();
            provider.find_in_cache(&identifier.identifier).is_some()
        })
    };
    prime().await;
    assert_eq!(*observations.0.lock().unwrap(), 3);
    assert_eq!(cached(), [true; 3]);

    // A synthetic compound is Active: it resolves from the cache and fails
    // the Finished gate without writing anything.
    for (typ, id) in keys {
        assert_eq!(reopen(&app, &w.f.token, typ, id).await, reopen_failed());
    }
    assert_eq!(*observations.0.lock().unwrap(), 3);
    // Failed gate and non-task reopen keep the caches.
    assert_eq!(
        reopen(&app, &w.owner.token, "Task", &finished).await,
        reopen_failed()
    );
    assert_eq!(
        reopen(&app, &w.owner.token, "Explorational", &explorational)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(cached(), [true; 3]);

    // Injected UPDATE failure rolls back and keeps the caches.
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_reopen() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$; CREATE TRIGGER reject_reopen BEFORE UPDATE ON webknossos.annotations FOR EACH ROW EXECUTE FUNCTION webknossos.reject_reopen();")
        .execute(&db.pool).await.unwrap();
    assert_eq!(
        reopen(&app, &w.manager.token, "Task", &finished).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(row(&db, &finished).await.0, "Finished");
    assert_eq!(cached(), [true; 3]);
    sqlx::query("DROP TRIGGER reject_reopen ON webknossos.annotations")
        .execute(&db.pool)
        .await
        .unwrap();

    let (status, body) = reopen(&app, &w.manager.token, "Task", &finished).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(cached(), [false; 3]);
    assert_eq!(row(&db, &finished).await.0, "Active");

    // TracingBase annotations with a task clear all three keys as well.
    prime().await;
    assert_eq!(cached(), [true; 3]);
    let (status, body) = reopen(&app, &w.f.token, "TracingBase", &base).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(cached(), [false; 3]);
    server.abort();
    db.cleanup().await;
}
