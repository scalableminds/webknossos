mod common;

use axum::{
    Extension, Router,
    body::Body,
    extract::Request,
    http::{Method, StatusCode},
};
use common::{Fixture, TestDb, UserFixture, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::time::Duration;
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    annotation_metadata::NOT_ALLOWED,
    annotation_mutex::{self, ACQUIRE_FAILED, RELEASE_FAILED},
    annotation_provider::{ANNOTATION_NOT_FOUND, AnnotationProvider, RESOURCE_NOT_FOUND},
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
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,typ,visibility,state,collaborationMode,isLockedByOwner,modified) VALUES($1,$2,$3,$4,$5::webknossos.ANNOTATION_TYPE,$6::webknossos.ANNOTATION_VISIBILITY,$7::webknossos.ANNOTATION_STATE,$8::webknossos.ANNOTATION_COLLABORATION_MODE,false,TIMESTAMPTZ '2020-01-01T00:00:00Z')")
        .bind(&id).bind(&w.dataset).bind(if matches!(typ,"Task"|"TracingBase"){Some(&w.task)}else{None})
        .bind(&w.owner.user_id).bind(typ).bind(visibility).bind(state).bind(mode).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,'Skeleton','Skeleton','{}')")
        .bind(&id).bind(format!("tracing-{id}")).execute(&db.pool).await.unwrap();
    id
}

fn app(db: &TestDb, expiry: Duration) -> Router {
    let provider = AnnotationProvider::new(
        db.pool.clone(),
        TracingStoreClient::new(ServiceClientConfig::default()).unwrap(),
    );
    Router::new()
        .nest("/api", annotation_mutex::router(expiry))
        .layer(Extension(provider))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}
