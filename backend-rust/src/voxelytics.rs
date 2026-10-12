//! VoxelyticsController: workflow reports, workflow events and logs.
//!
//! All routes require authentication and `features.voxelyticsEnabled`
//! (400 otherwise). Reads are scoped to the user's organization; non-admin,
//! non-dataset-manager users list only their own runs, but may open any run
//! report of their organization (Play's `allowUnlisted`).
use std::{collections::HashMap, time::Duration};

use axum::{
    Extension, Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    application_info::MiscState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::ObjectId,
    voxelytics_dao::{self as dao, ArtifactValues, NewRun, Timestamp},
    voxelytics_loki::{LOG_LEVELS, LokiClient},
};

pub use crate::voxelytics_loki::LokiConfig;

const NOT_ENABLED: &str =
    "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance.";
const NO_TASK_FOUND: &str = "No voxelytics tasks found.";
const NO_WORKFLOW_FOUND: &str = "No voxelytics workflows found.";
const RUN_NOT_FOUND: &str = "Voxelytics workflow runs not found.";
const WORKFLOW_NOT_FOUND: &str = "Voxelytics workflow not found.";
const WORKFLOW_USER_MISMATCH: &str = "Voxelytics workflow run already exists by another user.";
const SUPER_USER_ONLY: &str = "This feature is currently only available for superusers.";
/// Msg.notFound: Play's response for an empty Fox.
const NOT_FOUND: &str = "Could not find or access the requested resource.";

const WORKFLOW_EVENT_INSERT_BATCH_SIZE: usize = 500;

/// VoxelyticsRunState names.
const RUN_STATES: [&str; 7] = [
    "SKIPPED",
    "PENDING",
    "RUNNING",
    "COMPLETE",
    "FAILED",
    "CANCELLED",
    "STALE",
];

/// `voxelytics.*` settings. The feature flag itself is `features.voxelyticsEnabled`.
#[derive(Clone, Debug)]
pub struct VoxelyticsConfig {
    pub stale_timeout: Duration,
    pub loki: LokiConfig,
}

impl Default for VoxelyticsConfig {
    fn default() -> Self {
        Self {
            stale_timeout: Duration::from_secs(20 * 60),
            loki: LokiConfig::default(),
        }
    }
}

#[derive(Clone)]
struct Voxelytics {
    stale_timeout: Duration,
    loki: LokiClient,
}

pub fn router(config: VoxelyticsConfig) -> Router<AppState> {
    let state = Voxelytics {
        stale_timeout: config.stale_timeout,
        loki: LokiClient::new(config.loki),
    };
    Router::new()
        .route(
            "/voxelytics/workflows",
            post(store_workflow).get(list_workflows),
        )
        .route(
            "/voxelytics/workflows/{workflow_hash}",
            get(get_workflow).delete(delete_workflow),
        )
        .route(
            "/voxelytics/workflows/{workflow_hash}/events",
            post(store_workflow_events),
        )
        .route(
            "/voxelytics/workflows/{workflow_hash}/chunkStatistics",
            get(chunk_statistics),
        )
        .route(
            "/voxelytics/workflows/{workflow_hash}/artifactChecksums",
            get(artifact_checksums),
        )
        .route("/voxelytics/logs", post(append_logs).get(get_logs))
        .layer(Extension(state))
}

fn ensure_enabled(misc: &MiscState) -> ApiResult<()> {
    if misc.config().features.get("voxelyticsEnabled") == Some(&Value::Bool(true)) {
        Ok(())
    } else {
        Err(ApiError::bad_request(NOT_ENABLED))
    }
}

fn ok_empty() -> Response {
    StatusCode::OK.into_response()
}

fn millis(time: &Timestamp) -> Value {
    time.map_or(Value::Null, |t| json!(t.timestamp_millis()))
}

/// Json.format of a case class omits `None` fields.
fn insert_opt(object: &mut Map<String, Value>, key: &str, value: Value) {
    if !value.is_null() {
        object.insert(key.into(), value);
    }
}

/// Parse the JSON body ourselves so that malformed bodies answer like Play's
/// validateJson (400) and the 2 MiB default limit still applies.
fn parse_body<T: serde::de::DeserializeOwned>(body: &[u8]) -> ApiResult<T> {
    serde_json::from_slice(body).map_err(|_| ApiError::bad_request("Invalid JSON request body."))
}

// ---------------------------------------------------------------------------
// Request models (WorkflowDescription, WorkflowEvents)

/// Scala's Instant reads: an integral number (epoch milliseconds) or a string
/// that is an ISO instant or epoch milliseconds.
fn parse_instant(value: &Value) -> Option<DateTime<Utc>> {
    let millis = match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() < 9.2e18)
                .map(|f| f as i64)
        }),
        Value::String(text) => DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|t| t.timestamp_millis())
            .or_else(|| text.parse().ok()),
        _ => None,
    }?;
    DateTime::from_timestamp_millis(millis)
}

