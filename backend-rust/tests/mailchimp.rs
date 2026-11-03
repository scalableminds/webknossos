//! Mailchimp end to end: a local mock Mailchimp API records the requests the client sends,
//! directly, through the registration route and from the activity ticker.
use crate::common;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, Request, StatusCode, header},
    routing::{get, put},
};
use chrono::{TimeDelta, Utc};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    auth::browser::BrowserAuthConfig,
    background::{
        mailchimp_ticker,
        scheduler::{JobOutcome, advisory_lock_key},
    },
    mailchimp::{MailchimpClient, MailchimpConfig, MailchimpTag, MemberContact, subscriber_hash},
    router,
    util::id::ObjectId,
};

const LIST: &str = "list42";
/// base64("apiuser:api-key")
const AUTH: &str = "Basic YXBpdXNlcjphcGkta2V5";

#[derive(Clone, Debug, PartialEq)]
struct Recorded {
    method: String,
    hash: String,
    path: String,
    authorization: Option<String>,
    body: Option<Value>,
}

#[derive(Clone, Default)]
struct Mock {
    requests: Arc<Mutex<Vec<Recorded>>>,
    /// Existing tags per subscriber hash, answered by GET .../tags.
    tags: Arc<Mutex<HashMap<String, Vec<String>>>>,
    /// Subscriber hashes whose member PUT fails.
    rejected: Arc<Mutex<Vec<String>>>,
}

