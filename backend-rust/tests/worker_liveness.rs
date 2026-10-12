//! Worker liveness monitor against a real database and a mock Slack incoming webhook.
mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use chrono::{DateTime, Utc};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use webknossos_backend::{
    scheduler::{JobOutcome, JobSchedule, advisory_lock_key, try_advisory_xact_lock},
    slack::{COLOR_SUCCESS, COLOR_WARN, SlackConfig, SlackNotificationService, format_heartbeat},
    worker_liveness::{self, JOB_NAME, WorkerLivenessConfig, WorkerLivenessMonitor},
};

const PUBLIC_URI: &str = "http://wk.example";
const TIMEOUT: Duration = Duration::from_secs(60);
const RE_REPORT: Duration = Duration::from_secs(3600);

type Bodies = Arc<Mutex<Vec<Value>>>;

async fn record(State(bodies): State<Bodies>, Json(body): Json<Value>) -> StatusCode {
    bodies.lock().unwrap().push(body);
    StatusCode::OK
}

/// Starts a mock webhook and returns a Slack service posting to it plus the recorded bodies.
async fn mock_slack() -> (SlackNotificationService, Bodies) {
    let bodies = Bodies::default();
    let hook = Router::new()
        .route("/services/hook", post(record))
        .with_state(bodies.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let uri = format!("http://{}/services/hook", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, hook).await.unwrap() });
    let service = SlackNotificationService::new(&SlackConfig {
        uri: Some(uri),
        verbose_logging_enabled: false,
        public_uri: PUBLIC_URI.into(),
    });
    (service, bodies)
}

/// Waits until at least `count` bodies arrived, then a little longer so that unexpected extra
/// messages (fire-and-forget POSTs) would also be visible.
async fn bodies_after(bodies: &Bodies, count: usize) -> Vec<Value> {
    for _ in 0..200 {
        if bodies.lock().unwrap().len() >= count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    tokio::time::sleep(Duration::from_millis(250)).await;
    bodies.lock().unwrap().clone()
}

fn attachment(title: &str, text: &str, color: &str) -> Value {
    json!({"attachments": [{
        "title": format!("{title} reported from WEBKNOSSOS at {PUBLIC_URI}"),
        "text": text,
        "color": color,
    }]})
}

fn missing(name: &str, id: &str, heartbeat: DateTime<Utc>, now: DateTime<Utc>) -> Value {
    attachment(
        "Worker missing",
        &format!(
            "Worker {name} ({id}) is not reporting. {}",
            format_heartbeat(heartbeat, now)
        ),
        COLOR_WARN,
    )
}

fn returned(name: &str, id: &str, heartbeat: DateTime<Utc>, now: DateTime<Utc>) -> Value {
    attachment(
        "Worker return",
        &format!(
            "Worker {name} ({id}) is reporting again. {}",
            format_heartbeat(heartbeat, now)
        ),
        COLOR_SUCCESS,
    )
}

/// Millisecond-precision timestamp (as stored and as Scala's Instant).
fn now_ms() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap()
}

async fn seed_worker(
    db: &TestDb,
    name: &str,
    last_heart_beat: DateTime<Utc>,
    deleted: bool,
) -> String {
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name,url,publicUrl,key) \
         VALUES ('test-store','http://127.0.0.1:9','http://127.0.0.1:9','key') ON CONFLICT DO NOTHING",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    let id = object_id();
    sqlx::query(
        "INSERT INTO webknossos.workers (_id,_dataStore,name,key,lastHeartBeat,isDeleted) \
         VALUES ($1,'test-store',$2,$3,$4,$5)",
    )
    .bind(&id)
    .bind(name)
    .bind(format!("key-{id}"))
    .bind(last_heart_beat)
    .bind(deleted)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn set_heart_beat(db: &TestDb, id: &str, last_heart_beat: DateTime<Utc>) {
    sqlx::query("UPDATE webknossos.workers SET lastHeartBeat = $2 WHERE _id = $1")
        .bind(id)
        .bind(last_heart_beat)
        .execute(&db.pool)
        .await
        .unwrap();
}

