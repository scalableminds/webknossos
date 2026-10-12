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
    annotation_finish::{
        self, ALL_FINISHED, ANNOTATION_FINISHED, FINISH_FAILED, TASK_FINISHED, parse_timestamp,
    },
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationIdentifier, AnnotationProvider,
    },
    auth::AuthUser,
    id::ObjectId,
    mail::MailSender,
    proto::{AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto},
    service_clients::ServiceClientConfig,
    time_interaction::{TimeInteractionConfig, TimeInteractionState},
    time_interaction_writer::{OverLimitNotifier, TimeInteractionWriter},
    tracingstore_client::TracingStoreClient,
};

const T: i64 = 1_700_000_000_000;

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
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('finish','http://localhost:9000','https://data.example.test','k')")
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('finish',$1,'https://trace.example.test','k')")
        .bind(tracing_url).execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey,isUsable,voxelSizeFactor,voxelSizeUnit) SELECT $1,'finish',_id,_rootfolder,'Dataset','dir',now(),true,ROW(1,1,1)::webknossos.vector3,'nanometer'::webknossos.LENGTH_UNIT FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    let (task, project, task_type) = (object_id(), object_id(), object_id());
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name) VALUES($1,$2,$3,$4,'Finish project')")
        .bind(&project).bind(&f.organization_id).bind(&f.team_id).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_branchpointsallowed,settings_somaclickingallowed) VALUES($1,$2,$3,'Finish type','',true,true)")
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

struct Seed<'a> {
    owner: &'a str,
    typ: &'a str,
    state: &'a str,
    visibility: &'a str,
    mode: &'a str,
    locked: bool,
}

impl<'a> Seed<'a> {
    fn new(owner: &'a str, typ: &'a str, state: &'a str) -> Self {
        Self {
            owner,
            typ,
            state,
            visibility: "Public",
            mode: "OwnerOnly",
            locked: false,
        }
    }
}

/// Seeds an annotation with tracingTime 1234 and modified one hour ago.
async fn annotation(db: &TestDb, w: &World, seed: Seed<'_>) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,isLockedByOwner,tracingTime,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,$8::webknossos.ANNOTATION_COLLABORATION_MODE,$9,1234,now()-interval '1 hour')")
        .bind(&id).bind(&w.dataset)
        .bind(if matches!(seed.typ, "Task" | "TracingBase") { Some(&w.task) } else { None })
        .bind(seed.owner).bind(seed.typ).bind(seed.visibility).bind(seed.state).bind(seed.mode).bind(seed.locked)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

fn app(db: &TestDb) -> (Router, AnnotationProvider) {
    let provider = AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig::default()).unwrap(),
    );
    let writer = TimeInteractionWriter::new(
        TimeInteractionState::default(),
        TimeInteractionConfig::default(),
        OverLimitNotifier::new(MailSender::default(), "https://wk.example.test"),
    );
    let app = Router::new()
        .nest("/api", annotation_finish::router(false))
        .layer(Extension(provider.clone()))
        .layer(Extension(writer))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    (app, provider)
}