impl Mock {
    fn record(
        &self,
        method: &str,
        list: &str,
        hash: &str,
        suffix: &str,
        headers: &HeaderMap,
        body: Option<Value>,
    ) {
        self.requests.lock().unwrap().push(Recorded {
            method: method.into(),
            hash: hash.into(),
            path: format!("/3.0/lists/{list}/members/{hash}{suffix}"),
            authorization: headers
                .get(header::AUTHORIZATION)
                .map(|value| value.to_str().unwrap().to_owned()),
            body,
        });
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

async fn put_member(
    State(mock): State<Mock>,
    Path((list, hash)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> StatusCode {
    mock.record("PUT", &list, &hash, "", &headers, Some(body));
    if mock.rejected.lock().unwrap().contains(&hash) {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::OK
    }
}

async fn post_tags(
    State(mock): State<Mock>,
    Path((list, hash)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> StatusCode {
    let names = body["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tag| tag["name"].as_str().map(str::to_owned));
    mock.tags
        .lock()
        .unwrap()
        .entry(hash.clone())
        .or_default()
        .extend(names);
    mock.record("POST", &list, &hash, "/tags", &headers, Some(body));
    StatusCode::NO_CONTENT
}

async fn get_tags(
    State(mock): State<Mock>,
    Path((list, hash)): Path<(String, String)>,
    headers: HeaderMap,
) -> Json<Value> {
    mock.record("GET", &list, &hash, "/tags", &headers, None);
    let names = mock
        .tags
        .lock()
        .unwrap()
        .get(&hash)
        .cloned()
        .unwrap_or_default();
    let tags: Vec<Value> = names
        .iter()
        .map(|name| json!({"id": 1, "name": name, "date_added": "2026-10-01T00:00:00+00:00"}))
        .collect();
    Json(json!({"tags": tags, "total_items": tags.len()}))
}

/// Starts the mock API and returns its `/3.0` base URL.
async fn mock_mailchimp() -> (String, Mock) {
    let mock = Mock::default();
    let app = Router::new()
        .route("/3.0/lists/{list}/members/{hash}", put(put_member))
        .route(
            "/3.0/lists/{list}/members/{hash}/tags",
            get(get_tags).post(post_tags),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}/3.0", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (host, mock)
}

fn config(host: &str) -> MailchimpConfig {
    MailchimpConfig {
        host: Some(host.to_owned()),
        list_id: LIST.into(),
        user: "apiuser".into(),
        password: "api-key".into(),
        ..MailchimpConfig::default()
    }
}

/// Waits until at least `count` requests arrived (route call sites are fire-and-forget).
async fn wait_for(mock: &Mock, count: usize) -> Vec<Recorded> {
    for _ in 0..200 {
        if mock.requests.lock().unwrap().len() >= count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    mock.requests()
}

fn tag_body(tag: &str) -> Value {
    json!({"tags": [{"name": tag, "status": "active"}]})
}

#[tokio::test]
async fn client_registers_tags_and_reads_tags() {
    let (host, mock) = mock_mailchimp().await;
    let client = MailchimpClient::new(&config(&host));
    let contact = MemberContact {
        email: "Grace@Example.org".into(),
        first_name: "Grace".into(),
        last_name: "Hopper".into(),
    };
    let hash = subscriber_hash("grace@example.org");
    client
        .register_user(
            &ObjectId::new(),
            contact.clone(),
            MailchimpTag::RegisteredAsAdmin,
        )
        .unwrap()
        .await
        .unwrap();
    assert_eq!(
        mock.requests(),
        vec![
            Recorded {
                method: "PUT".into(),
                hash: hash.clone(),
                path: format!("/3.0/lists/{LIST}/members/{hash}"),
                authorization: Some(AUTH.into()),
                body: Some(json!({
                    "email_address": "Grace@Example.org",
                    "status": "subscribed",
                    "merge_fields": {"FNAME": "Grace", "LNAME": "Hopper"},
                })),
            },
            Recorded {
                method: "POST".into(),
                hash: hash.clone(),
                path: format!("/3.0/lists/{LIST}/members/{hash}/tags"),
                authorization: Some(AUTH.into()),
                body: Some(tag_body("registered_as_admin")),
            },
        ]
    );

    // Unknown tag names are ignored, as MailchimpTag.fromString does.
    mock.tags.lock().unwrap().insert(
        hash.clone(),
        vec!["has_annotated".into(), "newsletter".into()],
    );
    assert_eq!(
        client.tags_for_email(&contact.email).await.unwrap(),
        vec![MailchimpTag::HasAnnotated]
    );
    assert_eq!(mock.requests()[2].authorization.as_deref(), Some(AUTH));

    // A failed member PUT skips the tag (Play's Fox chain); the caller never sees the error.
    let rejected = MemberContact {
        email: "rejected@example.org".into(),
        ..contact
    };
    mock.rejected
        .lock()
        .unwrap()
        .push(subscriber_hash(&rejected.email));
    client
        .register_user(&ObjectId::new(), rejected, MailchimpTag::RegisteredAsUser)
        .unwrap()
        .await
        .unwrap();
    let requests = mock.requests();
    assert_eq!(requests.len(), 4);
    assert_eq!(requests[3].method, "PUT");

    // An unreachable host only logs.
    let broken = MailchimpClient::new(&config("http://127.0.0.1:9/3.0"));
    broken
        .register_user(
            &ObjectId::new(),
            MemberContact {
                email: "a@b.c".into(),
                first_name: "A".into(),
                last_name: "B".into(),
            },
            MailchimpTag::RegisteredAsUser,
        )
        .unwrap()
        .await
        .unwrap();
    assert!(broken.tags_for_email("a@b.c").await.is_err());
}

async fn post_json(app: &Router, uri: &str, body: Value) -> StatusCode {
    let request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let _ = response.into_body().collect().await.unwrap();
    status
}

fn app(db: &TestDb, host: &str, is_wkorg_instance: bool) -> Router {
    router(
        AppState::builder(db.pool.clone())
            .browser_auth(BrowserAuthConfig {
                signer_secret: Some("rust-mailchimp-test-secret".into()),
                is_wkorg_instance,
                ..BrowserAuthConfig::default()
            })
            .mailchimp(config(host))
            .build(),
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn registration_registers_wkorg_users_with_mailchimp() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    sqlx::query(
        "INSERT INTO webknossos.teams (_id, _organization, name, isOrganizationTeam) VALUES ($1, $2, 'Default', TRUE)",
    )
    .bind(object_id())
    .bind(&admin.organization_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let (host, mock) = mock_mailchimp().await;
    let sign_up = |email: &str| {
        json!({
            "organization": "",
            "organizationName": "",
            "email": email,
            "password": {"password1": "secret-password", "password2": "secret-password"},
            "firstName": "Ada",
            "lastName": "Lovelace",
        })
    };

    // Not a wkorg instance: Play sends the new-user mail instead, no Mailchimp request.
    let status = post_json(
        &app(&db, &host, false),
        "/api/auth/register",
        sign_up("plain@example.test"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let status = post_json(
        &app(&db, &host, true),
        "/api/auth/register",
        sign_up("Ada@Example.test"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let requests = wait_for(&mock, 2).await;
    let hash = subscriber_hash("ada@example.test");
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert_eq!(requests[0].method, "PUT");
    assert_eq!(requests[0].hash, hash);
    assert_eq!(
        requests[0].body,
        Some(json!({
            "email_address": "ada@example.test",
            "status": "subscribed",
            "merge_fields": {"FNAME": "Ada", "LNAME": "Lovelace"},
        }))
    );
    assert_eq!(requests[1].method, "POST");
    assert_eq!(requests[1].body, Some(tag_body("registered_as_user")));
    assert!(
        requests
            .iter()
            .all(|request| request.authorization.as_deref() == Some(AUTH))
    );

    // HasInvitedTeam through POST /api/auth/sendInvites (tags the inviting admin).
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/sendInvites")
        .header(header::CONTENT_TYPE, "application/json")
        .header("X-Auth-Token", &admin.token)
        .body(Body::from(
            json!({
                "recipients": ["invitee@example.test"],
                "autoActivate": true,
                "isAdmin": false,
                "isDatasetManager": false,
                "teamMemberships": [],
            })
            .to_string(),
        ))
        .unwrap();
    let response = app(&db, &host, true).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let requests = wait_for(&mock, 3).await;
    let admin_email = format!("{}@example.test", admin.multi_user_id);
    assert_eq!(requests.len(), 3, "{requests:?}");
    assert_eq!(requests[2].method, "POST");
    assert_eq!(requests[2].hash, subscriber_hash(&admin_email));
    assert_eq!(requests[2].body, Some(tag_body("has_invited_team")));
    db.cleanup().await;
}

/// Inserts a multi-user registered `created_days_ago` days ago with one user per
/// `(last_activity_days_ago, is_deactivated)` entry and returns its email address.
async fn seed_multi_user(
    db: &TestDb,
    organization_id: &str,
    created_days_ago: f64,
    users: &[(f64, bool)],
) -> String {
    let multi_user = object_id();
    let email = format!("{multi_user}@Example.test");
    sqlx::query(
        "INSERT INTO webknossos.multiUsers (_id, email, passwordInfo_password, firstName, lastName, created) \
         VALUES ($1, $2, '', 'T', 'U', NOW() - make_interval(secs => $3 * 86400))",
    )
    .bind(&multi_user)
    .bind(&email)
    .bind(created_days_ago)
    .execute(&db.pool)
    .await
    .unwrap();
    for (index, (last_activity_days_ago, is_deactivated)) in users.iter().enumerate() {
        // One identity per organization: further users get their own organizations.
        let organization = if index == 0 {
            organization_id.to_owned()
        } else {
            let other = format!("{organization_id}-{index}-{}", object_id());
            let root_folder = object_id();
            sqlx::query("INSERT INTO webknossos.folders (_id, name) VALUES ($1, 'root')")
                .bind(&root_folder)
                .execute(&db.pool)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO webknossos.organizations (_id, _rootFolder, name) VALUES ($1, $2, 'other')",
            )
            .bind(&other)
            .bind(&root_folder)
            .execute(&db.pool)
            .await
            .unwrap();
            other
        };
        sqlx::query(
            "INSERT INTO webknossos.users (_id, _multiUser, _organization, userConfiguration, isDeactivated, lastActivity) \
             VALUES ($1, $2, $3, '{}'::jsonb, $4, NOW() - make_interval(secs => $5 * 86400))",
        )
        .bind(object_id())
        .bind(&multi_user)
        .bind(&organization)
        .bind(is_deactivated)
        .bind(last_activity_days_ago)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    email
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn ticker_tags_multi_users_by_activity_in_week_three() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let organization = &fixture.organization_id;
    let (host, mock) = mock_mailchimp().await;
    let client = MailchimpClient::new(&config(&host));

    let inactive = seed_multi_user(&db, organization, 21.5, &[(15.0, false)]).await;
    // The most recent activity of its active users counts; deactivated users are ignored.
    let active = seed_multi_user(
        &db,
        organization,
        21.5,
        &[(20.0, false), (2.0, false), (0.0, true)],
    )
    .await;
    let already_tagged = seed_multi_user(&db, organization, 21.2, &[(1.0, false)]).await;
    mock.tags.lock().unwrap().insert(
        subscriber_hash(&already_tagged),
        vec!["was_inactive_in_weeks_two_and_three".into()],
    );
    // Outside the window or without an active user: never looked at.
    seed_multi_user(&db, organization, 20.9, &[(1.0, false)]).await;
    seed_multi_user(&db, organization, 22.1, &[(1.0, false)]).await;
    seed_multi_user(&db, organization, 21.5, &[(1.0, true)]).await;
    seed_multi_user(&db, organization, 21.5, &[]).await;

    let outcome = mailchimp_ticker::run(&db.pool, &client).await.unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Checked 3 multiusers for Mailchimp activity tagging, tagged 2.".into()
        )
    );
    let requests = mock.requests();
    let gets: Vec<_> = requests.iter().filter(|r| r.method == "GET").collect();
    assert_eq!(gets.len(), 3, "{requests:?}");
    let mut posts: Vec<(String, Value)> = requests
        .iter()
        .filter(|r| r.method == "POST")
        .map(|r| (r.hash.clone(), r.body.clone().unwrap()))
        .collect();
    posts.sort_by(|a, b| a.0.cmp(&b.0));
    let mut expected = vec![
        (
            subscriber_hash(&inactive),
            tag_body("was_inactive_in_weeks_two_and_three"),
        ),
        (
            subscriber_hash(&active),
            tag_body("was_active_in_weeks_two_or_three"),
        ),
    ];
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(posts, expected);
    assert!(
        requests
            .iter()
            .all(|request| request.authorization.as_deref() == Some(AUTH))
    );

    // Deleted multi-users are skipped, like multiUserDAO.findAll; tagged ones are not tagged again.
    sqlx::query("UPDATE webknossos.multiUsers SET isDeleted = TRUE WHERE email = $1")
        .bind(&inactive)
        .execute(&db.pool)
        .await
        .unwrap();
    let at = Utc::now() + TimeDelta::minutes(1);
    let outcome = mailchimp_ticker::run_at(&db.pool, &client, at)
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Checked 2 multiusers for Mailchimp activity tagging, tagged 0.".into()
        )
    );

    // Another instance holding the lock: the run is skipped.
    let mut other = db.pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(advisory_lock_key(mailchimp_ticker::JOB_NAME))
        .execute(&mut *other)
        .await
        .unwrap();
    let before = mock.requests().len();
    assert_eq!(
        mailchimp_ticker::run(&db.pool, &client).await.unwrap(),
        JobOutcome::SkippedLocked
    );
    assert_eq!(mock.requests().len(), before);
    other.rollback().await.unwrap();

    // Without a host the ticker does nothing.
    assert_eq!(
        mailchimp_ticker::run(&db.pool, &MailchimpClient::default())
            .await
            .unwrap(),
        JobOutcome::Completed("Mailchimp is not configured.".into())
    );
    db.cleanup().await;
}
