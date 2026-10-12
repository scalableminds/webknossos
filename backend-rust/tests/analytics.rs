#![allow(clippy::type_complexity, clippy::field_reassign_with_default)]
mod common;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{body::Body, http::Request};
use common::TestDb;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, application_info::MiscConfig, mail::MailSender, router_with_misc,
};

async fn send(app: &axum::Router, uri: &str, token: Option<&str>, body: &str) -> (u16, Value) {
    let mut request = Request::builder()
        .uri(uri)
        .method("POST")
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}

fn app(db: &TestDb, misc: MiscConfig) -> axum::Router {
    router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        misc,
        MailSender::default(),
    )
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

fn offline_config() -> MiscConfig {
    let mut misc = MiscConfig::default();
    misc.analytics.uri = String::new();
    misc
}

async fn event_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.analyticsEvents")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

fn ingest_body(uri: &str, key: &str, count: usize) -> String {
    let event = json!({
        "event_type": "open_annotation",
        "user_id": "5c766bec6c01006c018c7459",
        "time": 1700000000000i64,
        "user_properties": {"organization_id": "orga", "is_organization_admin": true,
            "is_superuser": false, "webknossos_uri": uri},
        "event_properties": {"annotation_id": "abc"},
        "session_id": 42,
    });
    json!({"events": vec![event; count], "api_key": key}).to_string()
}

