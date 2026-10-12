//! Slack notifications end to end: a local mock incoming webhook receives the
//! JSON bodies the service POSTs, directly and through real routes.
mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{Method, Request, StatusCode, header},
    routing::post,
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::MiscConfig,
    browser_auth::BrowserAuthConfig,
    config::{Config, DatabaseConfig},
    router_with_config,
    slack::{SlackConfig, SlackNotificationService},
};

const PUBLIC_URI: &str = "http://wk.example";

type Bodies = Arc<Mutex<Vec<Value>>>;

async fn record(State(bodies): State<Bodies>, Json(body): Json<Value>) -> StatusCode {
    bodies.lock().unwrap().push(body);
    StatusCode::OK
}

/// Starts a mock webhook and returns its URI and the recorded bodies.
async fn mock_webhook() -> (String, Bodies) {
    let bodies = Bodies::default();
    let hook = Router::new()
        .route("/services/hook", post(record))
        .with_state(bodies.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let uri = format!("http://{}/services/hook", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, hook).await.unwrap() });
    (uri, bodies)
}

/// Waits until at least `count` bodies arrived (sending is fire-and-forget).
async fn wait_for(bodies: &Bodies, count: usize) -> Vec<Value> {
    for _ in 0..200 {
        if bodies.lock().unwrap().len() >= count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    bodies.lock().unwrap().clone()
}

fn slack_config(uri: &str) -> SlackConfig {
    SlackConfig {
        uri: Some(uri.to_owned()),
        verbose_logging_enabled: false,
        public_uri: PUBLIC_URI.into(),
    }
}

fn attachment(title: &str, text: &str, color: &str) -> Value {
    json!({"attachments": [{
        "title": format!("{title} reported from WEBKNOSSOS at {PUBLIC_URI}"),
        "text": text,
        "color": color,
    }]})
}

fn app(db: &TestDb, hook: &str) -> Router {
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        database: DatabaseConfig {
            url: db.connection_url(),
            min_connections: 0,
            max_connections: 5,
            acquire_timeout: Duration::from_secs(5),
        },
        public_url: PUBLIC_URI.parse().unwrap(),
        email_verification_enabled: true,
        jobs_enabled: true,
        jobs: Default::default(),
        annotation_mutex_expiry: Duration::from_secs(120),
        time_tracking: Default::default(),
        auth_routes: Default::default(),
        browser_auth: BrowserAuthConfig {
            signer_secret: Some("rust-slack-test-secret".into()),
            ..BrowserAuthConfig::default()
        },
        service_client: Default::default(),
        allow_delete_datasets: true,
        datasets: Default::default(),
        request_timeout: Duration::from_secs(30),
        shutdown_timeout: Duration::from_secs(1),
        body_limit: 2 * 1024 * 1024,
        misc: MiscConfig {
            jobs_enabled: true,
            public_uri: PUBLIC_URI.into(),
            ..MiscConfig::default()
        },
        voxelytics: Default::default(),
        oidc: Default::default(),
        mail: Default::default(),
        housekeeping: Default::default(),
        slack: slack_config(hook),
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

async fn call(app: &Router, method: Method, uri: &str, body: Value) -> StatusCode {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let _ = response.into_body().collect().await.unwrap();
    status
}

#[tokio::test]
async fn service_posts_scala_payloads_and_rate_limits() {
    let (uri, bodies) = mock_webhook().await;
    let service = SlackNotificationService::new(&slack_config(&uri));
    service.notice_startup("1.2.3");
    let first = wait_for(&bodies, 1).await;
    assert_eq!(
        first,
        vec![attachment(
            "Startup",
            "WEBKNOSSOS version `1.2.3` started",
            "#333ccc"
        )]
    );
    service.notice_base_annotation_task_creation("0123456789abcdef01234567", 3);
    service.warn("W", "w");
    service.success("S", "s");
    service.error("E", "e");
    let all = wait_for(&bodies, 5).await;
    assert!(all.contains(&attachment(
        "Task creation with base",
        "3 tasks with BaseAnnotation for TaskType 0123456789abcdef01234567 have been created",
        "#333ccc"
    )));
    assert!(all.contains(&attachment("W", "w", "#ff8a00")));
    assert!(all.contains(&attachment("S", "s", "#049b4a")));
    assert!(all.contains(&attachment("E", "e", "#e10000")));

    // 30 messages per minute: 25 more pass, everything after is dropped.
    for index in 0..40 {
        service.info("Burst", &index.to_string());
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    let all = wait_for(&bodies, 30).await;
    assert_eq!(all.len(), 30);

    // A failing webhook never affects the caller.
    let broken = SlackNotificationService::new(&slack_config("http://127.0.0.1:9/hook"));
    broken.warn("Unreachable", "ignored");

    // Clones share one rate limit; a fresh service has its own.
    let fresh = SlackNotificationService::new(&slack_config(&uri));
    fresh.clone().info("Fresh", "x");
    assert_eq!(wait_for(&bodies, 31).await.len(), 31);
}

async fn seed_job(db: &TestDb, owner: &str, command: &str) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state,created)
          VALUES ($1,$2,'store',$3,'{"dataset_name":"ds"}','PENDING',to_timestamp(1))"#,
    )
    .bind(&id)
    .bind(owner)
    .bind(command)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn job_status_and_registration_routes_notify_slack() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let (hook, bodies) = mock_webhook().await;
    let app = app(&db, &hook);
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store','http://127.0.0.1:9','http://127.0.0.1:9','key')",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO webknossos.workers (_id,_dataStore,name,key,supportedJobCommands,lastReportedVersion)
          VALUES ($1,'store','worker','worker-key','{infer_neurons}','0.1')"#,
    )
    .bind(object_id())
    .execute(&db.pool)
    .await
    .unwrap();
    let organization: String =
        sqlx::query_scalar("SELECT name FROM webknossos.organizations WHERE _id = $1")
            .bind(&admin.organization_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();

    // JobService.trackNewlyFailed through POST /api/jobs/:id/status.
    let failed = seed_job(&db, &admin.user_id, "infer_neurons").await;
    let status = call(
        &app,
        Method::POST,
        &format!("/api/jobs/{failed}/status?key=worker-key"),
        json!({"state": "FAILURE", "latestRunId": "run-1", "started": 5000, "ended": 9000}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let received = wait_for(&bodies, 1).await;
    assert_eq!(
        received,
        vec![attachment(
            "Failed job",
            &format!(
                "Job `{failed}` failed after waiting 4s and running 4s. Command `infer_neurons`, organization: {organization}."
            ),
            "#ff8a00"
        )]
    );

    // JobService.trackNewlySuccessful (superuser label, workflow link).
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1")
        .bind(&admin.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let succeeded = seed_job(&db, &admin.user_id, "infer_neurons").await;
    sqlx::query("UPDATE webknossos.jobs SET _voxelytics_workflowHash = 'hash1' WHERE _id = $1")
        .bind(&succeeded)
        .execute(&db.pool)
        .await
        .unwrap();
    let status = call(
        &app,
        Method::POST,
        &format!("/api/jobs/{succeeded}/status?key=worker-key"),
        json!({"state": "SUCCESS", "latestRunId": "run-2", "started": 2000, "ended": 62000}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let received = wait_for(&bodies, 2).await;
    assert_eq!(received.len(), 2, "{received:?}");
    let success = &received[1]["attachments"][0];
    assert_eq!(
        success["title"],
        format!("Successful job (for superuser) reported from WEBKNOSSOS at {PUBLIC_URI}")
    );
    assert_eq!(success["color"], "#049b4a");
    let text = success["text"].as_str().unwrap();
    assert!(
        text.starts_with(&format!(
            "Job `{succeeded}` succeeded after waiting 1s and running 1m. Command `infer_neurons`, organization: {organization}."
        )),
        "{text}"
    );
    assert!(
        text.ends_with(&format!(" <{PUBLIC_URI}/workflows/hash1|Workflow Report>")),
        "{text}"
    );

    // AuthenticationController.notifyOnSuspiciousNames through POST /api/auth/register.
    sqlx::query(
        "INSERT INTO webknossos.teams (_id, _organization, name, isOrganizationTeam) VALUES ($1, $2, 'Default', TRUE)",
    )
    .bind(object_id())
    .bind(&admin.organization_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let sign_up = |email: &str, first: &str, last: &str| {
        json!({
            "organization": "",
            "organizationName": "",
            "email": email,
            "password": {"password1": "secret-password", "password2": "secret-password"},
            "firstName": first,
            "lastName": last,
        })
    };
    let status = call(
        &app,
        Method::POST,
        "/api/auth/register",
        sign_up("normal@example.test", "Anna", "McDonald"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let status = call(
        &app,
        Method::POST,
        "/api/auth/register",
        sign_up("bot@example.test", "JoHnDoE", "Smith"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let received = wait_for(&bodies, 3).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(bodies.lock().unwrap().len(), 3, "only the suspicious name");
    assert_eq!(
        received[2],
        attachment(
            "Registration with suspicious name",
            &format!(
                "Name with >=4 case switches detected during registration: JoHnDoE Smith (organizationId {})",
                admin.organization_id
            ),
            "#ff8a00"
        )
    );
    db.cleanup().await;
}