async fn send(app: &Router, token: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(Method::PATCH)
        .uri(uri)
        .header("x-auth-token", token);
    let body = match body {
        Some(body) => {
            request = request.header(header::CONTENT_TYPE, "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
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

async fn finish(app: &Router, token: &str, typ: &str, id: &str, ts: i64) -> (StatusCode, Value) {
    send(
        app,
        token,
        &format!("/api/annotations/{typ}/{id}/finish?timestamp={ts}"),
        None,
    )
    .await
}

async fn finish_all(app: &Router, token: &str, ids: &[&str], ts: i64) -> (StatusCode, Value) {
    send(
        app,
        token,
        &format!("/api/annotations/Explorational/finish?timestamp={ts}"),
        Some(json!({ "annotations": ids })),
    )
    .await
}

fn error(s: &str) -> Value {
    json!({"messages":[{"error":s}]})
}

fn failed(status: StatusCode) -> (StatusCode, Value) {
    (status, error(FINISH_FAILED))
}

/// (state, modified ms, tracingTime)
async fn row(db: &TestDb, id: &str) -> (String, i64, Option<i64>) {
    sqlx::query_as("SELECT state::text,floor(extract(epoch FROM modified)*1000)::bigint,tracingTime FROM webknossos.annotations WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

/// (time, numberOfUpdates) of every time span of the user on the annotation.
async fn spans(db: &TestDb, user: &str, annotation: &str) -> Vec<(i64, i64)> {
    sqlx::query_as("SELECT time,numberOfUpdates::bigint FROM webknossos.timespans WHERE _user=$1 AND _annotation=$2 ORDER BY created")
        .bind(user).bind(annotation).fetch_all(&db.pool).await.unwrap()
}

async fn all_spans(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.timespans")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

#[test]
fn timestamp_binder_matches_play() {
    assert_eq!(parse_timestamp(Some("timestamp=42")).unwrap(), 42);
    assert_eq!(
        parse_timestamp(Some("other=1")).unwrap_err().message,
        "Missing parameter: timestamp"
    );
    assert_eq!(
        parse_timestamp(Some("timestamp=x")).unwrap_err().message,
        "Cannot parse parameter timestamp as Long: For input string: \"x\""
    );
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn owner_finish_logs_time_and_repeat_is_silent() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let (app, _) = app(&db);
    let id = annotation(
        &db,
        &w,
        Seed::new(&w.owner.user_id, "Explorational", "Active"),
    )
    .await;
    let before = row(&db, &id).await;

    // Query binding precedes authentication (Play routing).
    let path = format!("/api/annotations/Explorational/{id}/finish");
    assert_eq!(
        send(&app, "", &path, None).await,
        (
            StatusCode::BAD_REQUEST,
            error("Missing parameter: timestamp")
        )
    );
    assert_eq!(
        send(&app, &w.owner.token, &format!("{path}?timestamp=abc"), None).await,
        (
            StatusCode::BAD_REQUEST,
            error("Cannot parse parameter timestamp as Long: For input string: \"abc\"")
        )
    );
    assert_eq!(
        send(&app, "", &format!("{path}?timestamp={T}"), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(row(&db, &id).await, before);
    assert_eq!(all_spans(&db).await, 0);

    let (status, body) = finish(&app, &w.owner.token, "Explorational", &id, T).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["messages"],
        json!([{ "success": ANNOTATION_FINISHED }])
    );
    assert_eq!(body["state"], "Finished");
    assert_eq!(body["id"], id);
    assert_eq!(body["typ"], "Explorational");
    for key in [
        "created",
        "modified",
        "annotationLayers",
        "restrictions",
        "owner",
        "tracingStore",
        "dataStore",
        "tracingTime",
    ] {
        assert!(body.get(key).is_some(), "missing {key} in {body}");
    }
    let after = row(&db, &id).await;
    assert_eq!(after.0, "Finished");
    assert!(after.1 > before.1, "modified must be updated");
    assert_eq!(body["modified"], after.1);
    // One fresh zero-duration span at the client timestamp.
    assert_eq!(spans(&db, &w.owner.user_id, &id).await, vec![(0, 1)]);
    let start: i64 = sqlx::query_scalar("SELECT floor(extract(epoch FROM created)*1000)::bigint FROM webknossos.timespans WHERE _annotation=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(start, T);

    // Repeat: already Finished succeeds silently with the annotation message,
    // without touching modified, but still logs time (span extended); the
    // response is serialized after the logging.
    let (status, body) = finish(&app, &w.owner.token, "Explorational", &id, T + 1000).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["messages"],
        json!([{ "success": ANNOTATION_FINISHED }])
    );
    assert_eq!(body["tracingTime"], 2234);
    assert_eq!(
        row(&db, &id).await,
        ("Finished".into(), after.1, Some(2234))
    );
    assert_eq!(spans(&db, &w.owner.user_id, &id).await, vec![(1000, 2)]);

    // A prefixed path id is accepted like Play's ObjectId binder.
    let other = annotation(
        &db,
        &w,
        Seed::new(&w.owner.user_id, "Explorational", "Active"),
    )
    .await;
    let (status, _) = finish(
        &app,
        &w.owner.token,
        "Explorational",
        &format!("name-{other}"),
        T + 2000,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(row(&db, &other).await.0, "Finished");
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn finish_permissions_states_and_contributor_time_logging() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let (app, _) = app(&db);
    let owner = &w.owner.user_id;
    let id = annotation(&db, &w, Seed::new(owner, "Explorational", "Active")).await;
    let before = row(&db, &id).await;
    // Readable (Public) but neither owner, manager nor owner-org admin:
    // finishNotAllowed wrapped by finishFailed, default 400.
    for token in [&w.outsider.token, &w.foreign.token, &w.manager.token] {
        assert_eq!(
            finish(&app, token, "Explorational", &id, T).await,
            failed(StatusCode::BAD_REQUEST)
        );
    }
    assert_eq!(row(&db, &id).await, before);
    // Unreadable or missing: provider failure `~> NOT_FOUND`.
    let private = annotation(
        &db,
        &w,
        Seed {
            visibility: "Private",
            ..Seed::new(owner, "Explorational", "Active")
        },
    )
    .await;
    for (token, target) in [
        (&w.outsider.token, private.as_str()),
        (&w.owner.token, &object_id()),
    ] {
        assert_eq!(
            finish(&app, token, "Explorational", target, T).await,
            failed(StatusCode::NOT_FOUND)
        );
    }
    assert_eq!(row(&db, &private).await.0, "Active");
    // Locked by owner: not even the owner or an admin may finish.
    let locked = annotation(
        &db,
        &w,
        Seed {
            locked: true,
            ..Seed::new(owner, "Explorational", "Active")
        },
    )
    .await;
    for token in [&w.owner.token, &w.f.token] {
        assert_eq!(
            finish(&app, token, "Explorational", &locked, T).await,
            failed(StatusCode::BAD_REQUEST)
        );
    }
    // Neither Active nor Finished: notActive.
    for state in ["Cancelled", "Initializing"] {
        let other = annotation(&db, &w, Seed::new(owner, "Explorational", state)).await;
        assert_eq!(
            finish(&app, &w.owner.token, "Explorational", &other, T).await,
            failed(StatusCode::BAD_REQUEST),
            "{state}"
        );
        assert_eq!(row(&db, &other).await.0, state);
    }
    // Invalid annotation type fails in the provider (404 by `~>`).
    assert_eq!(
        finish(&app, &w.owner.token, "Bogus", &id, T).await,
        failed(StatusCode::NOT_FOUND)
    );
    assert_eq!(all_spans(&db).await, 0);

    // Owner-organization administrator may finish; with OwnerOnly mode they
    // are no potential contributor, so no time is logged.
    let (status, body) = finish(&app, &w.f.token, "Explorational", &id, T).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(row(&db, &id).await.0, "Finished");
    assert_eq!(all_spans(&db).await, 0);
    // In Concurrent/Exclusive mode the administrator is a contributor.
    for mode in ["Concurrent", "Exclusive"] {
        let shared = annotation(
            &db,
            &w,
            Seed {
                mode,
                ..Seed::new(owner, "Explorational", "Active")
            },
        )
        .await;
        let (status, body) = finish(&app, &w.f.token, "Explorational", &shared, T).await;
        assert_eq!(status, StatusCode::OK, "{mode}: {body}");
        assert_eq!(spans(&db, &w.f.user_id, &shared).await.len(), 1, "{mode}");
        assert!(spans(&db, owner, &shared).await.is_empty());
    }

    // Task annotations: the project-team manager may finish (Task message),
    // the plain team member may not.
    annotation(&db, &w, Seed::new(&w.f.user_id, "TracingBase", "Finished")).await;
    let task_annotation = annotation(&db, &w, Seed::new(owner, "Task", "Active")).await;
    assert_eq!(
        finish(&app, &w.outsider.token, "Task", &task_annotation, T).await,
        failed(StatusCode::BAD_REQUEST)
    );
    // Public, so readable by the manager; the task-team grant decides.
    let (status, body) = finish(&app, &w.manager.token, "Task", &task_annotation, T).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["messages"], json!([{ "success": TASK_FINISHED }]));
    assert!(
        spans(&db, &w.manager.user_id, &task_annotation)
            .await
            .is_empty()
    );
    // Repeat by the owner: already finished -> annotation message, time logged.
    let (status, body) = finish(&app, &w.owner.token, "Task", &task_annotation, T).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["messages"],
        json!([{ "success": ANNOTATION_FINISHED }])
    );
    assert_eq!(spans(&db, owner, &task_annotation).await.len(), 1);

    // A soft-deleted task makes allowFinishSoft false even for the owner and
    // administrators (orElse(false)).
    let orphaned = annotation(&db, &w, Seed::new(owner, "Task", "Active")).await;
    sqlx::query("UPDATE webknossos.tasks SET isDeleted=true WHERE _id=$1")
        .bind(&w.task)
        .execute(&db.pool)
        .await
        .unwrap();
    for token in [&w.owner.token, &w.f.token] {
        assert_eq!(
            finish(&app, token, "Task", &orphaned, T).await,
            failed(StatusCode::BAD_REQUEST)
        );
    }
    assert_eq!(row(&db, &orphaned).await.0, "Active");
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn finish_all_is_serial_and_stops_at_first_failure() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let (app, _) = app(&db);
    let owner = &w.owner.user_id;
    let a = annotation(&db, &w, Seed::new(owner, "Explorational", "Active")).await;
    let b = annotation(&db, &w, Seed::new(owner, "Explorational", "Finished")).await;
    let c = annotation(&db, &w, Seed::new(owner, "Explorational", "Active")).await;

    // Body validation: invalid ids and missing field.
    for body in [json!({"annotations": ["nope"]}), json!({})] {
        let (status, _) = send(
            &app,
            &w.owner.token,
            &format!("/api/annotations/Explorational/finish?timestamp={T}"),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    assert_eq!(
        send(
            &app,
            &w.owner.token,
            "/api/annotations/Explorational/finish",
            Some(json!({"annotations": []}))
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("Missing parameter: timestamp")
        )
    );
    assert_eq!(
        finish_all(&app, &w.owner.token, &[], T).await,
        (
            StatusCode::OK,
            json!({"messages":[{"success":ALL_FINISHED}]})
        )
    );

    // Success for all: Active and already Finished; time logged per item in
    // order (one continued span on the switch: a closes into b, then c).
    let (status, body) = finish_all(&app, &w.owner.token, &[&a, &b, &c], T).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::OK,
            json!({"messages":[{"success":ALL_FINISHED}]})
        )
    );
    for id in [&a, &b, &c] {
        assert_eq!(row(&db, id).await.0, "Finished");
        assert_eq!(spans(&db, owner, id).await.len(), 1);
    }

    // Stop at the first failure: d finishes, the outsider-owned e is not
    // allowed, f is never touched. No outer wrap: the inner message.
    let d = annotation(&db, &w, Seed::new(owner, "Explorational", "Active")).await;
    let e = annotation(
        &db,
        &w,
        Seed::new(&w.outsider.user_id, "Explorational", "Active"),
    )
    .await;
    let f = annotation(&db, &w, Seed::new(owner, "Explorational", "Active")).await;
    assert_eq!(
        finish_all(&app, &w.owner.token, &[&d, &e, &f], T + 5000).await,
        failed(StatusCode::BAD_REQUEST)
    );
    assert_eq!(row(&db, &d).await.0, "Finished");
    assert_eq!(spans(&db, owner, &d).await.len(), 1);
    assert_eq!(row(&db, &e).await.0, "Active");
    assert_eq!(row(&db, &f).await.0, "Active");
    assert!(spans(&db, owner, &f).await.is_empty());

    // A missing id fails in the provider with its own message and 404.
    let missing = object_id();
    assert_eq!(
        finish_all(&app, &w.owner.token, &[&missing, &f], T + 6000).await,
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    assert_eq!(row(&db, &f).await.0, "Active");
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
async fn task_finish_invalidates_compound_caches_and_compounds_fail() {
    let db = TestDb::new().await;
    let observations = Mock::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let mock_app = Router::new()
        .route("/{*path}", any(mock))
        .with_state(observations.clone());
    let server = tokio::spawn(async move { axum::serve(listener, mock_app).await.unwrap() });
    let w = world(&db, &url).await;
    let owner = &w.owner.user_id;
    annotation(&db, &w, Seed::new(&w.f.user_id, "TracingBase", "Finished")).await;
    // Keeps the compounds mergeable.
    annotation(&db, &w, Seed::new(owner, "Task", "Finished")).await;
    let active = annotation(&db, &w, Seed::new(owner, "Task", "Active")).await;
    let finished = annotation(&db, &w, Seed::new(owner, "Task", "Finished")).await;
    let explorational = annotation(&db, &w, Seed::new(owner, "Explorational", "Active")).await;
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

    // Compounds resolve (from the cache) but their restrictions never allow
    // finishing; nothing is written, no time logged.
    for (typ, id) in keys {
        assert_eq!(
            finish(&app, &w.f.token, typ, id, T).await,
            failed(StatusCode::BAD_REQUEST)
        );
    }
    assert_eq!(*observations.0.lock().unwrap(), 3);
    // Failed finish, explorational finish and repeated finish of a Finished
    // task annotation keep the caches.
    assert_eq!(
        finish(&app, &w.outsider.token, "Task", &active, T).await,
        failed(StatusCode::BAD_REQUEST)
    );
    for (typ, id) in [("Explorational", &explorational), ("Task", &finished)] {
        let (status, body) = finish(&app, &w.owner.token, typ, id, T).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            body["messages"],
            json!([{ "success": ANNOTATION_FINISHED }])
        );
    }
    assert_eq!(cached(), [true; 3]);

    // Injected UPDATE failure rolls back and keeps the caches.
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$; CREATE TRIGGER reject_finish BEFORE UPDATE ON webknossos.annotations FOR EACH ROW EXECUTE FUNCTION webknossos.reject_finish();")
        .execute(&db.pool).await.unwrap();
    let before = row(&db, &active).await;
    assert_eq!(
        finish(&app, &w.owner.token, "Task", &active, T).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(row(&db, &active).await, before);
    assert_eq!(cached(), [true; 3]);
    sqlx::query("DROP TRIGGER reject_finish ON webknossos.annotations")
        .execute(&db.pool)
        .await
        .unwrap();

    // The type path segment is not compared with the stored type: an
    // Explorational path finishes the Task row with the Task message.
    let (status, body) = finish(&app, &w.owner.token, "Explorational", &active, T).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["messages"], json!([{ "success": TASK_FINISHED }]));
    assert_eq!(row(&db, &active).await.0, "Finished");
    assert_eq!(cached(), [false; 3]);
    server.abort();
    db.cleanup().await;
}