fn instant<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<DateTime<Utc>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    parse_instant(&value).ok_or_else(|| serde::de::Error::custom("Invalid timestamp."))
}

fn run_state<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if RUN_STATES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(serde::de::Error::custom("Invalid voxelytics run state."))
    }
}

#[derive(Deserialize)]
struct TaskConfig {
    config: Value,
    inputs: Value,
    description: Option<String>,
    distribution: Value,
    output_paths: Value,
    task: String,
}

#[derive(Deserialize)]
struct DescriptionConfig {
    global_parameters: Map<String, Value>,
    paths: Vec<String>,
    schema_version: Option<i64>,
    #[allow(dead_code)]
    git_hash: Option<String>,
    tasks: ordered::OrderedMap<TaskConfig>,
}

#[derive(Deserialize, Clone)]
struct Artifact {
    path: String,
    file_size: i64,
    inode_count: i64,
    version: String,
    attributes: Value,
    iframes: Value,
    links: Value,
}

impl Artifact {
    fn metadata(&self) -> Value {
        json!({"attributes": self.attributes, "iframes": self.iframes, "links": self.links})
    }

    fn values(&self) -> ArtifactValues<'_> {
        ArtifactValues {
            path: &self.path,
            file_size: self.file_size,
            inode_count: self.inode_count,
            version: &self.version,
            metadata: self.metadata(),
        }
    }
}

#[derive(Deserialize)]
struct DescriptionRun {
    name: String,
    user: String,
    hostname: String,
    #[serde(rename = "voxelyticsVersion")]
    voxelytics_version: String,
}

#[derive(Deserialize)]
struct DescriptionWorkflow {
    name: String,
    hash: String,
    #[serde(rename = "yamlContent")]
    yaml_content: Option<String>,
}

#[derive(Deserialize)]
struct WorkflowDescription {
    config: DescriptionConfig,
    artifacts: HashMap<String, ordered::OrderedMap<Artifact>>,
    run: DescriptionRun,
    workflow: DescriptionWorkflow,
}

/// A JSON object kept in document order (Map would sort the keys).
mod ordered {
    use serde::{Deserialize, Deserializer, de::DeserializeOwned};

    pub struct OrderedMap<T>(pub Vec<(String, T)>);