fn completed(outcome: JobOutcome) -> String {
    match outcome {
        JobOutcome::Completed(result) => result,
        other => panic!("expected a completed tick, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn missing_worker_is_reported_once_re_reported_and_return_reported() {
    let db = TestDb::new().await;
    let (slack, bodies) = mock_slack().await;
    let monitor = WorkerLivenessMonitor::new(TIMEOUT, RE_REPORT, slack);
    let t0 = now_ms();
    let stale = t0 - chrono::Duration::minutes(5);
    let dead = seed_worker(&db, "dead-worker", stale, false).await;
    let alive = seed_worker(&db, "alive-worker", t0, false).await;
    let _deleted = seed_worker(&db, "deleted-worker", stale, true).await;

    // First tick: exactly one "Worker missing" (deleted workers are ignored, alive one is fine).
    let result = completed(monitor.tick_at(&db.pool, t0).await.unwrap());
    assert_eq!(
        result,
        "Checked 2 workers: 1 reported missing, 0 reported returned."
    );
    assert_eq!(
        bodies_after(&bodies, 1).await,
        vec![missing("dead-worker", &dead, stale, t0)]
    );
    assert_eq!(monitor.reported_as_dead(t0), vec![dead.clone()]);

    // Further ticks within the re-report interval: nothing new.
    for minutes in [1, 30, 59] {
        let t = t0 + chrono::Duration::minutes(minutes);
        set_heart_beat(&db, &alive, t).await;
        let result = completed(monitor.tick_at(&db.pool, t).await.unwrap());
        assert_eq!(
            result,
            "Checked 2 workers: 0 reported missing, 0 reported returned."
        );
    }
    assert_eq!(bodies_after(&bodies, 1).await.len(), 1);

    // After the re-report interval: reported again.
    let t1 = t0 + chrono::Duration::from_std(RE_REPORT).unwrap();
    set_heart_beat(&db, &alive, t1).await;
    monitor.tick_at(&db.pool, t1).await.unwrap();
    let received = bodies_after(&bodies, 2).await;
    assert_eq!(received.len(), 2);
    assert_eq!(received[1], missing("dead-worker", &dead, stale, t1));

    // Heartbeat again: one "Worker return", then quiet.
    let t2 = t1 + chrono::Duration::minutes(1);
    let beat = t2 - chrono::Duration::seconds(5);
    set_heart_beat(&db, &dead, beat).await;
    set_heart_beat(&db, &alive, t2).await;
    let result = completed(monitor.tick_at(&db.pool, t2).await.unwrap());
    assert_eq!(
        result,
        "Checked 2 workers: 0 reported missing, 1 reported returned."
    );
    monitor
        .tick_at(&db.pool, t2 + chrono::Duration::seconds(1))
        .await
        .unwrap();
    let received = bodies_after(&bodies, 3).await;
    assert_eq!(received.len(), 3);
    assert_eq!(received[2], returned("dead-worker", &dead, beat, t2));
    assert!(monitor.reported_as_dead(t2).is_empty());

    // Missing again later: reported right away (new store entry).
    let t3 = t2 + chrono::Duration::minutes(10);
    set_heart_beat(&db, &alive, t3).await;
    monitor.tick_at(&db.pool, t3).await.unwrap();
    let received = bodies_after(&bodies, 4).await;
    assert_eq!(received.len(), 4);
    assert_eq!(received[3], missing("dead-worker", &dead, beat, t3));

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn tick_is_skipped_while_another_instance_holds_the_lock() {
    let db = TestDb::new().await;
    let (slack, bodies) = mock_slack().await;
    let monitor = WorkerLivenessMonitor::new(TIMEOUT, RE_REPORT, slack);
    let t0 = now_ms();
    let stale = t0 - chrono::Duration::minutes(5);
    let dead = seed_worker(&db, "dead-worker", stale, false).await;

    let mut holder = db.pool.begin().await.unwrap();
    assert!(
        try_advisory_xact_lock(&mut holder, advisory_lock_key(JOB_NAME))
            .await
            .unwrap()
    );
    for _ in 0..3 {
        assert_eq!(
            monitor.tick_at(&db.pool, t0).await.unwrap(),
            JobOutcome::SkippedLocked
        );
    }
    assert!(monitor.reported_as_dead(t0).is_empty());
    assert!(bodies_after(&bodies, 0).await.is_empty());
    holder.rollback().await.unwrap();

    let result = completed(monitor.tick_at(&db.pool, t0).await.unwrap());
    assert_eq!(
        result,
        "Checked 1 workers: 1 reported missing, 0 reported returned."
    );
    assert_eq!(
        bodies_after(&bodies, 1).await,
        vec![missing("dead-worker", &dead, stale, t0)]
    );

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn scheduled_monitor_reports_and_stops() {
    let db = TestDb::new().await;
    let (slack, bodies) = mock_slack().await;
    let stale = now_ms() - chrono::Duration::minutes(5);
    let dead = seed_worker(&db, "dead-worker", stale, false).await;
    let config = WorkerLivenessConfig {
        schedule: JobSchedule {
            enabled: true,
            interval: Duration::from_millis(50),
            initial_delay: Duration::ZERO,
        },
        re_report_interval: RE_REPORT,
    };
    let monitor = WorkerLivenessMonitor::new(TIMEOUT, config.re_report_interval, slack);
    let handle = worker_liveness::scheduler(db.pool.clone(), &config, monitor.clone()).spawn();
    assert_eq!(handle.job_names(), vec![JOB_NAME]);
    // Many ticks run, but the missing worker is reported only once.
    tokio::time::sleep(Duration::from_millis(400)).await;
    tokio::time::timeout(Duration::from_secs(5), handle.shutdown())
        .await
        .expect("monitor stops within the timeout");
    let received = bodies_after(&bodies, 1).await;
    assert_eq!(received.len(), 1);
    assert_eq!(
        received[0]["attachments"][0]["title"],
        format!("Worker missing reported from WEBKNOSSOS at {PUBLIC_URI}")
    );
    assert!(
        received[0]["attachments"][0]["text"]
            .as_str()
            .unwrap()
            .starts_with(&format!("Worker dead-worker ({dead}) is not reporting."))
    );
    assert_eq!(monitor.reported_as_dead(Utc::now()), vec![dead]);

    db.cleanup().await;
}
