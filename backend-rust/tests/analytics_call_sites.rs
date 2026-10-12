//! Server-side analytics events emitted by other controllers (signup,
//! send_invites, join_organization, open_dataset, change_dataset_settings)
//! and the 24 h `webknossos_heartbeat` ticker, asserted via database saving.
mod browser_auth_support;
mod common;

use std::time::Duration;

use axum::{Router, http::Method, http::StatusCode};
use browser_auth_support::{make_superuser, seed_organization_team, send, sign_up};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use webknossos_backend::{
    AppState,
    analytics::{HEARTBEAT_JOB_NAME, run_heartbeat},
    application_info::{MiscConfig, MiscState},
    mail::MailSender,
    router_with_misc,
    scheduler::{JobOutcome, advisory_lock_key},
};

const PUBLIC_URI: &str = "https://wk.example";

/// Database saving on, forwarding off.
fn misc_config() -> MiscConfig {
    let mut misc = MiscConfig::default();
    misc.analytics.uri = String::new();
    misc.analytics.save_to_database_enabled = true;
    misc.public_uri = PUBLIC_URI.into();
    misc
}

fn app(db: &TestDb) -> Router {
    router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        misc_config(),
        MailSender::default(),
    )
}

#[derive(Debug, PartialEq, sqlx::FromRow)]
struct Event {
    properties: Value,
    multi_user: String,
    organization: String,
    is_admin: bool,
    is_super_user: bool,
    uri: String,
}

