mod common;
use axum::{
    body::Body,
    http::{Request, header},
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, application_info::MiscConfig, mail::MailSender, router, router_with_misc,
};

const NOT_FOUND: &str = "Could not find or access the requested resource.";
const NOT_ENABLED: &str = "Long-running jobs are not enabled for this WEBKNOSSOS instance.";
const JOB_NOT_FOUND: &str = "Job could not be found or accessed.";

struct Answer {
    status: u16,
    location: Option<String>,
    body: Value,
}

async fn send(app: &axum::Router, method: &str, uri: &str, token: Option<&str>) -> Answer {
    let mut request = Request::builder().uri(uri).method(method);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let location = response
        .headers()
        .get(header::LOCATION)
        .map(|value| value.to_str().unwrap().to_owned());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Answer {
        status,
        location,
        body: if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    }
}

async fn request(app: &axum::Router, method: &str, uri: &str, token: Option<&str>) -> (u16, Value) {
    let answer = send(app, method, uri, token).await;
    (answer.status, answer.body)
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

fn enabled_app(db: &TestDb) -> axum::Router {
    router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        MiscConfig {
            jobs_enabled: true,
            ..MiscConfig::default()
        },
        MailSender::default(),
    )
}

fn disabled_app(db: &TestDb) -> axum::Router {
    router(AppState {
        pool: db.pool.clone(),
    })
}

async fn make_superuser(db: &TestDb, multi_user: &str) {
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=TRUE WHERE _id=$1")
        .bind(multi_user)
        .execute(&db.pool)
        .await
        .unwrap();
}

async fn seed_data_store(db: &TestDb, name: &str, public_url: &str, only_org: Option<&str>) {
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name,url,publicUrl,key,onlyAllowedOrganization) VALUES ($1,$2,$2,'key',$3)",
    )
    .bind(name)
    .bind(public_url)
    .bind(only_org)
    .execute(&db.pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_job(
    db: &TestDb,
    owner: &str,
    data_store: &str,
    command: &str,
    args: Value,
    state: &str,
    manual_state: Option<&str>,
    created_seconds: i64,
) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state,manualState,created)
          VALUES ($1,$2,$3,$4,$5,$6::webknossos.JOB_STATE,$7::webknossos.JOB_STATE,to_timestamp($8))"#,
    )
    .bind(&id)
    .bind(owner)
    .bind(data_store)
    .bind(command)
    .bind(args)
    .bind(state)
    .bind(manual_state)
    .bind(created_seconds as f64)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