    impl<'de, T: DeserializeOwned> Deserialize<'de> for OrderedMap<T> {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct Visitor<T>(std::marker::PhantomData<T>);
            impl<'de, T: DeserializeOwned> serde::de::Visitor<'de> for Visitor<T> {
                type Value = OrderedMap<T>;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                    f.write_str("a JSON object")
                }
                fn visit_map<A: serde::de::MapAccess<'de>>(
                    self,
                    mut map: A,
                ) -> Result<Self::Value, A::Error> {
                    let mut entries: Vec<(String, T)> = Vec::new();
                    while let Some((key, value)) = map.next_entry::<String, T>()? {
                        // Later duplicates win, as in Play's JsObject.
                        entries.retain(|(k, _)| *k != key);
                        entries.push((key, value));
                    }
                    Ok(OrderedMap(entries))
                }
            }
            deserializer.deserialize_map(Visitor(std::marker::PhantomData))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunStateChangeEvent {
    #[serde(deserialize_with = "run_state")]
    state: String,
    #[serde(deserialize_with = "instant")]
    timestamp: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskStateChangeEvent {
    task_name: String,
    #[serde(deserialize_with = "run_state")]
    state: String,
    #[serde(deserialize_with = "instant")]
    timestamp: DateTime<Utc>,
    artifacts: ordered::OrderedMap<Artifact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkStateChangeEvent {
    task_name: String,
    execution_id: String,
    chunk_name: String,
    #[serde(deserialize_with = "instant")]
    timestamp: DateTime<Utc>,
    #[serde(deserialize_with = "run_state")]
    state: String,
}

#[derive(Deserialize)]
struct RunHeartbeatEvent {
    #[serde(deserialize_with = "instant")]
    timestamp: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkProfilingEvent {
    task_name: String,
    execution_id: String,
    chunk_name: String,
    hostname: String,
    pid: i64,
    memory: f64,
    cpu_user: f64,
    cpu_system: f64,
    #[serde(deserialize_with = "instant")]
    timestamp: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactFileChecksumEvent {
    task_name: String,
    artifact_name: String,
    path: String,
    resolved_path: String,
    checksum_method: String,
    checksum: String,
    file_size: i64,
    #[serde(deserialize_with = "instant")]
    last_modified: DateTime<Utc>,
    #[serde(deserialize_with = "instant")]
    timestamp: DateTime<Utc>,
}

/// Events grouped by type, in declaration order so that dependent upserts
/// (chunk profiling after chunk states, checksums after artifacts) see
/// the rows created by the same request. Play grouped by class in hash order.
#[derive(Default)]
struct GroupedEvents {
    run_states: Vec<RunStateChangeEvent>,
    task_states: Vec<TaskStateChangeEvent>,
    chunk_states: Vec<ChunkStateChangeEvent>,
    heartbeats: Vec<RunHeartbeatEvent>,
    profiling: Vec<ChunkProfilingEvent>,
    checksums: Vec<ArtifactFileChecksumEvent>,
}

fn parse_events(values: Vec<Value>) -> ApiResult<GroupedEvents> {
    fn event<T: serde::de::DeserializeOwned>(value: Value) -> ApiResult<T> {
        serde_json::from_value(value)
            .map_err(|_| ApiError::bad_request("Invalid voxelytics workflow event."))
    }
    let mut grouped = GroupedEvents::default();
    for value in values {
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::bad_request("Invalid voxelytics workflow event."))?
            .to_owned();
        match kind.as_str() {
            "RUN_STATE_CHANGE" => grouped.run_states.push(event(value)?),
            "TASK_STATE_CHANGE" => grouped.task_states.push(event(value)?),
            "CHUNK_STATE_CHANGE" => grouped.chunk_states.push(event(value)?),
            "RUN_HEARTBEAT" => grouped.heartbeats.push(event(value)?),
            "CHUNK_PROFILING" => grouped.profiling.push(event(value)?),
            "ARTIFACT_FILE_CHECKSUM" => grouped.checksums.push(event(value)?),
            _ => {
                return Err(ApiError::bad_request("Invalid voxelytics workflow event."));
            }
        }
    }
    Ok(grouped)
}

fn iso(time: DateTime<Utc>) -> Value {
    json!(time.to_rfc3339_opts(SecondsFormat::Millis, true))
}

/// RUNNING events set beginTime; COMPLETE, CANCELLED and FAILED set endTime.
fn state_times(state: &str, timestamp: DateTime<Utc>) -> (Value, Value) {
    let begin = if state == "RUNNING" {
        iso(timestamp)
    } else {
        Value::Null
    };
    let end = if matches!(state, "COMPLETE" | "CANCELLED" | "FAILED") {
        iso(timestamp)
    } else {
        Value::Null
    };
    (begin, end)
}

// ---------------------------------------------------------------------------
// Handlers

/// POST /voxelytics/workflows: upsert workflow, run, tasks and artifacts.
async fn store_workflow(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let description: WorkflowDescription = parse_body(&body)?;
    ensure_enabled(&misc)?;
    let mut tx = state.pool.begin().await?;
    // Deviation: Play discarded this check's result (any member of the
    // organization could take over a run); the intended check is enforced.
    let owner =
        dao::user_id_for_run_name(&mut tx, &description.run.name, &user.organization_id).await?;
    if !(user.is_admin || owner.is_none_or(|owner| owner == user.id)) {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            WORKFLOW_USER_MISMATCH,
        ));
    }
    dao::upsert_workflow(
        &mut tx,
        &description.workflow.hash,
        &description.workflow.name,
        &user.organization_id,
    )
    .await?;
    let config = &description.config;
    // WorkflowDescriptionConfig.asJsonWithoutTasks (git_hash is dropped).
    let workflow_config = json!({
        "global_parameters": config.global_parameters,
        "paths": config.paths,
        "schema_version": config.schema_version,
    });
    let run_id = dao::upsert_run(
        &mut tx,
        NewRun {
            organization_id: &user.organization_id,
            user_id: &user.id,
            name: &description.run.name,
            username: &description.run.user,
            hostname: &description.run.hostname,
            voxelytics_version: &description.run.voxelytics_version,
            workflow_hash: &description.workflow.hash,
            workflow_yaml_content: description.workflow.yaml_content.as_deref(),
            workflow_config: &workflow_config,
        },
    )
    .await?;
    for (task_name, task) in &config.tasks.0 {
        let task_config = json!({
            "config": task.config,
            "description": task.description,
            "distribution": task.distribution,
            "inputs": task.inputs,
            "output_paths": task.output_paths,
        });
        let task_id =
            dao::upsert_task(&mut tx, &run_id, task_name, &task.task, &task_config).await?;
        if let Some(artifacts) = description.artifacts.get(task_name) {
            for (artifact_name, artifact) in &artifacts.0 {
                dao::upsert_artifact(&mut tx, &task_id, artifact_name, &artifact.values()).await?;
            }
        }
    }
    tx.commit().await?;
    Ok(ok_empty())
}

/// GET /voxelytics/workflows: workflows with the user's listed runs.
async fn list_workflows(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(vx): Extension<Voxelytics>,
    user: AuthUser,
) -> ApiResult<Response> {
    ensure_enabled(&misc)?;
    let runs = dao::find_runs_for_workflow_listing(&state.pool, &user, vx.stale_timeout).await?;
    if runs.is_empty() {
        return Ok(Json(json!([])).into_response());
    }
    let mut hashes: Vec<String> = runs.iter().map(|r| r.workflow_hash.clone()).collect();
    hashes.sort();
    hashes.dedup();
    let task_counts: HashMap<String, dao::TaskCounts> =
        dao::find_workflow_task_counts(&state.pool, &user, &hashes, vx.stale_timeout)
            .await?
            .into_iter()
            .collect();
    if task_counts.is_empty() {
        return Err(ApiError::not_found(NO_TASK_FOUND));
    }
    let workflows =
        dao::find_workflows_by_hash_and_organization(&state.pool, &user.organization_id, &hashes)
            .await?;
    if workflows.is_empty() {
        return Err(ApiError::not_found(NO_WORKFLOW_FOUND));
    }
    let result: Vec<Value> = workflows
        .iter()
        .filter_map(|workflow| {
            let workflow_runs: Vec<&dao::WorkflowListingRunEntry> = runs
                .iter()
                .filter(|run| run.workflow_hash == workflow.hash)
                .collect();
            // maxBy: the first run with the greatest beginTime (None < Some).
            let mut latest = *workflow_runs.first()?;
            for run in &workflow_runs[1..] {
                if run.begin_time > latest.begin_time {
                    latest = run;
                }
            }
            let begin_time = workflow_runs.iter().map(|r| r.begin_time).min().flatten();
            let end_time = workflow_runs.iter().filter_map(|r| r.end_time).max();
            Some(json!({
                "name": workflow.name,
                "hash": workflow.hash,
                "beginTime": millis(&begin_time),
                "endTime": millis(&end_time),
                "state": latest.state,
                "taskCounts": task_counts.get(&workflow.hash).map(dao::TaskCounts::to_json),
                "runs": workflow_runs.iter().map(|run| listing_run_json(run)).collect::<Vec<_>>(),
            }))
        })
        .collect();
    Ok(Json(Value::Array(result)).into_response())
}

fn listing_run_json(run: &dao::WorkflowListingRunEntry) -> Value {
    let mut object = Map::new();
    object.insert("id".into(), json!(run.id));
    object.insert("name".into(), json!(run.name));
    object.insert("hostUserName".into(), json!(run.host_user_name));
    object.insert("hostName".into(), json!(run.host_name));
    object.insert("voxelyticsVersion".into(), json!(run.voxelytics_version));
    object.insert("workflowHash".into(), json!(run.workflow_hash));
    object.insert("state".into(), json!(run.state));
    insert_opt(&mut object, "beginTime", millis(&run.begin_time));
    insert_opt(&mut object, "endTime", millis(&run.end_time));
    object.insert("taskCounts".into(), run.task_counts.to_json());
    insert_opt(&mut object, "userFirstName", json!(run.user_first_name));
    insert_opt(&mut object, "userLastName", json!(run.user_last_name));
    Value::Object(object)
}

fn run_json(run: &dao::RunEntry) -> Value {
    let mut object = Map::new();
    object.insert("id".into(), json!(run.id));
    object.insert("name".into(), json!(run.name));
    object.insert("hostUserName".into(), json!(run.host_user_name));
    object.insert("hostName".into(), json!(run.host_name));
    object.insert("voxelyticsVersion".into(), json!(run.voxelytics_version));
    object.insert("workflowHash".into(), json!(run.workflow_hash));
    object.insert(
        "workflowYamlContent".into(),
        json!(run.workflow_yaml_content),
    );
    object.insert("workflowConfig".into(), run.workflow_config.clone());
    object.insert("state".into(), json!(run.state));
    insert_opt(&mut object, "beginTime", millis(&run.begin_time));
    insert_opt(&mut object, "endTime", millis(&run.end_time));
    Value::Object(object)
}

fn artifact_json(artifact: &dao::ArtifactEntry) -> Value {
    let mut object = Map::new();
    object.insert("artifactId".into(), json!(artifact.artifact_id));
    object.insert("taskId".into(), json!(artifact.task_id));
    object.insert("name".into(), json!(artifact.name));
    object.insert("path".into(), json!(artifact.path));
    object.insert("fileSize".into(), json!(artifact.file_size));
    object.insert("inodeCount".into(), json!(artifact.inode_count));
    object.insert("version".into(), json!(artifact.version));
    object.insert("metadata".into(), artifact.metadata.clone());
    object.insert("taskName".into(), json!(artifact.task_name));
    if let Some((hash, run)) = &artifact.foreign_workflow {
        object.insert("foreignWorkflow".into(), json!([hash, run]));
    }
    Value::Object(object)
}

/// VoxelyticsService.taskRunsPublicWrites.
fn task_runs_json(
    combined: &[dao::CombinedTaskRunEntry],
    task_runs: &[dao::TaskRunEntry],
) -> Value {
    let mut groups: Vec<(&str, Vec<&dao::TaskRunEntry>)> = Vec::new();
    for task_run in task_runs {
        match groups
            .iter_mut()
            .find(|(name, _)| *name == task_run.task_name)
        {
            Some((_, runs)) => runs.push(task_run),
            None => groups.push((&task_run.task_name, vec![task_run])),
        }
    }
    let tasks = groups
        .into_iter()
        .map(|(task_name, mut runs)| {
            // sortBy(beginTime).reverse: newest first, missing beginTime last.
            runs.sort_by_key(|run| run.begin_time);
            runs.reverse();
            let combined_run = combined.iter().find(|c| c.task_name == task_name);
            let state = runs
                .iter()
                .map(|run| run.state.as_str())
                .find(|s| *s != "SKIPPED" && *s != "PENDING")
                .or_else(|| runs.first().map(|run| run.state.as_str()))
                .unwrap_or("SKIPPED");
            let chunk_counts = combined_run.map_or_else(
                || json!({"total": 0, "failed": 0, "skipped": 0, "complete": 0, "cancelled": 0}),
                |c| c.chunk_counts.to_json(),
            );
            json!({
                "taskName": task_name,
                "state": state,
                "beginTime": millis(&runs.iter().filter_map(|r| r.begin_time).min()),
                "endTime": millis(&runs.iter().filter_map(|r| r.end_time).max()),
                "currentExecutionId": combined_run.and_then(|c| c.current_execution_id.clone()),
                "chunkCounts": chunk_counts,
                "runs": runs.iter().map(|run| json!({
                    "runId": run.run_id,
                    "state": run.state,
                    "beginTime": millis(&run.begin_time),
                    "endTime": millis(&run.end_time),
                    "currentExecutionId": run.current_execution_id,
                    "chunkCounts": run.chunk_counts.to_json(),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    Value::Array(tasks)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunQuery {
    run_id: Option<String>,
}

fn optional_run_id(run_id: Option<&str>) -> ApiResult<Option<String>> {
    run_id
        .map(|id| ObjectId::parse(id).map(String::from))
        .transpose()
}

/// GET /voxelytics/workflows/:workflowHash?runId=: the workflow report.
async fn get_workflow(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(vx): Extension<Voxelytics>,
    user: AuthUser,
    Path(workflow_hash): Path<String>,
    Query(query): Query<RunQuery>,
) -> ApiResult<Response> {
    let run_id = optional_run_id(query.run_id.as_deref())?;
    ensure_enabled(&misc)?;
    let pool = &state.pool;
    let workflow =
        dao::find_workflow_by_hash_and_organization(pool, &user.organization_id, &workflow_hash)
            .await?
            .ok_or_else(|| ApiError::not_found(WORKFLOW_NOT_FOUND))?;
    let mut runs = dao::find_runs(
        pool,
        &user,
        None,
        Some(&workflow_hash),
        vx.stale_timeout,
        true,
    )
    .await?;
    if runs.is_empty() {
        return Err(ApiError::not_found(RUN_NOT_FOUND));
    }
    runs.sort_by_key(|run| run.begin_time);
    runs.reverse();
    let selected = match &run_id {
        Some(run_id) => runs
            .iter()
            .find(|run| &run.id == run_id)
            .ok_or_else(|| ApiError::not_found(RUN_NOT_FOUND))?,
        None => &runs[0],
    };
    let run_ids: Vec<String> = runs.iter().map(|run| run.id.clone()).collect();
    let task_runs = dao::find_task_runs(pool, &run_ids, vx.stale_timeout).await?;
    let combined = dao::find_combined_task_runs(pool, &run_ids, vx.stale_timeout).await?;
    let artifacts = dao::find_artifacts(pool, &user, &run_ids, vx.stale_timeout).await?;
    let tasks = dao::find_tasks(pool, &selected.id).await?;

    // workflowConfigPublicWrites: the run's config plus each task's config and name.
    let mut config = match selected.workflow_config.clone() {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    let mut task_configs = Map::new();
    for task in tasks {
        let mut task_config = match task.config {
            Value::Object(object) => object,
            _ => Map::new(),
        };
        task_config.insert("task".into(), json!(task.task));
        task_configs.insert(task.name, Value::Object(task_config));
    }
    config.insert("tasks".into(), Value::Object(task_configs));

    // artifactsPublicWrites: {taskName: {artifactName: artifact}}.
    let mut artifacts_json = Map::new();
    for artifact in &artifacts {
        let entry = artifacts_json
            .entry(artifact.task_name.clone())
            .or_insert_with(|| json!({}));
        entry[&artifact.name] = artifact_json(artifact);
    }

    Ok(Json(json!({
        "config": config,
        "artifacts": artifacts_json,
        "runs": runs.iter().map(run_json).collect::<Vec<_>>(),
        "tasks": task_runs_json(&combined, &task_runs),
        "workflow": {
            "name": workflow.name,
            "hash": workflow_hash,
            "yamlContent": selected.workflow_yaml_content,
        },
    }))
    .into_response())
}

/// DELETE /voxelytics/workflows/:workflowHash (superusers only).
async fn delete_workflow(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    Path(workflow_hash): Path<String>,
) -> ApiResult<Response> {
    ensure_enabled(&misc)?;
    if !user.is_superuser {
        return Err(ApiError::bad_request(SUPER_USER_ONLY));
    }
    if !dao::workflow_hash_exists(&state.pool, &workflow_hash).await? {
        return Err(ApiError::not_found(WORKFLOW_NOT_FOUND));
    }
    tracing::info!(
        organization = %user.organization_id,
        "Deleting voxelytics workflow"
    );
    let mut tx = state.pool.begin().await?;
    dao::delete_workflow(&mut tx, &workflow_hash, &user.organization_id).await?;
    tx.commit().await?;
    Ok(ok_empty())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsQuery {
    run_name: Option<String>,
}

/// POST /voxelytics/workflows/:workflowHash/events?runName=
async fn store_workflow_events(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
    Path(workflow_hash): Path<String>,
    Query(query): Query<EventsQuery>,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let run_name = query
        .run_name
        .ok_or_else(|| ApiError::bad_request("Missing parameter: runName"))?;
    let events = parse_events(parse_body(&body)?)?;
    ensure_enabled(&misc)?;
    let run_id =
        dao::run_id_by_name_and_workflow_hash(&state.pool, &run_name, &workflow_hash, &user)
            .await?
            .ok_or_else(|| ApiError::not_found(RUN_NOT_FOUND))?;
    // Play answers 500 for any failure while storing events.
    store_events(&state.pool, &run_id, events)
        .await
        .map_err(|error| {
            if error.status.is_server_error() {
                error
            } else {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.message)
            }
        })?;
    Ok(ok_empty())
}

/// All event groups are stored in one transaction, in batches of 500 per type.
async fn store_events(pool: &sqlx::PgPool, run_id: &str, events: GroupedEvents) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    let batch = WORKFLOW_EVENT_INSERT_BATCH_SIZE;
    for chunk in events.run_states.chunks(batch) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|ev| {
                let (begin, end) = state_times(&ev.state, ev.timestamp);
                json!({"begin_time": begin, "end_time": end, "state": ev.state})
            })
            .collect();
        dao::update_run_states(&mut tx, run_id, &rows).await?;
    }
    for chunk in events.task_states.chunks(batch) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|ev| {
                let (begin, end) = state_times(&ev.state, ev.timestamp);
                json!({"task_name": ev.task_name, "begin_time": begin, "end_time": end, "state": ev.state})
            })
            .collect();
        dao::update_task_states(&mut tx, run_id, &rows).await?;
        let artifacts: Vec<Value> = chunk
            .iter()
            .flat_map(|ev| {
                ev.artifacts.0.iter().map(|(name, artifact)| {
                    json!({
                        "task_name": ev.task_name,
                        "artifact_name": name,
                        "path": artifact.path,
                        "file_size": artifact.file_size,
                        "inode_count": artifact.inode_count,
                        "version": artifact.version,
                        "metadata": artifact.metadata(),
                    })
                })
            })
            .collect();
        if !artifacts.is_empty() {
            dao::upsert_artifacts(&mut tx, run_id, &artifacts).await?;
        }
    }
    for chunk in events.chunk_states.chunks(batch) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|ev| {
                let (begin, end) = state_times(&ev.state, ev.timestamp);
                json!({
                    "task_name": ev.task_name,
                    "execution_id": ev.execution_id,
                    "chunk_name": ev.chunk_name,
                    "begin_time": begin,
                    "end_time": end,
                    "state": ev.state,
                })
            })
            .collect();
        dao::upsert_chunk_states(&mut tx, run_id, &rows).await?;
    }
    for chunk in events.heartbeats.chunks(batch) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|ev| json!({"timestamp": iso(ev.timestamp)}))
            .collect();
        dao::upsert_run_heartbeats(&mut tx, run_id, &rows).await?;
    }
    for chunk in events.profiling.chunks(batch) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|ev| {
                json!({
                    "task_name": ev.task_name,
                    "execution_id": ev.execution_id,
                    "chunk_name": ev.chunk_name,
                    "hostname": ev.hostname,
                    "pid": ev.pid,
                    "memory": ev.memory,
                    "cpu_user": ev.cpu_user,
                    "cpu_system": ev.cpu_system,
                    "timestamp": iso(ev.timestamp),
                })
            })
            .collect();
        dao::upsert_chunk_profiling(&mut tx, run_id, &rows).await?;
    }
    for chunk in events.checksums.chunks(batch) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|ev| {
                json!({
                    "task_name": ev.task_name,
                    "artifact_name": ev.artifact_name,
                    "path": ev.path,
                    "resolved_path": ev.resolved_path,
                    "checksum_method": ev.checksum_method,
                    "checksum": ev.checksum,
                    "file_size": ev.file_size,
                    "last_modified": iso(ev.last_modified),
                    "timestamp": iso(ev.timestamp),
                })
            })
            .collect();
        dao::upsert_artifact_checksums(&mut tx, run_id, &rows).await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatisticsQuery {
    run_id: Option<String>,
    task_name: Option<String>,
    artifact_name: Option<String>,
}

