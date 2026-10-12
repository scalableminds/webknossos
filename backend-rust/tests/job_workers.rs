mod common;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{StatusCode, header},
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::{MiscConfig, default_features},
    mail::{MailSender, RecordingMailer},
    router_with_misc,
};

const NOT_FOUND: &str = "Could not find or access the requested resource.";
const WORKER_NOT_FOUND: &str = "Could not find this worker in the database.";
const JOB_NOT_FOUND: &str = "Job could not be found or accessed.";
const CLEANUP_FAILED: &str = "Could not clean up failed job.";
const VOXELYTICS_NOT_ENABLED: &str =
    "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance.";
const AI_INFERENCE_NOT_FOUND: &str = "Could not find requested AI inference.";

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

fn app(db: &TestDb, voxelytics: bool, mailer: &RecordingMailer) -> Router {
    let mut features = default_features();
    features.insert("voxelyticsEnabled".into(), json!(voxelytics));
    router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        MiscConfig {
            jobs_enabled: true,
            features,
            public_uri: "http://wk.example".into(),
            ..MiscConfig::default()
        },
        MailSender::new(mailer.clone()),
    )
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (u16, Value) {
    let mut request = Request::builder().uri(uri).method(method);
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
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

async fn seed_data_store(db: &TestDb, name: &str, url: &str) {
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ($1,$2,$2,'key')",
    )
    .bind(name)
    .bind(url)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn seed_worker(
    db: &TestDb,
    key: &str,
    data_store: &str,
    commands: &[&str],
    max_high: i32,
    max_low: i32,
) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.workers
          (_id,_dataStore,name,key,maxParallelHighPriorityJobs,maxParallelLowPriorityJobs,supportedJobCommands,lastReportedVersion)
          VALUES ($1,$2,'worker',$3,$4,$5,$6,'0.1')"#,
    )
    .bind(&id)
    .bind(data_store)
    .bind(key)
    .bind(max_high)
    .bind(max_low)
    .bind(commands.iter().map(|c| c.to_string()).collect::<Vec<_>>())
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

#[allow(clippy::too_many_arguments)]
async fn seed_job(
    db: &TestDb,
    owner: &str,
    data_store: &str,
    command: &str,
    args: Value,
    state: &str,
    worker: Option<&str>,
    created_seconds: i64,
) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state,_worker,created)
          VALUES ($1,$2,$3,$4,$5,$6::webknossos.JOB_STATE,$7,to_timestamp($8))"#,
    )
    .bind(&id)
    .bind(owner)
    .bind(data_store)
    .bind(command)
    .bind(args)
    .bind(state)
    .bind(worker)
    .bind(created_seconds as f64)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn seed_pending_transaction(db: &TestDb, organization: &str, job: &str, delta: i32) {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id,_organization,milli_credit_delta,comment,_paid_job,transaction_state,credit_state)
          VALUES ($1,$2,$3,'reserved',$4,'Pending','Pending')"#,
    )
    .bind(object_id())
    .bind(organization)
    .bind(delta)
    .bind(job)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn transactions_of_job(db: &TestDb, job: &str) -> Vec<Value> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object('delta',milli_credit_delta,'comment',comment,
            'transactionState',transaction_state,'creditState',credit_state)
          FROM webknossos.credit_transactions
          WHERE _paid_job = $1 OR _related_transaction IN
            (SELECT _id FROM webknossos.credit_transactions WHERE _paid_job = $1)
          ORDER BY created_at, comment"#,
    )
    .bind(job)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