#[allow(clippy::too_many_arguments)]
async fn seed_transaction(
    db: &TestDb,
    organization: &str,
    delta: i32,
    transaction_state: &str,
    credit_state: &str,
    paid_job: Option<&str>,
    created_seconds: i64,
) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id,_organization,milli_credit_delta,comment,_paid_job,transaction_state,credit_state,created_at,updated_at)
          VALUES ($1,$2,$3,'seeded',$4,$5::webknossos.credit_transaction_state,$6::webknossos.credit_state,
            to_timestamp($7),to_timestamp($7))"#,
    )
    .bind(&id)
    .bind(organization)
    .bind(delta)
    .bind(paid_job)
    .bind(transaction_state)
    .bind(credit_state)
    .bind(created_seconds as f64)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn transactions_of_organization(db: &TestDb, organization: &str) -> Vec<Value> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object('related',_related_transaction,'job',_paid_job,'delta',milli_credit_delta,
          'comment',comment,'transactionState',transaction_state,'creditState',credit_state)
          FROM webknossos.credit_transactions WHERE _organization=$1 ORDER BY created_at, _id"#,
    )
    .bind(organization)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn list_read_status_and_credit_cost() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let member = db.seed_user(&object_id(), org, false).await;
    let other = db.fixture().await;
    seed_data_store(&db, "store", "http://store.example", None).await;
    let export = seed_job(
        &db,
        &member.user_id,
        "store",
        "export_tiff",
        json!({"dataset_id": "0123456789abcdef01234567", "webknossos_token": "secret", "user_auth_token": "secret"}),
        "SUCCESS",
        None,
        1000,
    )
    .await;
    sqlx::query("UPDATE webknossos.jobs SET started=to_timestamp(1001), ended=to_timestamp(1002), returnValue='out.zip', _voxelytics_workflowHash='hash' WHERE _id=$1")
        .bind(&export)
        .execute(&db.pool)
        .await
        .unwrap();
    let failed = seed_job(
        &db,
        &admin.user_id,
        "store",
        "infer_nuclei",
        json!({"dataset_name": "ds"}),
        "FAILURE",
        None,
        2000,
    )
    .await;
    sqlx::query(
        r#"UPDATE webknossos.jobs SET latestRunErrorDetails='{"message":"boom"}' WHERE _id=$1"#,
    )
    .bind(&failed)
    .execute(&db.pool)
    .await
    .unwrap();
    let foreign = seed_job(
        &db,
        &other.user_id,
        "store",
        "convert_to_wkw",
        json!({}),
        "PENDING",
        Some("CANCELLED"),
        3000,
    )
    .await;
    // The list joins any paid transaction without access checks.
    seed_transaction(&db, org, 5000, "Complete", "AddCredits", None, 1).await;
    seed_transaction(&db, org, -700, "Complete", "Spent", Some(&failed), 2).await;
    sqlx::query(
        r#"INSERT INTO webknossos.workers (_id,_dataStore,name,key,maxParallelHighPriorityJobs,supportedJobCommands,lastHeartBeat,created)
          VALUES ($1,'store','w1','worker-key',2,ARRAY['export_tiff','infer_neurons','export_tiff'],NOW(),to_timestamp(5))"#,
    )
    .bind(object_id())
    .execute(&db.pool)
    .await
    .unwrap();

    let disabled = disabled_app(&db);
    assert_eq!(
        request(&disabled, "GET", "/api/jobs", Some(&admin.token)).await,
        (400, error(NOT_ENABLED))
    );
    assert_eq!(
        request(
            &disabled,
            "GET",
            &format!("/api/jobs/{export}"),
            Some(&admin.token)
        )
        .await,
        (400, error(NOT_ENABLED))
    );

    let app = enabled_app(&db);
    assert_eq!(request(&app, "GET", "/api/jobs", None).await.0, 401);
    let export_json = json!({
        "id": export,
        "command": "export_tiff",
        "organizationId": org,
        "ownerFirstName": "Rust",
        "ownerLastName": "Test",
        "ownerEmail": format!("{}@example.test", member.multi_user_id),
        "args": {"dataset_id": "0123456789abcdef01234567"},
        "state": "SUCCESS",
        "returnValue": "out.zip",
        "resultLink": format!("/api/jobs/{export}/export"),
        "voxelyticsWorkflowHash": "hash",
        "created": 1_000_000,
        "started": 1_001_000,
        "ended": 1_002_000
    });
    // Members list their own jobs only; admins list their organization's jobs.
    let (status, list) = request(&app, "GET", "/api/jobs", Some(&member.token)).await;
    assert_eq!(status, 200, "{list}");
    assert_eq!(list, json!([export_json]));
    let (status, list) = request(&app, "GET", "/api/jobs", Some(&admin.token)).await;
    assert_eq!(status, 200, "{list}");
    let failed_json = json!({
        "id": failed,
        "command": "infer_nuclei",
        "organizationId": org,
        "ownerFirstName": "Rust",
        "ownerLastName": "Test",
        "ownerEmail": format!("{}@example.test", admin.multi_user_id),
        "args": {"dataset_name": "ds"},
        "state": "FAILURE",
        "errorDetails": {"message": "boom"},
        "created": 2_000_000,
        "costInMilliCredits": 700
    });
    assert_eq!(list, json!([failed_json, export_json]));
    let (_, list) = request(&app, "GET", "/api/jobs", Some(&other.token)).await;
    assert_eq!(list[0]["state"], "CANCELLED");
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/jobs?command=infer_nuclei",
            Some(&admin.token)
        )
        .await
        .1,
        json!([failed_json])
    );
    assert_eq!(
        request(&app, "GET", "/api/jobs?command=bogus", Some(&admin.token)).await,
        (404, error(NOT_FOUND))
    );
    // Jobs without (existing) datasets are skipped on request.
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/jobs?skipForDeletedDatasets=true",
            Some(&admin.token)
        )
        .await,
        (200, json!([]))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/jobs?skipForDeletedDatasets=nope",
            Some(&admin.token)
        )
        .await
        .0,
        400
    );

    // Read access: owner, admins of the owner's organization, superusers.
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{export}"),
            Some(&member.token)
        )
        .await,
        (200, export_json.clone())
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{export}"),
            Some(&admin.token)
        )
        .await,
        (200, export_json)
    );
    // publicWrites with the requester's context: the cost is only visible with credit access.
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{failed}"),
            Some(&admin.token)
        )
        .await,
        (200, failed_json)
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{failed}"),
            Some(&member.token)
        )
        .await,
        (400, error(JOB_NOT_FOUND))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{export}"),
            Some(&other.token)
        )
        .await,
        (400, error(JOB_NOT_FOUND))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{}", object_id()),
            Some(&admin.token)
        )
        .await,
        (400, error(JOB_NOT_FOUND))
    );
    assert_eq!(
        request(&app, "GET", "/api/jobs/not-an-id", Some(&admin.token))
            .await
            .0,
        400
    );
    // A superuser of another organization may read the job but not its owner (as in Scala).
    make_superuser(&db, &other.multi_user_id).await;
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{export}"),
            Some(&other.token)
        )
        .await,
        (400, error("User could not be found or accessed."))
    );
    let (status, foreign_json) = request(
        &app,
        "GET",
        &format!("/api/jobs/{foreign}"),
        Some(&other.token),
    )
    .await;
    assert_eq!(status, 200, "{foreign_json}");
    assert_eq!(foreign_json["state"], "CANCELLED");

    // Status needs authentication only, not enabled jobs.
    let (status, body) = request(&disabled, "GET", "/api/jobs/status", Some(&member.token)).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["jobsByState"], json!({"SUCCESS": 1, "FAILURE": 1}));
    let workers = body["workers"].as_array().unwrap();
    assert_eq!(workers.len(), 1);
    let worker = workers[0].as_object().unwrap();
    assert_eq!(worker["name"], "w1");
    assert_eq!(worker["maxParallelHighPriorityJobs"], 2);
    assert_eq!(worker["maxParallelLowPriorityJobs"], 1);
    assert_eq!(
        worker["supportedJobCommands"],
        json!(["export_tiff", "infer_neurons"])
    );
    assert_eq!(worker["created"], 5000);
    assert!(worker["lastHeartBeat"].is_i64());
    assert_eq!(worker["lastHeartBeatIsRecent"], true);
    assert_eq!(worker["lastReportedVersion"], Value::Null);
    assert!(worker.contains_key("id"));
    assert_eq!(worker.len(), 9);
    assert_eq!(request(&app, "GET", "/api/jobs/status", None).await.0, 401);

    // Credit cost: no jobs-enabled check; balance with the requester's credit access.
    let cost = |command: &str, bbox: &str| {
        format!("/api/jobs/getCreditCost?command={command}&boundingBoxInMag={bbox}")
    };
    assert_eq!(
        request(
            &disabled,
            "GET",
            &cost("infer_neurons", "0,0,0,1000,1000,1000"),
            Some(&admin.token)
        )
        .await,
        (
            200,
            json!({"costInMilliCredits": 1000, "hasEnoughCredits": true, "organizationMilliCredits": 4300})
        )
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &cost("align_sections", "0,0,0,10,10,10"),
            Some(&member.token)
        )
        .await,
        (
            200,
            json!({"costInMilliCredits": 1, "hasEnoughCredits": false, "organizationMilliCredits": 0})
        )
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &cost("export_tiff", "0,0,0,1,1,1"),
            Some(&admin.token)
        )
        .await,
        (400, error("Unsupported job command export_tiff"))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &cost("bogus", "0,0,0,1,1,1"),
            Some(&admin.token)
        )
        .await,
        (404, error(NOT_FOUND))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &cost("infer_neurons", "0,0,0,1,1"),
            Some(&admin.token)
        )
        .await,
        (404, error(NOT_FOUND))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/jobs/getCreditCost?command=infer_neurons",
            Some(&admin.token)
        )
        .await
        .0,
        400
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn cancel_and_retry_manage_credits() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let member = db.seed_user(&object_id(), org, false).await;
    seed_data_store(&db, "store", "http://store.example", None).await;
    let app = enabled_app(&db);
    let paid = seed_job(
        &db,
        &admin.user_id,
        "store",
        "infer_neurons",
        json!({}),
        "STARTED",
        None,
        1000,
    )
    .await;
    seed_transaction(&db, org, 10_000, "Complete", "AddCredits", None, 1).await;
    seed_transaction(&db, org, -1500, "Pending", "Pending", Some(&paid), 2).await;

    assert_eq!(
        request(
            &disabled_app(&db),
            "PATCH",
            &format!("/api/jobs/{paid}/cancel"),
            Some(&admin.token)
        )
        .await,
        (400, error(NOT_ENABLED))
    );
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/jobs/{}/cancel", object_id()),
            Some(&admin.token)
        )
        .await,
        (404, error(NOT_FOUND))
    );
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/jobs/{paid}/cancel"),
            Some(&member.token)
        )
        .await,
        (404, error(NOT_FOUND))
    );
    // Cancel: manual state set, pending reservation refunded; the response shows the old state.
    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/jobs/{paid}/cancel"),
        Some(&admin.token),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["state"], "STARTED");
    assert_eq!(body["costInMilliCredits"], 1500);
    let (state, manual): (String, Option<String>) =
        sqlx::query_as("SELECT state::text, manualState::text FROM webknossos.jobs WHERE _id=$1")
            .bind(&paid)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (state.as_str(), manual.as_deref()),
        ("STARTED", Some("CANCELLED"))
    );
    let transactions = transactions_of_organization(&db, org).await;
    assert_eq!(transactions.len(), 3);
    assert_eq!(transactions[1]["transactionState"], "Complete");
    assert_eq!(transactions[1]["creditState"], "Refunded");
    assert_eq!(transactions[2]["delta"], 1500);
    assert_eq!(transactions[2]["job"], Value::Null);
    assert_eq!(transactions[2]["creditState"], "Refunding");
    assert_eq!(
        transactions[2]["comment"],
        format!("Refund for cancelled job {paid}.")
    );
    // Cancelling again does not refund again (nothing pending).
    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/jobs/{paid}/cancel"),
        Some(&admin.token),
    )
    .await;
    assert_eq!((status, &body["state"]), (200, &json!("CANCELLED")));
    assert_eq!(transactions_of_organization(&db, org).await.len(), 3);

    // Retry: reserves the job's cost again and resets the job.
    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/jobs/{paid}/retry"),
        Some(&admin.token),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["state"], "CANCELLED");
    assert!(body.get("lastRetry").is_none());
    let row: (String, Option<String>, bool, bool) = sqlx::query_as(
        "SELECT state::text, manualState::text, retriedBySuperUser, lastRetry IS NOT NULL FROM webknossos.jobs WHERE _id=$1",
    )
    .bind(&paid)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(row, ("PENDING".into(), None, false, true));
    let transactions = transactions_of_organization(&db, org).await;
    assert_eq!(transactions.len(), 4);
    assert_eq!(
        transactions[3],
        json!({"related": null, "job": paid, "delta": -1500, "comment": "seeded",
               "transactionState": "Pending", "creditState": "Pending"})
    );
    // A second retry is refused for normal users ...
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/jobs/{paid}/retry"),
            Some(&admin.token)
        )
        .await,
        (
            403,
            error(
                "This job has already been retried once and failed again. This is likely a persistent failure. Please contact an administrator for help."
            )
        )
    );
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/jobs/{}/retry", object_id()),
            Some(&admin.token)
        )
        .await,
        (400, error(JOB_NOT_FOUND))
    );
    // ... but allowed for superusers.
    sqlx::query("UPDATE webknossos.jobs SET state='FAILURE' WHERE _id=$1")
        .bind(&paid)
        .execute(&db.pool)
        .await
        .unwrap();
    make_superuser(&db, &admin.multi_user_id).await;
    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/jobs/{paid}/retry"),
        Some(&admin.token),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["state"], "FAILURE");
    assert!(body["lastRetry"].is_i64());
    let superuser_retry: (String, bool) =
        sqlx::query_as("SELECT state::text, retriedBySuperUser FROM webknossos.jobs WHERE _id=$1")
            .bind(&paid)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(superuser_retry, ("PENDING".into(), true));
    assert_eq!(transactions_of_organization(&db, org).await.len(), 5);

    // Not enough credits for the retry reservation (balance 10000-1500-1500 = 7000).
    let expensive = seed_job(
        &db,
        &admin.user_id,
        "store",
        "align_sections",
        json!({}),
        "FAILURE",
        None,
        2000,
    )
    .await;
    seed_transaction(&db, org, 8000, "Complete", "Refunding", None, 4).await;
    seed_transaction(&db, org, -8000, "Complete", "Refunded", Some(&expensive), 3).await;
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/jobs/{expensive}/retry"),
            Some(&admin.token)
        )
        .await,
        (
            400,
            error("Your organization does not have enough WEBKNOSSOS credits to run this job.")
        )
    );
    let (state,): (String,) =
        sqlx::query_as("SELECT state::text FROM webknossos.jobs WHERE _id=$1")
            .bind(&expensive)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(state, "FAILURE");

    // Members cannot see credit transactions: their retry reserves nothing (as in Scala).
    let own = seed_job(
        &db,
        &member.user_id,
        "store",
        "infer_neurons",
        json!({}),
        "FAILURE",
        None,
        3000,
    )
    .await;
    seed_transaction(&db, org, -100, "Complete", "Spent", Some(&own), 5).await;
    let before = transactions_of_organization(&db, org).await.len();
    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/jobs/{own}/retry"),
        Some(&member.token),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert!(body.get("costInMilliCredits").is_none());
    assert_eq!(transactions_of_organization(&db, org).await.len(), before);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn export_redirects_to_the_data_store() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let member = db.seed_user(&object_id(), org, false).await;
    let other = db.fixture().await;
    seed_data_store(&db, "store", "http://store.example", None).await;
    seed_data_store(
        &db,
        "private",
        "http://private.example",
        Some(&other.organization_id),
    )
    .await;
    // Export works without enabled jobs (no check in Scala).
    let app = disabled_app(&db);
    let job = seed_job(
        &db,
        &member.user_id,
        "store",
        "export_tiff",
        json!({}),
        "SUCCESS",
        None,
        1000,
    )
    .await;
    let answer = send(
        &app,
        "GET",
        &format!("/api/jobs/{job}/export"),
        Some(&member.token),
    )
    .await;
    assert_eq!(answer.status, 303, "{}", answer.body);
    // The user's existing usable Authentication token is reused.
    assert_eq!(
        answer.location.as_deref(),
        Some(
            format!(
                "http://store.example/data/exports/{job}/download?token={}",
                member.token
            )
            .as_str()
        )
    );
    assert_eq!(answer.body, Value::Null);

    // Without a usable Authentication token one is created.
    let datastore_only = db.seed_user(&object_id(), org, true).await;
    sqlx::query("UPDATE webknossos.tokens SET tokenType='DataStore' WHERE value=$1")
        .bind(&datastore_only.token)
        .execute(&db.pool)
        .await
        .unwrap();
    let answer = send(
        &app,
        "GET",
        &format!("/api/jobs/{job}/export"),
        Some(&datastore_only.token),
    )
    .await;
    assert_eq!(answer.status, 303, "{}", answer.body);
    let location = answer.location.unwrap();
    let prefix = format!("http://store.example/data/exports/{job}/download?token=");
    let token = location.strip_prefix(&prefix).unwrap();
    let created: (String, String) = sqlx::query_as(
        "SELECT _user, tokenType::text FROM webknossos.tokens WHERE value=$1 AND NOT isDeleted",
    )
    .bind(token)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        created,
        (datastore_only.user_id.clone(), "Authentication".into())
    );
    // A second export reuses the created token.
    let again = send(
        &app,
        "GET",
        &format!("/api/jobs/{job}/export"),
        Some(&datastore_only.token),
    )
    .await;
    assert_eq!(again.location.as_deref(), Some(location.as_str()));

    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{}/export", object_id()),
            Some(&member.token)
        )
        .await,
        (404, error(NOT_FOUND))
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{job}/export"),
            Some(&other.token)
        )
        .await,
        (404, error(NOT_FOUND))
    );
    assert_eq!(
        request(&app, "GET", &format!("/api/jobs/{job}/export"), None)
            .await
            .0,
        401
    );
    let restricted = seed_job(
        &db,
        &member.user_id,
        "private",
        "export_tiff",
        json!({}),
        "SUCCESS",
        None,
        2000,
    )
    .await;
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/jobs/{restricted}/export"),
            Some(&member.token)
        )
        .await,
        (400, error("Data store could not be found or accessed."))
    );
    db.cleanup().await;
}