fn path(id: &str, operation: &str, session: &str) -> String {
    let query = serde_urlencoded::to_string([("sessionId", session)]).unwrap();
    format!("/api/annotations/{id}/{operation}?{query}")
}
async fn send(app: &Router, token: &str, path: &str) -> (StatusCode, Value, Vec<u8>) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header("x-auth-token", token)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
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
fn error(message: &str) -> Value {
    json!({"messages":[{"error":message}]})
}
fn acquired() -> Value {
    json!({"canEdit":true,"blockedByUser":null,"blockedBySessionId":null})
}
async fn holder(db: &TestDb, id: &str) -> Option<(String, String, i64)> {
    sqlx::query_as("SELECT _user,sessionId,floor(extract(epoch FROM expiry)*1000000)::bigint FROM webknossos.annotation_mutexes WHERE _annotation=$1")
        .bind(id).fetch_optional(&db.pool).await.unwrap()
}
async fn insert_mutex(db: &TestDb, id: &str, user: &str, session: &str, age: &str) {
    sqlx::query("INSERT INTO webknossos.annotation_mutexes(_annotation,_user,sessionId,expiry) VALUES($1,$2,$3,statement_timestamp()+$4::interval)")
        .bind(id).bind(user).bind(session).bind(age).execute(&db.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn acquisition_renewal_blocked_user_json_and_expired_takeover_match_contract() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let id = annotation(&db, &w, "Explorational", "Internal", "Active", "Concurrent").await;
    let app = app(&db, Duration::from_secs(120));
    for (organization, deleted) in [
        (&w.foreign.organization_id, false),
        (&w.f.organization_id, true),
    ] {
        let team = object_id();
        sqlx::query("INSERT INTO webknossos.teams(_id,_organization,name,isDeleted) VALUES($1,$2,'hidden team',$3)").bind(&team).bind(organization).bind(deleted).execute(&db.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles(_user,_team,isTeamManager) VALUES($1,$2,true)",
        )
        .bind(&w.owner.user_id)
        .bind(team)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    let owner_session = "owner / +& café";
    let (status, body, _) = send(
        &app,
        &w.owner.token,
        &path(
            &format!("friendly-{}", id.to_ascii_uppercase()),
            "acquireMutex",
            owner_session,
        ),
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, acquired()));
    let initial = holder(&db, &id).await.unwrap();
    assert_eq!(
        (&initial.0, &initial.1),
        (&w.owner.user_id, &owner_session.to_owned())
    );
    let before_remaining: f64=sqlx::query_scalar("SELECT extract(epoch FROM expiry-statement_timestamp())::double precision FROM webknossos.annotation_mutexes WHERE _annotation=$1")
        .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert!((115.0..=120.0).contains(&before_remaining));
    // Same user but a different session is blocked and receives full compact
    // user fields, even without holder session mutex ownership.
    let (status, body, _) = send(
        &app,
        &w.owner.token,
        &path(&id, "acquireMutex", "other-tab"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"canEdit":false,"blockedBySessionId":owner_session,"blockedByUser":{
            "id":w.owner.user_id,"email":format!("{}@example.test",w.owner.multi_user_id),"firstName":"Rust","lastName":"Test",
            "isAdmin":false,"isDatasetManager":false,"isActive":true,"isAnonymous":false,
            "teams":[{"id":w.f.team_id,"name":"Test team","isTeamManager":false}]
        }})
    );
    assert_eq!(holder(&db, &id).await.unwrap(), initial);
    let (status, body, _) = send(
        &app,
        &w.outsider.token,
        &path(&id, "acquireMutex", "outsider"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["canEdit"], false);
    assert_eq!(body["blockedByUser"]["id"], w.owner.user_id);
    assert_eq!(holder(&db, &id).await.unwrap(), initial);
    // Renewal should restore the configured lifetime instead of preserving
    // the artificial shortened lifetime.
    sqlx::query("UPDATE webknossos.annotation_mutexes SET expiry=now()+interval '10 seconds' WHERE _annotation=$1")
        .bind(&id).execute(&db.pool).await.unwrap();
    let short = holder(&db, &id).await.unwrap();
    let (status, body, _) = send(
        &app,
        &w.owner.token,
        &path(&id, "acquireMutex", owner_session),
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, acquired()));
    assert!(holder(&db, &id).await.unwrap().2 > short.2 + 100_000_000);
    sqlx::query("UPDATE webknossos.annotation_mutexes SET expiry=now()-interval '1 second' WHERE _annotation=$1")
        .bind(&id).execute(&db.pool).await.unwrap();
    // Ordinary same-org collaborator has runtime update but no DAO write
    // grant; empty session string is valid and expired takeover succeeds.
    let (status, body, _) = send(&app, &w.outsider.token, &path(&id, "acquireMutex", "")).await;
    assert_eq!((status, body), (StatusCode::OK, acquired()));
    assert_eq!(holder(&db, &id).await.unwrap().0, w.outsider.user_id);
    assert_eq!(holder(&db, &id).await.unwrap().1, "");
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT floor(extract(epoch FROM modified)*1000)::bigint FROM webknossos.annotations WHERE _id=$1").bind(&id).fetch_one(&db.pool).await.unwrap(),1577836800000);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn acquire_requires_live_auth_readability_collaboration_and_runtime_update() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let app = app(&db, Duration::from_secs(120));
    let id = annotation(&db, &w, "Task", "Internal", "Active", "Exclusive").await;
    let (status, body, _) = send(
        &app,
        &w.manager.token,
        &path(&id, "acquireMutex", "manager"),
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, acquired()));
    let (status, _, _) = send(&app, "", &path(&id, "acquireMutex", "x")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body, _) = send(
        &app,
        &w.owner.token,
        &format!("/api/annotations/{id}/acquireMutex"),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Missing parameter: sessionId")
        )
    );
    let private = annotation(&db, &w, "Explorational", "Private", "Active", "Concurrent").await;
    let (status, body, _) = send(
        &app,
        &w.outsider.token,
        &path(&private, "acquireMutex", "x"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(ANNOTATION_NOT_FOUND))
    );
    let (status, body, _) = send(&app, &w.f.token, &path(&private, "acquireMutex", "admin")).await;
    assert_eq!((status, body), (StatusCode::OK, acquired()));
    for (visibility, state, mode, lock, deleted, token, expected) in [
        (
            "Public",
            "Active",
            "Concurrent",
            false,
            false,
            &w.foreign.token,
            StatusCode::FORBIDDEN,
        ),
        (
            "Internal",
            "Active",
            "Concurrent",
            false,
            false,
            &w.foreign.token,
            StatusCode::NOT_FOUND,
        ),
        (
            "Internal",
            "Finished",
            "Concurrent",
            false,
            false,
            &w.owner.token,
            StatusCode::FORBIDDEN,
        ),
        (
            "Internal",
            "Active",
            "Concurrent",
            true,
            false,
            &w.owner.token,
            StatusCode::FORBIDDEN,
        ),
        (
            "Internal",
            "Active",
            "OwnerOnly",
            false,
            false,
            &w.owner.token,
            StatusCode::FORBIDDEN,
        ),
        (
            "Internal",
            "Active",
            "Concurrent",
            false,
            true,
            &w.owner.token,
            StatusCode::NOT_FOUND,
        ),
    ] {
        let id = annotation(&db, &w, "Explorational", visibility, state, mode).await;
        sqlx::query(
            "UPDATE webknossos.annotations SET isLockedByOwner=$2,isDeleted=$3 WHERE _id=$1",
        )
        .bind(&id)
        .bind(lock)
        .bind(deleted)
        .execute(&db.pool)
        .await
        .unwrap();
        let (status, body, _) = send(&app, token, &path(&id, "acquireMutex", "x")).await;
        assert_eq!(
            (status, body),
            (
                expected,
                error(if expected == StatusCode::NOT_FOUND {
                    ANNOTATION_NOT_FOUND
                } else {
                    NOT_ALLOWED
                })
            )
        );
        assert!(holder(&db, &id).await.is_none());
    }
    // Cancelled is not Finished, matching default restrictions.
    let cancelled = annotation(
        &db,
        &w,
        "Explorational",
        "Internal",
        "Cancelled",
        "Exclusive",
    )
    .await;
    assert_eq!(
        send(&app, &w.owner.token, &path(&cancelled, "acquireMutex", "x"))
            .await
            .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE webknossos.users SET isDeactivated=true WHERE _id=$1")
        .bind(&w.owner.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        send(&app, &w.owner.token, &path(&cancelled, "releaseMutex", "x"))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn release_requires_exact_user_session_without_any_annotation_read_or_state_gate() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let id = annotation(&db, &w, "Explorational", "Private", "Finished", "OwnerOnly").await;
    insert_mutex(&db, &id, &w.outsider.user_id, "session", "-1 second").await;
    let app = app(&db, Duration::from_secs(120));
    let before = holder(&db, &id).await;
    for (token, session) in [
        (&w.f.token, "session"),
        (&w.owner.token, "session"),
        (&w.outsider.token, "wrong"),
    ] {
        let (status, _, bytes) = send(&app, token, &path(&id, "releaseMutex", session)).await;
        assert_eq!(status, StatusCode::OK);
        assert!(bytes.is_empty());
        assert_eq!(holder(&db, &id).await, before);
    }
    // Soft-deleted, private/locked/finished/OwnerOnly annotation inaccessible
    // to the holder may still have its expired mutex released.
    sqlx::query(
        "UPDATE webknossos.annotations SET isDeleted=true,isLockedByOwner=true WHERE _id=$1",
    )
    .bind(&id)
    .execute(&db.pool)
    .await
    .unwrap();
    let (status, _, bytes) = send(
        &app,
        &w.outsider.token,
        &path(&id, "releaseMutex", "session"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.is_empty());
    assert!(holder(&db, &id).await.is_none());
    for id in [&id, &object_id()] {
        assert_eq!(
            send(
                &app,
                &w.outsider.token,
                &path(id, "releaseMutex", "session")
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn parallel_clients_and_release_takeover_races_keep_one_holder() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let id = annotation(&db, &w, "Explorational", "Internal", "Active", "Concurrent").await;
    let first = app(&db, Duration::from_secs(120));
    let second = app(&db, Duration::from_secs(120));
    let mut tasks = Vec::new();
    for i in 0..24 {
        let app = if i % 2 == 0 {
            first.clone()
        } else {
            second.clone()
        };
        let token = w.outsider.token.clone();
        let path = path(&id, "acquireMutex", &format!("race-{i}"));
        tasks.push(tokio::spawn(async move { send(&app, &token, &path).await }));
    }
    let mut winners = 0;
    for task in tasks {
        let (status, body, _) = task.await.unwrap();
        assert_eq!(status, StatusCode::OK);
        if body["canEdit"] == true {
            winners += 1;
        } else {
            assert_eq!(body["blockedByUser"]["id"], w.outsider.user_id);
            assert!(
                body["blockedBySessionId"]
                    .as_str()
                    .unwrap()
                    .starts_with("race-")
            );
        }
    }
    assert_eq!(winners, 1);
    let original = holder(&db, &id).await.unwrap();
    // All serialized orderings are valid; a release last can leave no row.
    let release_path = path(&id, "releaseMutex", &original.1);
    let renew_path = path(&id, "acquireMutex", &original.1);
    let manager_path = path(&id, "acquireMutex", "manager");
    let (released, renewed, competed) = tokio::join!(
        send(&first, &w.outsider.token, &release_path),
        send(&second, &w.outsider.token, &renew_path),
        send(&first, &w.manager.token, &manager_path),
    );
    assert_eq!(released.0, StatusCode::OK);
    assert_eq!(renewed.0, StatusCode::OK);
    assert_eq!(competed.0, StatusCode::OK);
    if holder(&db, &id).await.is_none() {
        assert_eq!(
            send(&first, &w.manager.token, &manager_path).await.1,
            acquired()
        );
    }
    let final_holder = holder(&db, &id).await.unwrap();
    assert!(final_holder.0 == w.outsider.user_id || final_holder.0 == w.manager.user_id);
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
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn blocked_serializer_and_database_failures_preserve_existing_mutexes() {
    let db = TestDb::new().await;
    let w = world(&db, "http://127.0.0.1:1").await;
    let id = annotation(&db, &w, "Explorational", "Internal", "Active", "Concurrent").await;
    let app = app(&db, Duration::from_secs(120));
    insert_mutex(&db, &id, &w.outsider.user_id, "blocked", "1 hour").await;
    sqlx::query("UPDATE webknossos.users SET isDeleted=true WHERE _id=$1")
        .bind(&w.outsider.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let before = holder(&db, &id).await;
    let (status, body, _) = send(&app, &w.owner.token, &path(&id, "acquireMutex", "owner")).await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(RESOURCE_NOT_FOUND))
    );
    assert_eq!(holder(&db, &id).await, before);
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_mutex_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'hidden test secret'; END $$; CREATE TRIGGER reject_mutex_change BEFORE INSERT OR UPDATE OR DELETE ON webknossos.annotation_mutexes FOR EACH ROW EXECUTE FUNCTION webknossos.reject_mutex_change();")
        .execute(&db.pool).await.unwrap();
    // Matched expired takeover fails in DB and retains old holder/expiry.
    sqlx::query("ALTER TABLE webknossos.annotation_mutexes DISABLE TRIGGER reject_mutex_change")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.annotation_mutexes SET _user=$2,expiry=now()-interval '1 second' WHERE _annotation=$1")
        .bind(&id).bind(&w.owner.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("ALTER TABLE webknossos.annotation_mutexes ENABLE TRIGGER reject_mutex_change")
        .execute(&db.pool)
        .await
        .unwrap();
    let before = holder(&db, &id).await;
    let (status, body, _) = send(
        &app,
        &w.manager.token,
        &path(&id, "acquireMutex", "manager"),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::INTERNAL_SERVER_ERROR, error(ACQUIRE_FAILED))
    );
    assert_eq!(holder(&db, &id).await, before);
    let (status, body, _) = send(&app, &w.owner.token, &path(&id, "releaseMutex", "blocked")).await;
    assert_eq!(
        (status, body),
        (StatusCode::INTERNAL_SERVER_ERROR, error(RELEASE_FAILED))
    );
    assert_eq!(holder(&db, &id).await, before);
    db.cleanup().await;
}