async fn seed_dataset(db: &TestDb, organization: &str, directory: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,sortingKey) SELECT $1,'store',_id,_rootFolder,$3,$3,NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id)
        .bind(organization)
        .bind(directory)
        .execute(&db.pool)
        .await
        .unwrap();
    id
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|job| job["job_id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn request_jobs_reserves_by_priority_and_hands_out_tokens() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let owner = &admin.user_id;
    let mailer = RecordingMailer::default();
    let app = app(&db, false, &mailer);
    seed_data_store(&db, "store", "http://store.example").await;
    seed_data_store(&db, "other", "http://other.example").await;
    let worker = seed_worker(
        &db,
        "worker-key",
        "store",
        &["export_tiff", "compute_mesh_file", "infer_neurons"],
        1,
        2,
    )
    .await;
    let other_worker = seed_worker(&db, "other-key", "other", &["compute_mesh_file"], 1, 1).await;
    let args = json!({"dataset_id": "0123456789abcdef01234567", "webknossos_token": "keep"});
    let export_old = seed_job(
        &db,
        owner,
        "store",
        "export_tiff",
        args.clone(),
        "PENDING",
        None,
        10,
    )
    .await;
    let export_new = seed_job(
        &db,
        owner,
        "store",
        "export_tiff",
        json!({}),
        "PENDING",
        None,
        11,
    )
    .await;
    let mesh_1 = seed_job(
        &db,
        owner,
        "store",
        "compute_mesh_file",
        json!({}),
        "PENDING",
        None,
        20,
    )
    .await;
    let mesh_2 = seed_job(
        &db,
        owner,
        "store",
        "compute_mesh_file",
        json!({}),
        "PENDING",
        None,
        21,
    )
    .await;
    let mesh_3 = seed_job(
        &db,
        owner,
        "store",
        "compute_mesh_file",
        json!({}),
        "PENDING",
        None,
        22,
    )
    .await;
    // Unsupported command, another datastore, already assigned elsewhere: never reserved.
    let unsupported = seed_job(
        &db,
        owner,
        "store",
        "infer_nuclei",
        json!({}),
        "PENDING",
        None,
        1,
    )
    .await;
    let elsewhere = seed_job(
        &db,
        owner,
        "other",
        "compute_mesh_file",
        json!({}),
        "PENDING",
        None,
        1,
    )
    .await;
    let taken = seed_job(
        &db,
        owner,
        "store",
        "compute_mesh_file",
        json!({}),
        "PENDING",
        Some(&other_worker),
        1,
    )
    .await;
    // Finished jobs of this worker are neither counted nor returned.
    seed_job(
        &db,
        owner,
        "store",
        "compute_mesh_file",
        json!({}),
        "SUCCESS",
        Some(&worker),
        1,
    )
    .await;

    assert_eq!(
        call(&app, "GET", "/api/jobs/request?key=wrong", None).await,
        (400, error(WORKER_NOT_FOUND))
    );
    assert_eq!(call(&app, "GET", "/api/jobs/request", None).await.0, 400);

    let (status, body) = call(
        &app,
        "GET",
        "/api/jobs/request?key=worker-key&workerVersion=1.2.3",
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    // The static route wins over /jobs/{id}: a worker response, not a job.
    assert_eq!(body["to_cancel"], json!([]));
    assert_eq!(
        ids(&body["to_run"]),
        vec![export_old.clone(), mesh_1.clone(), mesh_2.clone()]
    );
    let first = &body["to_run"][0];
    assert_eq!(first["command"], "export_tiff");
    let kwargs = first["job_kwargs"].as_object().unwrap();
    assert_eq!(kwargs["dataset_id"], "0123456789abcdef01234567");
    assert_eq!(kwargs["webknossos_token"], "keep");
    let token = kwargs["user_auth_token"].as_str().unwrap();
    let (token_type, token_user, days): (String, String, f64) = sqlx::query_as(
        "SELECT tokenType::text, _user, EXTRACT(EPOCH FROM expirationDateTime - created)::float8 / 86400 FROM webknossos.tokens WHERE value = $1",
    )
    .bind(token)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        (token_type.as_str(), token_user.as_str()),
        ("Job", owner.as_str())
    );
    assert!((days - 7.0).abs() < 0.01, "{days}");
    let (version, recent): (Option<String>, bool) = sqlx::query_as(
        "SELECT lastReportedVersion, lastHeartBeat > NOW() - INTERVAL '1 minute' FROM webknossos.workers WHERE _id=$1",
    )
    .bind(&worker)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!((version.as_deref(), recent), (Some("1.2.3"), true));
    let assignments: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT _id, _worker FROM webknossos.jobs")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    let worker_of = |job: &str| {
        assignments
            .iter()
            .find(|(id, _)| id == job)
            .and_then(|(_, worker)| worker.clone())
    };
    assert_eq!(worker_of(&export_new), None);
    assert_eq!(worker_of(&mesh_3), None);
    assert_eq!(worker_of(&unsupported), None);
    assert_eq!(worker_of(&elsewhere), None);
    assert_eq!(worker_of(&taken).as_deref(), Some(other_worker.as_str()));

    // Polling again hands out the same jobs (fresh tokens) and keeps the version.
    let (status, again) = call(&app, "GET", "/api/jobs/request?key=worker-key", None).await;
    assert_eq!(status, 200);
    assert_eq!(ids(&again["to_run"]), ids(&body["to_run"]));
    assert_ne!(
        again["to_run"][0]["job_kwargs"]["user_auth_token"],
        json!(token)
    );
    let version: Option<String> =
        sqlx::query_scalar("SELECT lastReportedVersion FROM webknossos.workers WHERE _id=$1")
            .bind(&worker)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(version.as_deref(), Some("1.2.3"));

    // A user cancels mesh_1: it moves to to_cancel and frees a low priority slot.
    sqlx::query("UPDATE webknossos.jobs SET manualState='CANCELLED' WHERE _id=$1")
        .bind(&mesh_1)
        .execute(&db.pool)
        .await
        .unwrap();
    // The export finished: the next high priority job is reserved.
    sqlx::query("UPDATE webknossos.jobs SET state='SUCCESS' WHERE _id=$1")
        .bind(&export_old)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = call(&app, "GET", "/api/jobs/request?key=worker-key", None).await;
    assert_eq!(status, 200);
    assert_eq!(ids(&body["to_run"]), vec![export_new, mesh_2, mesh_3]);
    assert_eq!(ids(&body["to_cancel"]), vec![mesh_1]);

    // A deleted worker no longer exists for the API.
    sqlx::query("UPDATE webknossos.workers SET isDeleted=TRUE WHERE _id=$1")
        .bind(&worker)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/jobs/request?key=worker-key", None).await,
        (400, error(WORKER_NOT_FOUND))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn concurrent_workers_never_receive_the_same_job() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let mailer = RecordingMailer::default();
    let app = app(&db, false, &mailer);
    seed_data_store(&db, "store", "http://store.example").await;
    let commands = ["compute_mesh_file"];
    seed_worker(&db, "key-a", "store", &commands, 1, 3).await;
    seed_worker(&db, "key-b", "store", &commands, 1, 3).await;
    let mut all = Vec::new();
    for second in 0..6 {
        all.push(
            seed_job(
                &db,
                &admin.user_id,
                "store",
                "compute_mesh_file",
                json!({}),
                "PENDING",
                None,
                second,
            )
            .await,
        );
    }
    let (a, b) = tokio::join!(
        call(&app, "GET", "/api/jobs/request?key=key-a", None),
        call(&app, "GET", "/api/jobs/request?key=key-b", None),
    );
    assert_eq!((a.0, b.0), (200, 200), "{} {}", a.1, b.1);
    let (a, b) = (ids(&a.1["to_run"]), ids(&b.1["to_run"]));
    assert_eq!((a.len(), b.len()), (3, 3));
    let mut union: Vec<String> = a.iter().chain(&b).cloned().collect();
    union.sort();
    all.sort();
    assert_eq!(union, all);
    db.cleanup().await;
}