/// findRuns for the statistics routes: the requested run or all runs of the
/// workflow (any run of the organization; 404 if none).
async fn statistics_runs(
    pool: &sqlx::PgPool,
    user: &AuthUser,
    workflow_hash: &str,
    run_id: Option<String>,
    stale_timeout: Duration,
) -> ApiResult<Vec<String>> {
    let run_ids = run_id.map(|id| vec![id]);
    let runs = dao::find_runs(
        pool,
        user,
        run_ids.as_deref(),
        Some(workflow_hash),
        stale_timeout,
        true,
    )
    .await?;
    if runs.is_empty() {
        return Err(ApiError::not_found(RUN_NOT_FOUND));
    }
    Ok(runs.into_iter().map(|run| run.id).collect())
}

fn required_task_name(query: &StatisticsQuery) -> ApiResult<&str> {
    query
        .task_name
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("Missing parameter: taskName"))
}

fn statistics_json(entry: &dao::StatisticsEntry) -> Value {
    let mut value = json!({"max": entry.max, "median": entry.median, "stddev": entry.stddev});
    if let Some(sum) = entry.sum {
        value["sum"] = json!(sum);
    }
    value
}

/// GET /voxelytics/workflows/:workflowHash/chunkStatistics?runId=&taskName=
async fn chunk_statistics(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(vx): Extension<Voxelytics>,
    user: AuthUser,
    Path(workflow_hash): Path<String>,
    Query(query): Query<StatisticsQuery>,
) -> ApiResult<Response> {
    let run_id = optional_run_id(query.run_id.as_deref())?;
    let task_name = required_task_name(&query)?;
    ensure_enabled(&misc)?;
    let run_ids =
        statistics_runs(&state.pool, &user, &workflow_hash, run_id, vx.stale_timeout).await?;
    let entries = dao::chunk_statistics(&state.pool, &run_ids, task_name, vx.stale_timeout).await?;
    let result: Vec<Value> = entries
        .iter()
        .map(|entry| {
            let mut object = Map::new();
            object.insert("executionId".into(), json!(entry.execution_id));
            object.insert("chunkCounts".into(), entry.chunk_counts.to_json());
            insert_opt(&mut object, "beginTime", millis(&entry.begin_time));
            insert_opt(&mut object, "endTime", millis(&entry.end_time));
            object.insert("wallTime".into(), json!(entry.wall_time));
            object.insert("memory".into(), statistics_json(&entry.memory));
            object.insert("cpuUser".into(), statistics_json(&entry.cpu_user));
            object.insert("cpuSystem".into(), statistics_json(&entry.cpu_system));
            object.insert("duration".into(), statistics_json(&entry.duration));
            Value::Object(object)
        })
        .collect();
    Ok(Json(Value::Array(result)).into_response())
}