#[test]
fn default_analytics_uri_follows_application_conf() {
    assert_eq!(
        MiscConfig::default().analytics.uri,
        "https://events-relay.webknossos.org/events"
    );
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn ingest_validates_config_api_keys_and_stores_events() {
    let db = TestDb::new().await;
    let disabled = app(&db, offline_config());
    assert_eq!(
        send(
            &disabled,
            "/api/analytics/ingest",
            None,
            &ingest_body("u", "k", 1)
        )
        .await,
        (400, error("Database logging of events is not enabled"))
    );
    assert_eq!(
        send(&disabled, "/api/analytics/ingest", None, r#"{"events":[]}"#)
            .await
            .0,
        400
    );

    let mut malformed = offline_config();
    malformed.analytics.save_to_database_enabled = true;
    malformed.analytics.well_known_uris = vec!["https://wk.example|".into()];
    assert_eq!(
        send(
            &app(&db, malformed),
            "/api/analytics/ingest",
            None,
            &ingest_body("u", "k", 1)
        )
        .await,
        (400, error("wellKnownUris configuration is incorrect"))
    );

    let mut enabled = offline_config();
    enabled.analytics.save_to_database_enabled = true;
    enabled.analytics.well_known_uris = vec!["https://wk.example|secret".into()];
    let app = app(&db, enabled);
    assert_eq!(
        send(
            &app,
            "/api/analytics/ingest",
            None,
            &ingest_body("https://wk.example", "wrong", 1)
        )
        .await,
        (
            401,
            error("Provided API key is not correct for provided webknossosUri")
        )
    );
    assert_eq!(
        send(&app, "/api/analytics/ingest", None, "not json")
            .await
            .0,
        400
    );
    assert_eq!(
        send(
            &app,
            "/api/analytics/ingest",
            None,
            &ingest_body("u", "k", 0)
        )
        .await
        .0,
        400
    );
    assert_eq!(event_count(&db).await, 0);

    assert_eq!(
        send(
            &app,
            "/api/analytics/ingest",
            None,
            &ingest_body("https://wk.example", "secret", 2)
        )
        .await,
        (200, Value::Null)
    );
    // Unknown instances may use any key.
    let camel = json!({"apiKey": "anything", "events": [{
        "eventType": "signup", "userId": "5c766bec6c01006c018c7459", "time": "2024-01-02T03:04:05Z",
        "userProperties": {"organizationId": "other", "isOrganizationAdmin": false,
            "isSuperUser": true, "webknossosUri": "https://other.example"},
        "eventProperties": {"had_invite": false}, "sessionId": 7}]});
    assert_eq!(
        send(&app, "/api/analytics/ingest", None, &camel.to_string()).await,
        (200, Value::Null)
    );
    let rows: Vec<(
        String,
        i64,
        String,
        Value,
        String,
        String,
        bool,
        bool,
        String,
    )> = sqlx::query_as(
        r#"SELECT _id, sessionId, eventType, eventProperties, _user, _organization,
             isOrganizationAdmin, isSuperUser, webknossosUri
           FROM webknossos.analyticsEvents ORDER BY created"#,
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 3);
    assert_ne!(rows[0].0, rows[1].0);
    assert_eq!(rows[0].1, 42);
    assert_eq!(rows[0].2, "open_annotation");
    assert_eq!(rows[0].3, json!({"annotation_id": "abc"}));
    assert_eq!(rows[0].5, "orga");
    assert_eq!(rows[2].2, "signup");
    assert!(rows[2].7);
    let created: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT created FROM webknossos.analyticsEvents WHERE eventType = 'signup'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(created.to_rfc3339(), "2024-01-02T03:04:05+00:00");
    db.cleanup().await;
}

/// A local stand-in for the analytics relay recording each POST body.
async fn relay() -> (String, Arc<Mutex<Vec<Value>>>) {
    let received = Arc::new(Mutex::new(Vec::new()));
    let sink = received.clone();
    let router = axum::Router::new().route(
        "/events",
        axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
            let sink = sink.clone();
            async move {
                sink.lock().unwrap().push(body);
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}/events"), received)
}

async fn wait_for<T>(mut probe: impl AsyncFnMut() -> Option<T>) -> T {
    for _ in 0..100 {
        if let Some(value) = probe().await {
            return value;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("condition not reached");
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn frontend_events_are_tracked_for_users_only() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let (relay_uri, received) = relay().await;
    let mut misc = MiscConfig::default();
    misc.analytics.uri = relay_uri;
    misc.analytics.key = "relay-key".into();
    misc.analytics.save_to_database_enabled = true;
    misc.public_uri = "https://wk.example".into();
    let app = app(&db, misc);

    // Anonymous and invalid credentials: accepted, nothing tracked.
    assert_eq!(
        send(&app, "/api/analytics/open_view", None, r#"{"a":1}"#).await,
        (200, Value::Null)
    );
    assert_eq!(
        send(
            &app,
            "/api/analytics/open_view",
            Some("bogus"),
            r#"{"a":1}"#
        )
        .await,
        (200, Value::Null)
    );
    // Body must be a JSON object.
    assert_eq!(
        send(&app, "/api/analytics/open_view", Some(&f.token), "[1]")
            .await
            .0,
        400
    );

    assert_eq!(
        send(
            &app,
            "/api/v10/analytics/open_view",
            Some(&f.token),
            r#"{"a":1}"#
        )
        .await,
        (200, Value::Null)
    );
    let stored: (String, Value, String, String, bool, bool, String, i64) = wait_for(async || {
        sqlx::query_as(
            r#"SELECT eventType, eventProperties, _user, _organization, isOrganizationAdmin,
                 isSuperUser, webknossosUri, sessionId FROM webknossos.analyticsEvents"#,
        )
        .fetch_optional(&db.pool)
        .await
        .unwrap()
    })
    .await;
    assert_eq!(stored.0, "open_view");
    assert_eq!(stored.1, json!({"a": 1, "is_frontend_event": true}));
    assert_eq!(stored.2, f.multi_user_id);
    assert_eq!(stored.3, f.organization_id);
    assert!(stored.4);
    assert!(!stored.5);
    assert_eq!(stored.6, "https://wk.example");

    let forwarded = wait_for(async || received.lock().unwrap().first().cloned()).await;
    assert_eq!(forwarded["api_key"], "relay-key");
    let event = &forwarded["events"][0];
    assert_eq!(event["eventType"], "open_view");
    assert_eq!(event["userId"], f.multi_user_id);
    assert_eq!(event["sessionId"], stored.7);
    assert!(event["time"].is_i64());
    assert_eq!(
        event["userProperties"],
        json!({"organizationId": f.organization_id, "isOrganizationAdmin": true,
               "isSuperUser": false, "webknossosUri": "https://wk.example"})
    );
    assert_eq!(event["eventProperties"]["is_frontend_event"], true);

    // Same session for a follow-up event within the pause.
    send(&app, "/api/analytics/second", Some(&f.token), "{}").await;
    let sessions: Vec<i64> = wait_for(async || {
        let ids: Vec<i64> = sqlx::query_scalar("SELECT sessionId FROM webknossos.analyticsEvents")
            .fetch_all(&db.pool)
            .await
            .unwrap();
        (ids.len() == 2).then_some(ids)
    })
    .await;
    assert_eq!(sessions[0], sessions[1]);
    db.cleanup().await;
}