type Calls = Arc<Mutex<Vec<String>>>;

async fn record(State(calls): State<Calls>, request: Request) -> StatusCode {
    calls
        .lock()
        .unwrap()
        .push(format!("{} {}", request.method(), request.uri()));
    StatusCode::OK
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn status_updates_complete_and_refund_credits() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let mailer = RecordingMailer::default();
    let app = app(&db, false, &mailer);
    let calls = Calls::default();
    let upstream = Router::new().fallback(record).with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    seed_data_store(&db, "store", &base).await;
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id,_organization,milli_credit_delta,comment,transaction_state,credit_state)
          VALUES ($1,$2,10000,'purchase','Complete','Spent')"#,
    )
    .bind(object_id())
    .bind(org)
    .execute(&db.pool)
    .await
    .unwrap();
    let worker = seed_worker(&db, "worker-key", "store", &["infer_neurons"], 1, 1).await;
    let email: String = sqlx::query_scalar("SELECT email FROM webknossos.multiUsers WHERE _id=$1")
        .bind(&admin.multi_user_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

    let paid = seed_job(
        &db,
        &admin.user_id,
        "store",
        "infer_neurons",
        json!({"dataset_name": "ds"}),
        "PENDING",
        Some(&worker),
        1,
    )
    .await;
    seed_pending_transaction(&db, org, &paid, -500).await;
    let uri = format!("/api/jobs/{paid}/status?key=worker-key");
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/jobs/{paid}/status?key=wrong"),
            Some(json!({"state": "STARTED"}))
        )
        .await,
        (400, error(WORKER_NOT_FOUND))
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/jobs/{}/status?key=worker-key", object_id()),
            Some(json!({"state": "STARTED"}))
        )
        .await,
        (404, error(NOT_FOUND))
    );
    assert_eq!(
        call(&app, "POST", &uri, Some(json!({"state": "RUNNING"})))
            .await
            .0,
        400
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &uri,
            Some(json!({"state": "STARTED", "errorDetails": "x"}))
        )
        .await
        .0,
        400
    );

    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(json!({"state": "STARTED", "latestRunId": "run-1", "started": 5000})),
    )
    .await;
    assert_eq!((status, body), (200, Value::Null));
    let row: Value = sqlx::query_scalar(
        r#"SELECT jsonb_build_object('state',state,'run',latestRunId,'started',(EXTRACT(EPOCH FROM started)*1000)::bigint,
            'ended',ended,'returnValue',returnValue)
          FROM webknossos.jobs WHERE _id=$1"#,
    )
    .bind(&paid)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        row,
        json!({"state": "STARTED", "run": "run-1", "started": 5000, "ended": null, "returnValue": null})
    );
    assert_eq!(
        transactions_of_job(&db, &paid).await,
        vec![
            json!({"delta": -500, "comment": "reserved", "transactionState": "Pending", "creditState": "Pending"})
        ]
    );

    let (status, _) = call(
        &app,
        "POST",
        &uri,
        Some(json!({"state": "SUCCESS", "latestRunId": "run-1", "returnValue": "0123456789abcdef01234567",
            "started": 5000, "ended": "1970-01-01T00:00:09Z"})),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        transactions_of_job(&db, &paid).await,
        vec![
            json!({"delta": -500, "comment": "reserved", "transactionState": "Complete", "creditState": "Spent"})
        ]
    );
    let ended: i64 = sqlx::query_scalar(
        "SELECT (EXTRACT(EPOCH FROM ended)*1000)::bigint FROM webknossos.jobs WHERE _id=$1",
    )
    .bind(&paid)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(ended, 9000);

    // Failed paid job: refund once; a repeated FAILURE report refunds nothing more.
    let failing = seed_job(
        &db,
        &admin.user_id,
        "store",
        "infer_neurons",
        json!({"dataset_name": "ds"}),
        "STARTED",
        Some(&worker),
        2,
    )
    .await;
    seed_pending_transaction(&db, org, &failing, -300).await;
    let failing_uri = format!("/api/jobs/{failing}/status?key=worker-key");
    let failure = json!({"state": "FAILURE", "errorDetails": {"message": " out of memory "}});
    assert_eq!(
        call(&app, "POST", &failing_uri, Some(failure.clone()))
            .await
            .0,
        200
    );
    assert_eq!(call(&app, "POST", &failing_uri, Some(failure)).await.0, 200);
    assert_eq!(
        transactions_of_job(&db, &failing).await,
        vec![
            json!({"delta": -300, "comment": "reserved", "transactionState": "Complete", "creditState": "Refunded"}),
            json!({"delta": 300, "comment": format!("Refund for failed job {failing}."), "transactionState": "Complete", "creditState": "Refunding"}),
        ]
    );

    // Worker-side cancellation refunds as cancelled.
    let cancelled = seed_job(
        &db,
        &admin.user_id,
        "store",
        "infer_neurons",
        json!({}),
        "PENDING",
        Some(&worker),
        3,
    )
    .await;
    seed_pending_transaction(&db, org, &cancelled, -100).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/jobs/{cancelled}/status?key=worker-key"),
            Some(json!({"state": "CANCELLED"}))
        )
        .await
        .0,
        200
    );
    assert_eq!(
        transactions_of_job(&db, &cancelled).await[1]["comment"],
        json!(format!("Refund for cancelled job {cancelled}."))
    );

    // Notifications are sent after the commit (asynchronously).
    for _ in 0..50 {
        if mailer.messages().len() >= 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let mails = mailer.take();
    let subjects: Vec<&str> = mails.iter().map(|mail| mail.subject.as_str()).collect();
    assert_eq!(subjects.len(), 2, "{subjects:?}");
    assert!(subjects.contains(&"Your segmentation is ready"));
    assert!(subjects.contains(&"Oops. Your WEBKNOSSOS job failed"));
    let success = mails
        .iter()
        .find(|m| m.subject == "Your segmentation is ready")
        .unwrap();
    assert_eq!(success.recipients, vec![email.clone()]);
    assert!(
        success
            .body_html
            .contains("http://wk.example/datasets/0123456789abcdef01234567/view")
    );
    let failed = mails
        .iter()
        .find(|m| m.subject.starts_with("Oops"))
        .unwrap();
    assert!(failed.body_html.contains("out of memory"));

    // Failed conversion: the dataset is removed and the datastore cleans up uploads.
    let dataset = seed_dataset(&db, org, "upload-dir").await;
    let conversion = seed_job(
        &db,
        &admin.user_id,
        "store",
        "convert_to_wkw",
        json!({"organization_id": org, "dataset_directory_name": "upload-dir", "dataset_name": "Upload"}),
        "STARTED",
        Some(&worker),
        4,
    )
    .await;
    let conversion_uri = format!("/api/jobs/{conversion}/status?key=worker-key");
    assert_eq!(
        call(
            &app,
            "POST",
            &conversion_uri,
            Some(json!({"state": "FAILURE"}))
        )
        .await
        .0,
        200
    );
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.datasets WHERE _id=$1")
            .bind(&dataset)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
    for _ in 0..50 {
        if !calls.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let recorded = calls.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1, "{recorded:?}");
    assert!(recorded[0].starts_with("DELETE /data/datasets/upload/dataset/cleanUpUploadFiles?"));
    assert!(recorded[0].contains(&format!("jobId={conversion}")));
    assert!(recorded[0].contains("directoryName=upload-dir"));
    // Reporting the failure again finds no dataset to clean up.
    assert_eq!(
        call(
            &app,
            "POST",
            &conversion_uri,
            Some(json!({"state": "FAILURE"}))
        )
        .await,
        (400, error(CLEANUP_FAILED))
    );
    for _ in 0..50 {
        if !mailer.messages().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let mails = mailer.take();
    assert!(
        mails
            .iter()
            .any(|m| m.subject == "Oops. Your dataset upload & conversion failed"),
        "{mails:?}"
    );
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn attach_workflow_and_inference_dataset() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let mailer = RecordingMailer::default();
    let disabled = app(&db, false, &mailer);
    let enabled = app(&db, true, &mailer);
    seed_data_store(&db, "store", "http://store.example").await;
    seed_worker(&db, "worker-key", "store", &["infer_neurons"], 1, 1).await;
    let job = seed_job(
        &db,
        &admin.user_id,
        "store",
        "infer_neurons",
        json!({}),
        "STARTED",
        None,
        1,
    )
    .await;
    let attach = format!("/api/jobs/{job}/attachVoxelyticsWorkflow?key=worker-key");

    assert_eq!(
        call(
            &enabled,
            "POST",
            &format!("/api/jobs/{job}/attachVoxelyticsWorkflow?key=wrong"),
            Some(json!("hash"))
        )
        .await,
        (400, error(WORKER_NOT_FOUND))
    );
    assert_eq!(
        call(&disabled, "POST", &attach, Some(json!("hash"))).await,
        (400, error(VOXELYTICS_NOT_ENABLED))
    );
    assert_eq!(call(&enabled, "POST", &attach, Some(json!(5))).await.0, 400);
    assert_eq!(
        call(
            &enabled,
            "POST",
            &format!(
                "/api/jobs/{}/attachVoxelyticsWorkflow?key=worker-key",
                object_id()
            ),
            Some(json!("hash"))
        )
        .await,
        (400, error(JOB_NOT_FOUND))
    );
    assert_eq!(
        call(&enabled, "POST", &attach, Some(json!("hash-1"))).await,
        (200, Value::Null)
    );
    sqlx::query("INSERT INTO webknossos.voxelytics_workflows (hash,name,_organization) VALUES ('hash-2','real name',$1)")
        .bind(org)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&enabled, "POST", &attach, Some(json!("hash-2")))
            .await
            .0,
        200
    );
    let workflows: Vec<(String, String)> = sqlx::query_as(
        "SELECT hash, name FROM webknossos.voxelytics_workflows WHERE _organization=$1 ORDER BY hash",
    )
    .bind(org)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        workflows,
        vec![
            (
                "hash-1".to_owned(),
                "initializing worker workflow".to_owned()
            ),
            ("hash-2".to_owned(), "real name".to_owned())
        ]
    );
    let hash: Option<String> =
        sqlx::query_scalar("SELECT _voxelytics_workflowHash FROM webknossos.jobs WHERE _id=$1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(hash.as_deref(), Some("hash-2"));

    let inference_uri = format!("/api/jobs/{job}/attachDatasetToInference?key=worker-key");
    assert_eq!(
        call(&disabled, "POST", &inference_uri, Some(json!("result-dir"))).await,
        (404, error(NOT_FOUND))
    );
    let dataset = seed_dataset(&db, org, "result-dir").await;
    assert_eq!(
        call(&disabled, "POST", &inference_uri, Some(json!("result-dir"))).await,
        (400, error(AI_INFERENCE_NOT_FOUND))
    );
    let inference = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.aiInferences (_id,_organization,_inferenceJob,boundingBox,newSegmentationLayerName)
          VALUES ($1,$2,$3,ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'segmentation')"#,
    )
    .bind(&inference)
    .bind(org)
    .bind(&job)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        call(
            &disabled,
            "POST",
            &format!(
                "/api/jobs/{}/attachDatasetToInference?key=worker-key",
                object_id()
            ),
            Some(json!("result-dir"))
        )
        .await,
        (400, error(JOB_NOT_FOUND))
    );
    assert_eq!(
        call(&disabled, "POST", &inference_uri, Some(json!("result-dir"))).await,
        (200, Value::Null)
    );
    let new_dataset: Option<String> =
        sqlx::query_scalar("SELECT _newDataset FROM webknossos.aiInferences WHERE _id=$1")
            .bind(&inference)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(new_dataset, Some(dataset));
    db.cleanup().await;
}