/// GET /voxelytics/workflows/:workflowHash/artifactChecksums?runId=&taskName=&artifactName=
async fn artifact_checksums(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(vx): Extension<Voxelytics>,
    user: AuthUser,
    Path(workflow_hash): Path<String>,
    Query(query): Query<StatisticsQuery>,
) -> ApiResult<Response> {
    let run_id = optional_run_id(query.run_id.as_deref())?;
    let task_name = required_task_name(&query)?;
    ensure_enabled(&misc)?;
    let run_ids =
        statistics_runs(&state.pool, &user, &workflow_hash, run_id, vx.stale_timeout).await?;
    // Deviation: without artifactName Play generated invalid SQL (`WHERE ORDER BY`);
    // here all artifacts of the task are returned.
    let entries = dao::artifact_checksums(
        &state.pool,
        &run_ids,
        task_name,
        query.artifact_name.as_deref(),
        vx.stale_timeout,
    )
    .await?;
    let result: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({
                "taskName": entry.task_name,
                "artifactName": entry.artifact_name,
                "path": entry.path,
                "resolvedPath": entry.resolved_path,
                "timestamp": entry.timestamp.timestamp_millis(),
                "checksumMethod": entry.checksum_method,
                "checksum": entry.checksum,
                "fileSize": entry.file_size,
                "lastModified": entry.last_modified.timestamp_millis(),
            })
        })
        .collect();
    Ok(Json(Value::Array(result)).into_response())
}

