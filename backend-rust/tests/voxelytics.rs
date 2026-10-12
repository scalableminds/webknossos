mod common;

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, Method, Request, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::MiscConfig,
    router_with_voxelytics,
    voxelytics::{LokiConfig, VoxelyticsConfig},
};

const NOT_ENABLED: &str =
    "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance.";

fn enabled_misc() -> MiscConfig {
    let mut misc = MiscConfig::default();
    misc.features
        .insert("voxelyticsEnabled".into(), Value::Bool(true));
    misc
}

fn app(db: &TestDb, misc: MiscConfig, config: VoxelyticsConfig) -> Router {
    router_with_voxelytics(
        AppState {
            pool: db.pool.clone(),
        },
        misc,
        config,
    )
}

async fn call(
    app: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (u16, Value) {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let request = match body {
        Some(body) => request
            .header("Content-Type", "application/json")
            .body(Body::from(body.to_string())),
        None => request.body(Body::empty()),
    }
    .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

fn error(body: &Value) -> &str {
    body["messages"][0]["error"].as_str().unwrap_or_default()
}

fn artifact(path: &str, size: i64) -> Value {
    json!({
        "path": path, "file_size": size, "inode_count": 2, "version": "1",
        "attributes": {"a": 1}, "iframes": {}, "links": {}
    })
}

fn description(run: &str, workflow: &str) -> Value {
    json!({
        "config": {
            "global_parameters": {"p": 1},
            "paths": ["/data"],
            "schema_version": 2,
            "git_hash": "abc",
            "tasks": {
                "taskA": {"config": {"x": 1}, "inputs": {}, "description": "first",
                          "distribution": {"strategy": "local"}, "output_paths": {}, "task": "a.task"},
                "taskB": {"config": {}, "inputs": null, "distribution": {},
                          "output_paths": {}, "task": "b.task"}
            }
        },
        "artifacts": {
            "taskA": {"out": artifact("/data/out", 100)},
            "notATask": {"ignored": artifact("/data/ignored", 1)}
        },
        "run": {"name": run, "user": "host-user", "hostname": "host", "voxelyticsVersion": "1.0"},
        "workflow": {"name": format!("Workflow {workflow}"), "hash": workflow, "yamlContent": "steps: []"}
    })
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn workflows_events_reports_and_statistics() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    let other_member = db
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    let foreign = db
        .seed_user(&object_id(), &format!("rust-other-{}", object_id()), true)
        .await;
    let config = VoxelyticsConfig::default();

    // Feature flag and authentication.
    let disabled = app(&db, MiscConfig::default(), config.clone());
    let (status, body) = call(
        &disabled,
        Method::GET,
        "/api/voxelytics/workflows",
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!((status, error(&body)), (400, NOT_ENABLED));
    let app = app(&db, enabled_misc(), config);
    let (status, _) = call(&app, Method::GET, "/api/voxelytics/workflows", None, None).await;
    assert_eq!(status, 401);
    let (status, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!((status, body), (200, json!([])));

    // storeWorkflow
    let (status, _) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows",
        Some(&member.token),
        Some(json!({"run": {}})),
    )
    .await;
    assert_eq!(status, 400);
    let (status, body) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows",
        Some(&member.token),
        Some(description("run-1", "wf1")),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    // Repeating it is an idempotent upsert.
    let (status, _) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows",
        Some(&member.token),
        Some(description("run-1", "wf1")),
    )
    .await;
    assert_eq!(status, 200);
    let (status, body) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows",
        Some(&other_member.token),
        Some(description("run-1", "wf1")),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            401,
            "Voxelytics workflow run already exists by another user."
        )
    );
    let (run_id, run_user, workflow_config): (String, String, Value) = sqlx::query_as(
        "SELECT _id, _user, workflow_config FROM webknossos.voxelytics_runs WHERE name = 'run-1'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(run_user, member.user_id);
    assert_eq!(
        workflow_config,
        json!({"global_parameters": {"p": 1}, "paths": ["/data"], "schema_version": 2})
    );
    let artifact_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.voxelytics_artifacts")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(artifact_count, 1);

    // storeWorkflowEvents
    let events = |run: &str| format!("/api/voxelytics/workflows/wf1/events?runName={run}");
    let (status, body) = call(
        &app,
        Method::POST,
        &events("run-1"),
        Some(&other_member.token),
        Some(json!([])),
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (404, "Voxelytics workflow runs not found.")
    );
    let (status, _) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows/wf1/events",
        Some(&member.token),
        Some(json!([])),
    )
    .await;
    assert_eq!(status, 400);
    let (status, _) = call(
        &app,
        Method::POST,
        &events("run-1"),
        Some(&member.token),
        Some(json!([{"type": "UNKNOWN"}])),
    )
    .await;
    assert_eq!(status, 400);
    for batch in [
        json!([
            {"type": "RUN_STATE_CHANGE", "state": "RUNNING", "timestamp": 1000},
            {"type": "TASK_STATE_CHANGE", "taskName": "taskA", "state": "RUNNING", "timestamp": 1000, "artifacts": {}},
            {"type": "CHUNK_STATE_CHANGE", "taskName": "taskA", "executionId": "exec1", "chunkName": "c1", "state": "RUNNING", "timestamp": 1000},
            {"type": "CHUNK_STATE_CHANGE", "taskName": "taskA", "executionId": "exec1", "chunkName": "c2", "state": "RUNNING", "timestamp": "1970-01-01T00:00:01.500Z"},
            {"type": "RUN_HEARTBEAT", "timestamp": chrono::Utc::now().timestamp_millis()}
        ]),
        json!([
            {"type": "CHUNK_STATE_CHANGE", "taskName": "taskA", "executionId": "exec1", "chunkName": "c1", "state": "COMPLETE", "timestamp": 3000},
            {"type": "CHUNK_STATE_CHANGE", "taskName": "taskA", "executionId": "exec1", "chunkName": "c2", "state": "COMPLETE", "timestamp": 4000},
            {"type": "CHUNK_PROFILING", "taskName": "taskA", "executionId": "exec1", "chunkName": "c1", "hostname": "h", "pid": 1, "memory": 10.0, "cpuUser": 1.0, "cpuSystem": 0.5, "timestamp": 2000},
            {"type": "CHUNK_PROFILING", "taskName": "taskA", "executionId": "exec1", "chunkName": "c2", "hostname": "h", "pid": 2, "memory": 30.0, "cpuUser": 3.0, "cpuSystem": 0.5, "timestamp": 2500},
            {"type": "TASK_STATE_CHANGE", "taskName": "taskA", "state": "COMPLETE", "timestamp": 5000, "artifacts": {"out2": artifact("/data/out2", 50)}},
            {"type": "ARTIFACT_FILE_CHECKSUM", "taskName": "taskA", "artifactName": "out", "path": "p1", "resolvedPath": "/r/p1", "checksumMethod": "md5", "checksum": "aa", "fileSize": 7, "lastModified": 100, "timestamp": 6000},
            {"type": "ARTIFACT_FILE_CHECKSUM", "taskName": "taskA", "artifactName": "out", "path": "p1", "resolvedPath": "/r/p1", "checksumMethod": "md5", "checksum": "bb", "fileSize": 7, "lastModified": 100, "timestamp": 6500},
            {"type": "ARTIFACT_FILE_CHECKSUM", "taskName": "taskA", "artifactName": "out2", "path": "p2", "resolvedPath": "/r/p2", "checksumMethod": "md5", "checksum": "cc", "fileSize": 8, "lastModified": 100, "timestamp": 6000}
        ]),
        json!([
            {"type": "RUN_STATE_CHANGE", "state": "COMPLETE", "timestamp": 7000},
            {"type": "TASK_STATE_CHANGE", "taskName": "taskB", "state": "SKIPPED", "timestamp": 7000, "artifacts": {}}
        ]),
    ] {
        let (status, body) = call(
            &app,
            Method::POST,
            &events("run-1"),
            Some(&member.token),
            Some(batch),
        )
        .await;
        assert_eq!(status, 200, "{body}");
    }
    // A second, stale workflow: RUNNING with an old heartbeat.
    let (status, _) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows",
        Some(&member.token),
        Some(description("run-2", "wf2")),
    )
    .await;
    assert_eq!(status, 200);
    let (status, _) = call(
        &app,
        Method::POST,
        "/api/voxelytics/workflows/wf2/events?runName=run-2",
        Some(&member.token),
        Some(json!([
            {"type": "RUN_STATE_CHANGE", "state": "RUNNING", "timestamp": 1000},
            {"type": "TASK_STATE_CHANGE", "taskName": "taskA", "state": "RUNNING", "timestamp": 1000, "artifacts": {}},
            {"type": "RUN_HEARTBEAT", "timestamp": 2000}
        ])),
    )
    .await;
    assert_eq!(status, 200);

    // listWorkflows: own runs for members, all runs for admins.
    let (status, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let workflows = body.as_array().unwrap();
    assert_eq!(workflows.len(), 2);
    let wf1 = workflows.iter().find(|w| w["hash"] == "wf1").unwrap();
    assert_eq!(wf1["name"], "Workflow wf1");
    assert_eq!(wf1["state"], "COMPLETE");
    assert_eq!(wf1["beginTime"], 1000);
    assert_eq!(wf1["endTime"], 7000);
    assert_eq!(
        wf1["taskCounts"],
        json!({"total": 2, "failed": 0, "skipped": 1, "complete": 1, "cancelled": 0, "fileSize": 150, "inodeCount": 4})
    );
    let run = &wf1["runs"][0];
    assert_eq!(run["id"], run_id);
    assert_eq!(run["hostUserName"], "host-user");
    assert_eq!(run["userFirstName"], "Rust");
    assert_eq!(run["taskCounts"]["complete"], 1);
    let wf2 = workflows.iter().find(|w| w["hash"] == "wf2").unwrap();
    assert_eq!(wf2["state"], "STALE");
    assert_eq!(wf2["endTime"], 2000);
    assert_eq!(
        wf2["taskCounts"]["failed"], 1,
        "stale tasks count as failed"
    );
    let (_, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows",
        Some(&other_member.token),
        None,
    )
    .await;
    assert_eq!(body, json!([]));
    let (_, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows",
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(body.as_array().unwrap().len(), 2);

    // getWorkflow: any run of the organization is readable.
    let (status, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1",
        Some(&other_member.token),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["workflow"],
        json!({"name": "Workflow wf1", "hash": "wf1", "yamlContent": "steps: []"})
    );
    assert_eq!(body["runs"][0]["state"], "COMPLETE");
    assert_eq!(body["runs"][0]["workflowConfig"]["paths"], json!(["/data"]));
    assert_eq!(body["config"]["paths"], json!(["/data"]));
    assert_eq!(
        body["config"]["tasks"]["taskA"],
        json!({"config": {"x": 1}, "description": "first", "distribution": {"strategy": "local"},
               "inputs": {}, "output_paths": {}, "task": "a.task"})
    );
    assert_eq!(body["config"]["tasks"]["taskB"]["description"], Value::Null);
    let out = &body["artifacts"]["taskA"]["out"];
    assert_eq!(out["path"], "/data/out");
    assert_eq!(out["fileSize"], 100);
    assert_eq!(
        out["metadata"],
        json!({"attributes": {"a": 1}, "iframes": {}, "links": {}})
    );
    assert!(out.get("foreignWorkflow").is_none());
    assert_eq!(body["artifacts"]["taskA"]["out2"]["fileSize"], 50);
    let tasks = body["tasks"].as_array().unwrap();
    let task_a = tasks.iter().find(|t| t["taskName"] == "taskA").unwrap();
    assert_eq!(task_a["state"], "COMPLETE");
    assert_eq!(task_a["beginTime"], 1000);
    assert_eq!(task_a["endTime"], 5000);
    assert_eq!(task_a["currentExecutionId"], Value::Null);
    assert_eq!(
        task_a["chunkCounts"],
        json!({"total": 2, "failed": 0, "skipped": 0, "complete": 2, "cancelled": 0})
    );
    assert_eq!(task_a["runs"][0]["runId"], run_id);
    let task_b = tasks.iter().find(|t| t["taskName"] == "taskB").unwrap();
    assert_eq!(task_b["state"], "SKIPPED");
    assert_eq!(task_b["beginTime"], Value::Null);
    let (status, _) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1?runId=nope",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 400);
    let (status, body) = call(
        &app,
        Method::GET,
        &format!("/api/voxelytics/workflows/wf1?runId={}", object_id()),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (404, "Voxelytics workflow runs not found.")
    );
    let (status, body) = call(
        &app,
        Method::GET,
        &format!("/api/voxelytics/workflows/wf1?runId={run_id}"),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!((status, body["runs"].as_array().unwrap().len()), (200, 1));
    let (status, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1",
        Some(&foreign.token),
        None,
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (404, "Voxelytics workflow not found.")
    );
    let (_, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf2",
        Some(&member.token),
        None,
    )
    .await;
    let tasks = body["tasks"].as_array().unwrap();
    let task_a = tasks.iter().find(|t| t["taskName"] == "taskA").unwrap();
    assert_eq!(
        (&task_a["state"], &task_a["endTime"]),
        (&json!("STALE"), &json!(2000))
    );
    let task_b = tasks.iter().find(|t| t["taskName"] == "taskB").unwrap();
    assert_eq!(task_b["state"], "PENDING");

    // chunkStatistics
    let (status, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1/chunkStatistics?taskName=taskA",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body,
        json!([{
            "executionId": "exec1",
            "chunkCounts": {"total": 2, "failed": 0, "skipped": 0, "complete": 2, "cancelled": 0},
            "beginTime": 1000,
            "endTime": 4000,
            "wallTime": 3.0,
            "memory": {"max": 30.0, "median": 20.0, "stddev": body[0]["memory"]["stddev"]},
            "cpuUser": {"max": 3.0, "median": 2.0, "stddev": body[0]["cpuUser"]["stddev"]},
            "cpuSystem": {"max": 0.5, "median": 0.5, "stddev": 0.0},
            "duration": {"max": 2.5, "median": 2.25, "stddev": body[0]["duration"]["stddev"], "sum": 4.5}
        }])
    );
    assert!((body[0]["memory"]["stddev"].as_f64().unwrap() - 14.142135).abs() < 1e-5);
    let (status, _) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1/chunkStatistics",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 400);
    let (status, _) = call(
        &app,
        Method::GET,
        &format!(
            "/api/voxelytics/workflows/wf1/chunkStatistics?taskName=taskA&runId={}",
            object_id()
        ),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 404);

    // artifactChecksums: the oldest event per file.
    let (status, body) = call(
        &app,
        Method::GET,
        &format!(
            "/api/voxelytics/workflows/wf1/artifactChecksums?taskName=taskA&artifactName=out&runId={run_id}"
        ),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body,
        json!([{"taskName": "taskA", "artifactName": "out", "path": "p1", "resolvedPath": "/r/p1",
                "timestamp": 6000, "checksumMethod": "md5", "checksum": "aa", "fileSize": 7, "lastModified": 100}])
    );
    let (_, body) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1/artifactChecksums?taskName=taskA",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(body.as_array().unwrap().len(), 2);

    // deleteWorkflow: superusers only; job links are cleared.
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('vx-store','http://s','http://s','k')")
        .execute(&db.pool).await.unwrap();
    let job = object_id();
    sqlx::query("INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,_voxelytics_workflowHash) VALUES ($1,$2,'vx-store','convert_to_wkw','{}','wf1')")
        .bind(&job).bind(&member.user_id).execute(&db.pool).await.unwrap();
    let (status, body) = call(
        &app,
        Method::DELETE,
        "/api/voxelytics/workflows/wf1",
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(
        (status, error(&body)),
        (
            400,
            "This feature is currently only available for superusers."
        )
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1")
        .bind(&admin.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _) = call(
        &app,
        Method::DELETE,
        "/api/voxelytics/workflows/unknown",
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(status, 404);
    let (status, _) = call(
        &app,
        Method::DELETE,
        "/api/voxelytics/workflows/wf1",
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(status, 200);
    let (runs, tasks, link): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM webknossos.voxelytics_runs WHERE workflow_hash = 'wf1'), (SELECT COUNT(*) FROM webknossos.voxelytics_tasks WHERE _run = $1), (SELECT _voxelytics_workflowHash FROM webknossos.jobs WHERE _id = $2)",
    )
    .bind(&run_id)
    .bind(&job)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!((runs, tasks, link), (0, 0, None));
    let (status, _) = call(
        &app,
        Method::GET,
        "/api/voxelytics/workflows/wf1",
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 404);
    db.cleanup().await;
}

type QueryParams = Vec<(String, String)>;

#[derive(Clone, Default)]
struct Loki {
    ready_calls: Arc<Mutex<u32>>,
    pushes: Arc<Mutex<Vec<(HeaderMap, Value)>>>,
    queries: Arc<Mutex<Vec<QueryParams>>>,
}

async fn loki_ready(State(loki): State<Loki>) -> StatusCode {
    let mut calls = loki.ready_calls.lock().unwrap();
    *calls += 1;
    if *calls == 1 {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::OK
    }
}

async fn loki_push(
    State(loki): State<Loki>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<Value>,
) -> StatusCode {
    loki.pushes.lock().unwrap().push((headers, body));
    StatusCode::NO_CONTENT
}

/// Serves the entries at 1 s, 2 s and 3 s inside [start, end), newest first.
async fn loki_query(
    State(loki): State<Loki>,
    Query(params): Query<QueryParams>,
) -> impl IntoResponse {
    let param = |name: &str| {
        params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
            .unwrap()
    };
    let millis = |name: &str| {
        chrono::DateTime::parse_from_rfc3339(&param(name))
            .unwrap()
            .timestamp_millis()
    };
    let (start, end, limit) = (
        millis("start"),
        millis("end"),
        param("limit").parse::<usize>().unwrap(),
    );
    loki.queries.lock().unwrap().push(params.clone());
    let values: Vec<Value> = [3000_i64, 2000, 1000]
        .into_iter()
        .filter(|t| *t >= start && *t < end)
        .take(limit)
        .map(|t| {
            json!([
                format!("{t}000000"),
                json!({"message": format!("at {t}"), "level": "INFO"}).to_string()
            ])
        })
        .collect();
    axum::Json(
        json!({"status": "success", "data": {"resultType": "streams", "result": [
            {"stream": {"vx_run_name": "run-l", "wk_org": "x"}, "values": values}
        ]}}),
    )
}

fn log_entry(pid: i64, message: &str) -> Value {
    json!({
        "@timestamp": "2024-01-01T00:00:01.250Z",
        "level": "INFO", "pid": pid, "message": message, "host": "h", "program": "vx",
        "vx": {
            "logger_name": "l", "workflow_hash": "wfl", "run_name": "run-l", "task_name": "t",
            "func_name": "f", "line": 12, "path": "/p.py", "process_name": "p", "thread_name": "main",
            "version": "1.0", "user": "u", "process_group_id": 9, "log_path": "/log"
        }
    })
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn logs_are_forwarded_to_and_queried_from_loki() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let member = db
        .seed_user(&object_id(), &admin.organization_id, false)
        .await;
    let foreign = db
        .seed_user(&object_id(), &format!("rust-other-{}", object_id()), true)
        .await;
    let enabled = app(&db, enabled_misc(), VoxelyticsConfig::default());
    let (status, _) = call(
        &enabled,
        Method::POST,
        "/api/voxelytics/workflows",
        Some(&member.token),
        Some(description("run-l", "wfl")),
    )
    .await;
    assert_eq!(status, 200);
    let run_id: String =
        sqlx::query_scalar("SELECT _id FROM webknossos.voxelytics_runs WHERE name = 'run-l'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let logs = format!("/api/voxelytics/logs?runId={run_id}&startTimestamp=0&endTimestamp=10000");

    // Unconfigured Loki: empty pushes succeed, everything else fails as in Play.
    let disabled = app(&db, MiscConfig::default(), VoxelyticsConfig::default());
    let (status, body) = call(&disabled, Method::GET, &logs, Some(&member.token), None).await;
    assert_eq!((status, error(&body)), (400, NOT_ENABLED));
    let (status, _) = call(
        &enabled,
        Method::POST,
        "/api/voxelytics/logs",
        Some(&member.token),
        Some(json!([])),
    )
    .await;
    assert_eq!(status, 200);
    let (status, body) = call(
        &enabled,
        Method::POST,
        "/api/voxelytics/logs",
        Some(&member.token),
        Some(json!([log_entry(1, "m")])),
    )
    .await;
    assert_eq!((status, error(&body)), (400, "Loki is not enabled."));
    let (status, body) = call(&enabled, Method::GET, &logs, Some(&member.token), None).await;
    assert_eq!((status, error(&body)), (400, "Loki is not enabled."));
    let (status, body) = call(
        &enabled,
        Method::GET,
        &format!("{logs}&limit=0"),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!((status, body), (200, json!([])));

    let loki = Loki::default();
    let mock = Router::new()
        .route("/ready", get(loki_ready))
        .route("/loki/api/v1/push", post(loki_push))
        .route("/loki/api/v1/query_range", get(loki_query))
        .with_state(loki.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    let app = app(
        &db,
        enabled_misc(),
        VoxelyticsConfig {
            loki: LokiConfig {
                uri: base,
                tenant: "tenant-1".into(),
                user: "loki-user".into(),
                password: "loki-password".into(),
                startup_timeout: std::time::Duration::from_secs(10),
            },
            ..Default::default()
        },
    );

    // appendLogs: waits for /ready, groups streams by (workflow, run, pid).
    let (status, body) = call(
        &app,
        Method::POST,
        "/api/voxelytics/logs",
        Some(&member.token),
        Some(json!([
            log_entry(1, "a"),
            log_entry(2, "b"),
            log_entry(1, "c")
        ])),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(*loki.ready_calls.lock().unwrap(), 2);
    {
        let pushes = loki.pushes.lock().unwrap();
        let (headers, push) = &pushes[0];
        assert_eq!(headers["x-scope-orgid"], "tenant-1");
        assert!(
            headers["authorization"]
                .to_str()
                .unwrap()
                .starts_with("Basic ")
        );
        let streams = push["streams"].as_array().unwrap();
        assert_eq!(streams.len(), 2);
        assert_eq!(
            streams[0]["stream"],
            json!({"vx_workflow_hash": "wfl", "vx_run_name": "run-l", "pid": "1",
                   "wk_url": "http://localhost:9000", "wk_org": admin.organization_id})
        );
        let values = streams[0]["values"].as_array().unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values[0][0], "1704067201250000000");
        let line: Value = serde_json::from_str(values[0][1].as_str().unwrap()).unwrap();
        assert_eq!(line["message"], "a");
        assert_eq!(line["pid"], "1");
        assert_eq!(line["line"], "12");
        assert_eq!(line["pgid"], "9");
        assert_eq!(line["vx_version"], "1.0");
    }
    let (status, _) = call(
        &app,
        Method::POST,
        "/api/voxelytics/logs",
        Some(&member.token),
        Some(json!([{"level": "INFO"}])),
    )
    .await;
    assert_eq!(status, 400);

    // getLogs: limited query walks backwards, result ascending.
    let (status, body) = call(
        &app,
        Method::GET,
        &format!("{logs}&limit=2&minLevel=WARNING&taskName=t"),
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let timestamps: Vec<i64> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["timestamp"].as_i64().unwrap())
        .collect();
    assert_eq!(timestamps, vec![2000, 3000]);
    assert_eq!(body[0]["message"], "at 2000");
    assert_eq!(body[0]["vx_run_name"], "run-l");
    {
        let queries = loki.queries.lock().unwrap();
        assert_eq!(queries.len(), 1);
        let query = &queries[0];
        let get = |k: &str| query.iter().find(|(key, _)| key == k).unwrap().1.clone();
        assert_eq!(
            get("query"),
            format!(
                r#"{{vx_run_name="run-l",wk_org=~"{}",wk_url="http://localhost:9000"}} | json vx_task_name,level | vx_task_name="t" | level=~"(WARNING|ERROR|CRITICAL)""#,
                admin.organization_id
            )
        );
        assert_eq!(get("start"), "1970-01-01T00:00:00Z");
        assert_eq!(get("end"), "1970-01-01T00:00:10Z");
        assert_eq!(get("limit"), "2");
        assert_eq!(get("direction"), "backward");
    }
    // Without a limit, batches continue until an empty batch at the start.
    let (status, body) = call(&app, Method::GET, &logs, Some(&member.token), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body.as_array().unwrap().len(), 3);
    assert_eq!(loki.queries.lock().unwrap().len(), 3);

    // Runs are looked up within the user's organization only.
    let (status, _) = call(&app, Method::GET, &logs, Some(&foreign.token), None).await;
    assert_eq!(status, 404);
    let (status, _) = call(
        &app,
        Method::GET,
        &format!("/api/voxelytics/logs?runId={run_id}&startTimestamp=0"),
        Some(&member.token),
        None,
    )
    .await;
    assert_eq!(status, 400);
    server.abort();
    db.cleanup().await;
}
