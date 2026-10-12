mod common;

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::MiscConfig,
    config::{Config, DatabaseConfig, TimeTrackingConfig},
    remote_tracingstore_report::should_track_time,
    router_with_config,
};

const KEY: &str = "report-callback-service-key";
const BASE: i64 = 1_700_000_000_000;

fn app(db: &TestDb, only_with_significant_changes: bool) -> Router {
    let mut misc = MiscConfig::default();
    misc.analytics.save_to_database_enabled = true;
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        database: DatabaseConfig {
            url: db.connection_url(),
            min_connections: 0,
            max_connections: 5,
            acquire_timeout: Duration::from_secs(5),
        },
        public_url: "http://localhost:9000".parse().unwrap(),
        email_verification_enabled: true,
        jobs_enabled: false,
        jobs: Default::default(),
        annotation_mutex_expiry: Duration::from_secs(120),
        time_tracking: TimeTrackingConfig {
            interaction: Default::default(),
            only_with_significant_changes,
        },
        auth_routes: Default::default(),
        browser_auth: Default::default(),
        service_client: Default::default(),
        allow_delete_datasets: true,
        datasets: Default::default(),
        request_timeout: Duration::from_secs(30),
        shutdown_timeout: Duration::from_secs(1),
        body_limit: 2 * 1024 * 1024,
        misc,
        voxelytics: Default::default(),
        oidc: Default::default(),
        mail: Default::default(),
        housekeeping: Default::default(),
        slack: Default::default(),
        credit_ticker: Default::default(),
        used_storage: Default::default(),
        worker_liveness: Default::default(),
    };
    router_with_config(
        AppState {
            pool: db.pool.clone(),
        },
        &config,
    )
}

struct World {
    f: Fixture,
    dataset: String,
}

async fn world(db: &TestDb) -> World {
    let f = db.fixture().await;
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('actual','http://trace.internal','https://trace.example.test',$1)")
        .bind(KEY).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('data','http://data.internal','https://data.example.test','data-key')")
        .execute(&db.pool).await.unwrap();
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryName,sortingKey) SELECT $1,'data',_id,_rootFolder,'Dataset','dataset',NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    World { f, dataset }
}