async fn events(db: &TestDb, event_type: &str) -> Vec<Event> {
    sqlx::query_as(
        r#"SELECT eventProperties AS properties, _user AS multi_user, _organization AS organization,
             isOrganizationAdmin AS is_admin, isSuperUser AS is_super_user, webknossosUri AS uri
           FROM webknossos.analyticsEvents WHERE eventType = $1 ORDER BY created, _id"#,
    )
    .bind(event_type)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

/// Events are tracked in the background: wait until `count` rows exist.
async fn wait_events(db: &TestDb, event_type: &str, count: usize) -> Vec<Event> {
    for _ in 0..100 {
        let rows = events(db, event_type).await;
        if rows.len() >= count {
            assert_eq!(rows.len(), count, "{event_type}: {rows:?}");
            return rows;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{event_type}: expected {count} events");
}

async fn multi_user_of(db: &TestDb, email: &str) -> String {
    sqlx::query_scalar("SELECT _id FROM webknossos.multiUsers WHERE email = $1")
        .bind(email)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn seed_invite(db: &TestDb, organization: &str, token: &str, is_admin: bool) {
    sqlx::query(
        r#"INSERT INTO webknossos.invites(_id, tokenValue, _organization, autoActivate, isAdmin,
             isDatasetManager, expirationDateTime)
           VALUES($1, $2, $3, TRUE, $4, FALSE, NOW() + INTERVAL '1 day')"#,
    )
    .bind(object_id())
    .bind(token)
    .bind(organization)
    .bind(is_admin)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn post(app: &Router, path: &str, token: Option<&str>, body: Option<Value>) -> StatusCode {
    let response = send(app, Method::POST, path, None, token, body).await;
    if response.status != StatusCode::OK {
        eprintln!("{path}: {:?}", response.body);
    }
    response.status
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn onboarding_routes_track_signup_invites_and_joins() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    seed_organization_team(&db, &f.organization_id).await;
    let app = app(&db);

    // register with an admin invite: SignupEvent(newUser, hadInvite = true).
    seed_invite(&db, &f.organization_id, "signup-invite", true).await;
    let body = sign_up(
        "invited@example.test",
        "Invited",
        "User",
        json!({"inviteToken": "signup-invite"}),
    );
    assert_eq!(
        post(&app, "/api/auth/register", None, Some(body)).await,
        StatusCode::OK
    );
    let signups = wait_events(&db, "signup", 1).await;
    assert_eq!(
        signups[0],
        Event {
            properties: json!({"had_invite": true}),
            multi_user: multi_user_of(&db, "invited@example.test").await,
            organization: f.organization_id.clone(),
            is_admin: true,
            is_super_user: false,
            uri: PUBLIC_URI.into(),
        }
    );

    // sendInvites: InviteEvent(requester, recipients.length), only on success.
    let invites = |is_admin: bool| {
        json!({"recipients": ["a@example.test", "b@example.test"], "autoActivate": true,
            "isAdmin": is_admin, "isDatasetManager": false, "teamMemberships": []})
    };
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    assert_eq!(
        post(
            &app,
            "/api/auth/sendInvites",
            Some(&member.token),
            Some(invites(true))
        )
        .await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &app,
            "/api/auth/sendInvites",
            Some(&f.token),
            Some(invites(false))
        )
        .await,
        StatusCode::OK
    );
    let sent = wait_events(&db, "send_invites", 1).await;
    assert_eq!(sent[0].properties, json!({"recipient_count": 2}));
    assert_eq!(sent[0].multi_user, f.multi_user_id);
    assert_eq!(sent[0].organization, f.organization_id);
    assert!(sent[0].is_admin);

    // joinOrganization: JoinOrganizationEvent(request.identity, organization);
    // the user properties are those of the requesting (original) identity.
    let other_org = format!("other-{}", object_id());
    db.seed_user(&object_id(), &other_org, true).await;
    seed_invite(&db, &other_org, "join-invite", false).await;
    assert_eq!(
        post(
            &app,
            "/api/auth/joinOrganization/join-invite",
            Some(&f.token),
            None
        )
        .await,
        StatusCode::OK
    );
    let joins = wait_events(&db, "join_organization", 1).await;
    assert_eq!(
        joins[0],
        Event {
            properties: json!({"joined_organization_id": other_org}),
            multi_user: f.multi_user_id.clone(),
            organization: f.organization_id.clone(),
            is_admin: true,
            is_super_user: false,
            uri: PUBLIC_URI.into(),
        }
    );

    // createOrganizationWithExistingUser: JoinOrganizationEvent(user, newOrganization).
    make_superuser(&db, &f.multi_user_id).await;
    let response = send(
        &app,
        Method::POST,
        "/api/auth/createOrganizationWithExistingUser",
        None,
        Some(&f.token),
        Some(json!({"userId": member.user_id, "newOrganizationName": "Extra Org"})),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    let new_org = response.body.as_str().unwrap().to_owned();
    let joins = wait_events(&db, "join_organization", 2).await;
    assert_eq!(
        joins[1],
        Event {
            properties: json!({"joined_organization_id": new_org}),
            multi_user: member.multi_user_id.clone(),
            organization: f.organization_id.clone(),
            is_admin: false,
            is_super_user: false,
            uri: PUBLIC_URI.into(),
        }
    );

    // createUserInOrganization: SignupEvent(newUser, hadInvite = false).
    assert_eq!(
        post(
            &app,
            &format!("/api/auth/createUserInOrganization/{}", f.organization_id),
            Some(&f.token),
            Some(json!({"firstName": "Made", "lastName": "ByAdmin", "email": "made@example.test"})),
        )
        .await,
        StatusCode::OK
    );
    let signups = wait_events(&db, "signup", 2).await;
    assert_eq!(signups[1].properties, json!({"had_invite": false}));
    assert_eq!(
        signups[1].multi_user,
        multi_user_of(&db, "made@example.test").await
    );
    assert_eq!(signups[1].organization, f.organization_id);
    assert!(!signups[1].is_admin);

    // createOrganizationWithAdmin (allowed for superusers): SignupEvent(owner, false).
    let body = sign_up(
        "owner@example.test",
        "Org",
        "Owner",
        json!({"organizationName": "Analytics Org"}),
    );
    assert_eq!(
        post(
            &app,
            "/api/auth/createOrganizationWithAdmin",
            Some(&f.token),
            Some(body)
        )
        .await,
        StatusCode::OK
    );
    let signups = wait_events(&db, "signup", 3).await;
    assert_eq!(signups[2].properties, json!({"had_invite": false}));
    assert_eq!(
        signups[2].multi_user,
        multi_user_of(&db, "owner@example.test").await
    );
    assert_eq!(signups[2].organization, "Analytics_Org");
    assert!(signups[2].is_admin);
    assert!(!signups[2].is_super_user);

    // Nothing else was tracked (no event for the rejected invite request).
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(events(&db, "send_invites").await.len(), 1);
    db.cleanup().await;
}

async fn seed_dataset(db: &TestDb, f: &Fixture, name: &str, uploader: Option<&str>) -> String {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('test-store','http://localhost:9001','http://localhost:9002','secret-key') ON CONFLICT DO NOTHING")
        .execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isPublic,sortingKey,_uploader) SELECT $1,'test-store',$2,_rootFolder,$3,$3,TRUE,NOW(),$4 FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&f.organization_id).bind(name).bind(uploader).execute(&db.pool).await.unwrap();
    id
}

async fn request(
    app: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) {
    let response = send(app, method, path, None, token, body).await;
    assert_eq!(
        response.status,
        StatusCode::OK,
        "{path}: {:?}",
        response.body
    );
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn dataset_routes_track_open_and_settings_changes() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = app(&db);
    let uploaded = seed_dataset(&db, &f, "Uploaded", Some(&f.user_id)).await;
    let orphan = seed_dataset(&db, &f, "NoUploader", None).await;

    // read: only for logged-in users (UserAwareAction).
    request(
        &app,
        Method::GET,
        &format!("/api/datasets/{uploaded}"),
        None,
        None,
    )
    .await;
    request(
        &app,
        Method::GET,
        &format!("/api/datasets/{uploaded}"),
        Some(&f.token),
        None,
    )
    .await;
    let opened = wait_events(&db, "open_dataset", 1).await;
    assert_eq!(
        opened[0],
        Event {
            properties: json!({"dataset_id": uploaded, "dataset_name": "Uploaded",
                "dataset_organization_id": f.organization_id,
                "dataset_uploader_multiuser_id": f.multi_user_id}),
            multi_user: f.multi_user_id.clone(),
            organization: f.organization_id.clone(),
            is_admin: true,
            is_super_user: false,
            uri: PUBLIC_URI.into(),
        }
    );
    request(
        &app,
        Method::GET,
        &format!("/api/v12/datasets/{orphan}"),
        Some(&f.token),
        None,
    )
    .await;
    let opened = wait_events(&db, "open_dataset", 2).await;
    assert_eq!(
        opened[1].properties,
        json!({"dataset_id": orphan, "dataset_name": "NoUploader",
            "dataset_organization_id": f.organization_id,
            "dataset_uploader_multiuser_id": null})
    );

    // update, updatePartial and the legacy updatePartialV12 route.
    request(
        &app,
        Method::PATCH,
        &format!("/api/datasets/{uploaded}"),
        Some(&f.token),
        Some(json!({"name": "Renamed", "isPublic": true, "tags": []})),
    )
    .await;
    request(
        &app,
        Method::PATCH,
        &format!("/api/datasets/{uploaded}/updatePartial"),
        Some(&f.token),
        Some(json!({"description": "changed"})),
    )
    .await;
    request(
        &app,
        Method::PATCH,
        &format!("/api/v12/datasets/{orphan}/updatePartial"),
        Some(&f.token),
        Some(json!({"description": "legacy"})),
    )
    .await;
    // A rejected update is not tracked.
    let response = send(
        &app,
        Method::PATCH,
        &format!("/api/datasets/{uploaded}/updatePartial"),
        None,
        None,
        Some(json!({"description": "anonymous"})),
    )
    .await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    let changed = wait_events(&db, "change_dataset_settings", 3).await;
    let mut ids: Vec<&Value> = changed
        .iter()
        .map(|e| &e.properties["dataset_id"])
        .collect();
    ids.sort_by_key(|id| id.as_str() == Some(orphan.as_str()));
    assert_eq!(ids, [&json!(uploaded), &json!(uploaded), &json!(orphan)]);
    for event in &changed {
        assert_eq!(event.properties.as_object().unwrap().len(), 1);
        assert_eq!(event.multi_user, f.multi_user_id);
    }

    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(events(&db, "open_dataset").await.len(), 2);
    assert_eq!(events(&db, "change_dataset_settings").await.len(), 3);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn heartbeat_tracks_oldest_active_user_with_build_info() {
    let db = TestDb::new().await;
    let misc = MiscState::new(misc_config());

    // UserDAO.findOldestActive fails without users: nothing is sent.
    assert!(matches!(
        run_heartbeat(&db.pool, &misc).await.unwrap(),
        JobOutcome::Completed(_)
    ));
    assert!(events(&db, "webknossos_heartbeat").await.is_empty());

    let f = db.fixture().await;
    let deactivated = db.seed_user(&object_id(), &f.organization_id, false).await;
    let oldest = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query(
        "UPDATE webknossos.users SET created = '1990-01-01', isDeactivated = TRUE WHERE _id = $1",
    )
    .bind(&deactivated.user_id)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE webknossos.users SET created = '2000-01-01' WHERE _id = $1")
        .bind(&oldest.user_id)
        .execute(&db.pool)
        .await
        .unwrap();

    // Another instance holding the lock: skipped.
    let mut holder = db.pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(advisory_lock_key(HEARTBEAT_JOB_NAME))
        .execute(&mut *holder)
        .await
        .unwrap();
    assert_eq!(
        run_heartbeat(&db.pool, &misc).await.unwrap(),
        JobOutcome::SkippedLocked
    );
    holder.rollback().await.unwrap();

    assert!(matches!(
        run_heartbeat(&db.pool, &misc).await.unwrap(),
        JobOutcome::Completed(_)
    ));
    // The tick waits for storage, so the row exists right away.
    let beats = events(&db, "webknossos_heartbeat").await;
    assert_eq!(beats.len(), 1);
    assert_eq!(beats[0].multi_user, oldest.multi_user_id);
    assert_eq!(beats[0].organization, f.organization_id);
    assert!(!beats[0].is_admin);
    assert_eq!(beats[0].uri, PUBLIC_URI);
    let build_info = &beats[0].properties["build_info"];
    assert_eq!(beats[0].properties.as_object().unwrap().len(), 1);
    assert_eq!(build_info["webknossos"]["name"], "webknossos");
    assert!(build_info["schemaVersion"].is_i64());
    assert_eq!(
        build_info["httpApiVersioning"]["currentApiVersion"],
        json!(16)
    );
    assert_eq!(build_info["localDataStoreEnabled"], false);
    db.cleanup().await;
}