/// POST /voxelytics/logs: forward log entries to Loki.
async fn append_logs(
    Extension(misc): Extension<MiscState>,
    Extension(vx): Extension<Voxelytics>,
    user: AuthUser,
    body: axum::body::Bytes,
) -> ApiResult<Response> {
    let entries: Vec<Map<String, Value>> = parse_body(&body)?;
    ensure_enabled(&misc)?;
    vx.loki
        .bulk_insert_batched(&misc.config().public_uri, &entries, &user.organization_id)
        .await?;
    Ok(ok_empty())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogsQuery {
    run_id: Option<String>,
    task_name: Option<String>,
    min_level: Option<String>,
    start_timestamp: Option<String>,
    end_timestamp: Option<String>,
    limit: Option<String>,
}

fn required_param<'a>(value: &'a Option<String>, name: &str) -> ApiResult<&'a str> {
    value
        .as_deref()
        .ok_or_else(|| ApiError::bad_request(format!("Missing parameter: {name}")))
}

/// GET /voxelytics/logs?runId=&taskName=&minLevel=&startTimestamp=&endTimestamp=&limit=
async fn get_logs(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(vx): Extension<Voxelytics>,
    user: AuthUser,
    Query(query): Query<LogsQuery>,
) -> ApiResult<Response> {
    let run_id = ObjectId::parse(required_param(&query.run_id, "runId")?)?;
    let parse_long = |value: &str, name: &str| -> ApiResult<i64> {
        value
            .parse()
            .map_err(|_| ApiError::bad_request(format!("Invalid parameter: {name}")))
    };
    let start = parse_long(
        required_param(&query.start_timestamp, "startTimestamp")?,
        "startTimestamp",
    )?;
    let end = parse_long(
        required_param(&query.end_timestamp, "endTimestamp")?,
        "endTimestamp",
    )?;
    let limit = query
        .limit
        .as_deref()
        .map(|value| {
            value
                .parse::<i32>()
                .map(i64::from)
                .map_err(|_| ApiError::bad_request("Invalid parameter: limit"))
        })
        .transpose()?;
    ensure_enabled(&misc)?;
    // As in Play (whose ownership check had no effect), any run of the user's
    // organization is readable, matching the report's allowUnlisted access.
    let run_name = dao::run_name_by_id(&state.pool, run_id.as_str(), &user.organization_id)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    let min_level = query
        .min_level
        .as_deref()
        .filter(|level| LOG_LEVELS.contains(level))
        .unwrap_or("INFO");
    let entries = vx
        .loki
        .query_logs_batched(
            &misc.config().public_uri,
            &run_name,
            &user.organization_id,
            query.task_name.as_deref(),
            min_level,
            start,
            end,
            limit,
        )
        .await?;
    Ok(Json(Value::Array(entries)).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instants_accept_scala_inputs() {
        assert_eq!(
            parse_instant(&json!(1500)).unwrap().timestamp_millis(),
            1500
        );
        assert_eq!(
            parse_instant(&json!("1500")).unwrap().timestamp_millis(),
            1500
        );
        assert_eq!(
            parse_instant(&json!("1970-01-01T00:00:01.5Z"))
                .unwrap()
                .timestamp_millis(),
            1500
        );
        assert!(parse_instant(&json!(1.5)).is_none());
        assert!(parse_instant(&json!(null)).is_none());
    }

    #[test]
    fn events_are_grouped_and_validated() {
        let grouped = parse_events(vec![
            json!({"type": "RUN_HEARTBEAT", "timestamp": 1}),
            json!({"type": "RUN_STATE_CHANGE", "state": "RUNNING", "timestamp": "2"}),
        ])
        .unwrap();
        assert_eq!(grouped.heartbeats.len(), 1);
        assert_eq!(grouped.run_states[0].state, "RUNNING");
        for invalid in [
            json!({"timestamp": 1}),
            json!({"type": "OTHER"}),
            json!({"type": "RUN_STATE_CHANGE", "state": "running", "timestamp": 1}),
        ] {
            assert!(parse_events(vec![invalid]).is_err());
        }
    }

    #[test]
    fn state_times_follow_the_event_state() {
        let t = DateTime::from_timestamp_millis(1000).unwrap();
        assert_eq!(
            state_times("RUNNING", t),
            (json!("1970-01-01T00:00:01.000Z"), Value::Null)
        );
        assert_eq!(
            state_times("FAILED", t),
            (Value::Null, json!("1970-01-01T00:00:01.000Z"))
        );
        assert_eq!(state_times("SKIPPED", t), (Value::Null, Value::Null));
    }
}