/// Private explorational owned by the fixture user, modified in 2020.
async fn annotation(db: &TestDb, w: &World, state: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,visibility,state,modified) VALUES($1,$2,$3,'Explorational','Private',$4::webknossos.ANNOTATION_STATE,'2020-01-01T00:00:00Z')")
        .bind(&id).bind(&w.dataset).bind(&w.f.user_id).bind(state).execute(&db.pool).await.unwrap();
    sqlx::query(r#"INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$1||'-skel','Skeleton','Skeleton','{"nodes":1}'),($1,$1||'-vol','Volume','Volume','{"segments":1}')"#)
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

async fn post(app: &Router, key: &str, body: Value) -> (StatusCode, String, String) {
    post_raw(app, key, body.to_string()).await
}

async fn post_raw(app: &Router, key: &str, body: String) -> (StatusCode, String, String) {
    let response = app
        .clone()
        .oneshot(
            Request::post(format!(
                "/api/tracingstores/informational/handleTracingUpdateReport?key={key}"
            ))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        content_type,
        String::from_utf8(body.to_vec()).unwrap(),
    )
}

fn report(id: &str, token: Option<&str>, significant: i32, view: i32) -> Value {
    json!({
        "annotationId": id,
        "timestamps": [BASE, BASE + 4000],
        "statistics": null,
        "significantChangesCount": significant,
        "viewChangesCount": view,
        "userToken": token,
    })
}

async fn modified_ms(db: &TestDb, id: &str) -> i64 {
    sqlx::query_scalar("SELECT floor(extract(epoch FROM modified)*1000)::bigint FROM webknossos.annotations WHERE _id=$1")
        .bind(id).fetch_one(&db.pool).await.unwrap()
}

const OLD_MODIFIED: i64 = 1_577_836_800_000;

async fn spans(db: &TestDb, id: &str) -> Vec<(String, i64)> {
    sqlx::query_as("SELECT _user,time FROM webknossos.timespans WHERE _annotation=$1 AND NOT isDeleted ORDER BY created")
        .bind(id).fetch_all(&db.pool).await.unwrap()
}

async fn contributors(db: &TestDb, id: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT _user FROM webknossos.annotation_contributors WHERE _annotation=$1 ORDER BY _user",
    )
    .bind(id)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

async fn analytics(db: &TestDb, expected: usize) -> Vec<(String, Value)> {
    for _ in 0..100 {
        let rows: Vec<(String, Value)> = sqlx::query_as(
            "SELECT eventType,eventProperties FROM webknossos.analyticsEvents ORDER BY eventType",
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        if rows.len() >= expected {
            return rows;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("analytics events were not stored");
}

#[test]
fn time_tracking_gate() {
    assert!(should_track_time(1, true));
    assert!(should_track_time(0, false));
    assert!(!should_track_time(0, true));
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn body_key_lookup_and_state_failures_in_scala_order() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let app = app(&db, false);
    let active = annotation(&db, &w, "Active").await;
    // validateJson runs before the service key.
    let (status, _, body) = post_raw(&app, "wrong", "{".into()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, _, _) = post(&app, "wrong", json!({"annotationId": active})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Wrong key: plain-text 403, nothing touched.
    let (status, content_type, body) =
        post(&app, "wrong", report(&active, Some(&w.f.token), 1, 0)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(content_type.starts_with("text/plain"));
    assert_eq!(body, "Tracing store could not be found or accessed.");
    assert_eq!(modified_ms(&db, &active).await, OLD_MODIFIED);
    // Unknown and soft-deleted annotations: Fox.Empty 404.
    let deleted = annotation(&db, &w, "Active").await;
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=true WHERE _id=$1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    for id in [object_id(), deleted.clone()] {
        let (status, _, body) = post(&app, KEY, report(&id, Some(&w.f.token), 1, 0)).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            body["messages"][0]["error"],
            "Could not find or access the requested resource."
        );
    }
    assert_eq!(modified_ms(&db, &deleted).await, OLD_MODIFIED);
    // Finished: 400, no modified/time/contributor side effects.
    let finished = annotation(&db, &w, "Finished").await;
    let (status, _, body) = post(&app, KEY, report(&finished, Some(&w.f.token), 1, 1)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let body: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["messages"][0]["error"], "annotation already finished");
    assert_eq!(modified_ms(&db, &finished).await, OLD_MODIFIED);
    assert!(spans(&db, &finished).await.is_empty());
    // Other non-active states are accepted (only Finished is rejected).
    let cancelled = annotation(&db, &w, "Cancelled").await;
    let (status, _, _) = post(&app, KEY, report(&cancelled, None, 0, 0)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(modified_ms(&db, &cancelled).await > OLD_MODIFIED);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn owner_report_updates_modified_statistics_time_activity_and_analytics() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let app = app(&db, false);
    let id = annotation(&db, &w, "Active").await;
    sqlx::query("UPDATE webknossos.users SET lastActivity='2020-01-01T00:00:00Z' WHERE _id=$1")
        .bind(&w.f.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let mut body = report(&id, Some(&w.f.token), 2, 3);
    // Valid object, invalid non-object (CHECK fails silently), unknown layer.
    body["statistics"] = json!({
        format!("{id}-skel"): {"nodes": 5, "edges": 4},
        format!("{id}-vol"): 7,
        "not-a-layer": {"x": 1},
    });
    let (status, _, response) = post(&app, KEY, body).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response, "");
    assert!(modified_ms(&db, &id).await > OLD_MODIFIED);
    let stats: Vec<(String, Value)> = sqlx::query_as(
        "SELECT tracingId,statistics FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(&id)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(stats[0].1, json!({"nodes": 5, "edges": 4}));
    assert_eq!(stats[1].1, json!({"segments": 1}));
    // logUserInteraction (no contributor gate) credits the annotation.
    assert_eq!(spans(&db, &id).await, vec![(w.f.user_id.clone(), 4000)]);
    let tracing_time: Option<i64> =
        sqlx::query_scalar("SELECT tracingTime FROM webknossos.annotations WHERE _id=$1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(tracing_time, Some(4000));
    // The owner is never added as a contributor.
    assert!(contributors(&db, &id).await.is_empty());
    let recent: bool = sqlx::query_scalar(
        "SELECT lastActivity > NOW() - INTERVAL '1 minute' FROM webknossos.users WHERE _id=$1",
    )
    .bind(&w.f.user_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert!(recent);
    let events = analytics(&db, 2).await;
    assert_eq!(
        events,
        vec![
            (
                "update_annotation".into(),
                json!({"annotation_id": id, "changes_count": 2})
            ),
            (
                "update_annotation_view_only".into(),
                json!({"annotation_id": id, "changes_count": 3})
            ),
        ]
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn significant_change_gate_and_contributor() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let other = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    let gated = app(&db, true);
    let id = annotation(&db, &w, "Active").await;
    // only_with_significant_changes and no significant change: no span, but
    // contributor, modified and view-only analytics still happen.
    let (status, _, _) = post(&gated, KEY, report(&id, Some(&other.token), 0, 1)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(spans(&db, &id).await.is_empty());
    assert_eq!(contributors(&db, &id).await, vec![other.user_id.clone()]);
    assert!(modified_ms(&db, &id).await > OLD_MODIFIED);
    let events = analytics(&db, 1).await;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, "update_annotation_view_only");
    // A significant change is tracked under the same gate; repeated
    // contributor insertion is idempotent.
    let (status, _, _) = post(&gated, KEY, report(&id, Some(&other.token), 1, 0)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(spans(&db, &id).await, vec![(other.user_id.clone(), 4000)]);
    assert_eq!(contributors(&db, &id).await, vec![other.user_id.clone()]);
    // Without the gate a zero-significant report is tracked too.
    let ungated = app(&db, false);
    let second = annotation(&db, &w, "Active").await;
    let (status, _, _) = post(&ungated, KEY, report(&second, Some(&other.token), 0, 0)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(spans(&db, &second).await.len(), 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn unresolvable_user_token_skips_user_steps() {
    let db = TestDb::new().await;
    let w = world(&db).await;
    let other = db
        .seed_user(&object_id(), &w.f.organization_id, false)
        .await;
    sqlx::query(
        "UPDATE webknossos.tokens SET expirationDateTime=NOW()-INTERVAL '1 second' WHERE value=$1",
    )
    .bind(&other.token)
    .execute(&db.pool)
    .await
    .unwrap();
    let app = app(&db, false);
    for token in [
        None,
        Some("unknown-token".to_owned()),
        Some(other.token.clone()),
    ] {
        let id = annotation(&db, &w, "Active").await;
        let mut body = report(&id, token.as_deref(), 5, 5);
        body["statistics"] = json!({format!("{id}-skel"): {"nodes": 9}});
        let (status, _, _) = post(&app, KEY, body).await;
        assert_eq!(status, StatusCode::OK);
        // Annotation-level effects still apply.
        assert!(modified_ms(&db, &id).await > OLD_MODIFIED);
        let nodes: Value = sqlx::query_scalar(
            "SELECT statistics->'nodes' FROM webknossos.annotation_layers WHERE tracingId=$1",
        )
        .bind(format!("{id}-skel"))
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(nodes, json!(9));
        assert!(spans(&db, &id).await.is_empty());
        assert!(contributors(&db, &id).await.is_empty());
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.analyticsEvents")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    db.cleanup().await;
}
