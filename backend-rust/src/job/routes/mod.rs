//! JobController core: list, status, read, cancel, retry, export redirect and
//! credit cost; plus the shared Job model, JobDAO read access and the
//! `JobService.publicWrites` serializer (JobCompactInfo) reused by other modules.
//!
//! Worker-facing routes (`/jobs/request`, `/jobs/:id/status`, attach*) live in
//! `job_workers.rs`; job submission (`/jobs/run/*`), voxelytics and AI models elsewhere.
use std::time::Duration;

use axum::{
    Extension, Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, patch},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};

use crate::{
    AppState,
    auth::AuthUser,
    auth::routes::AuthRouteConfig,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    system::application_info::MiscState,
    util::id::{ObjectId, PathObjectId},
};
use webknossos_common::geometry::BoundingBox;

const ALREADY_RETRIED: &str = "This job has already been retried once and failed again. This is likely a persistent failure. Please contact an administrator for help.";
pub(crate) const NOT_ENOUGH_CREDITS: &str =
    "Your organization does not have enough WEBKNOSSOS credits to run this job.";

/// JobCommand values in declaration order (the last four are legacy, display only).
pub(crate) const JOB_COMMANDS: [&str; 17] = [
    "compute_mesh_file",
    "compute_segment_index_file",
    "convert_to_wkw",
    "export_tiff",
    "find_largest_segment_id",
    "materialize_volume_annotation",
    "render_animation",
    "align_sections",
    "infer_neurons",
    "infer_instances",
    "infer_mitochondria",
    "train_neuron_model",
    "train_instance_model",
    "globalize_floodfills",
    "train_model",
    "infer_with_model",
    "infer_nuclei",
];

/// JobState values (also the order of the JOB_STATE database enum).
pub(crate) const JOB_STATES: [&str; 5] = ["PENDING", "STARTED", "SUCCESS", "FAILURE", "CANCELLED"];

/// DataSourceStatus.unreportedStatusList.
const UNREPORTED_DATASET_STATUSES: [&str; 3] = [
    "No longer available on datastore.",
    "Deleted by user.",
    crate::dataset::lifecycle::CONVERSION_FAILED,
];

pub(crate) fn is_job_command(command: &str) -> bool {
    JOB_COMMANDS.contains(&command)
}

/// JobDAO.readAccessQ for alias `j` ($1 = requesting user): own jobs, jobs of
/// members of teams the user manages, jobs of the admin's organization, or superuser.
pub(crate) const JOB_READ_ACCESS: &str = r#"(j._owner = $1
  OR j._owner IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN
    (SELECT _team FROM webknossos.user_team_roles WHERE _user = $1 AND isTeamManager))
  OR (SELECT ou._organization FROM webknossos.users_ ou WHERE ou._id = j._owner) IN
    (SELECT _organization FROM webknossos.users_ WHERE _id = $1 AND isAdmin)
  OR $1 IN (SELECT su._id FROM webknossos.users_ su JOIN webknossos.multiUsers_ sm ON su._multiUser = sm._id WHERE sm.isSuperUser))"#;

/// JobDAO.listAccessQ for alias `j` ($1 = requesting user): own jobs or jobs of the admin's organization.
const JOB_LIST_ACCESS: &str = r#"(j._owner = $1
  OR (SELECT ou._organization FROM webknossos.users_ ou WHERE ou._id = j._owner) IN
    (SELECT _organization FROM webknossos.users_ WHERE _id = $1 AND isAdmin))"#;

/// CreditTransactionDAO.readAccessQ ($1 = requesting user, unaliased credit_transactions_).
pub(crate) const CREDIT_READ_ACCESS: &str = r#"(_organization IN (SELECT _organization FROM webknossos.users_ WHERE (isAdmin OR isDatasetManager) AND _id = $1)
  OR _organization IN (SELECT _organization FROM webknossos.teams_ WHERE _id IN (SELECT _team FROM webknossos.user_team_roles WHERE isTeamManager AND _user = $1))
  OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)))"#;

/// Column list for [`Job`] (alias `j`, `_dataStore` trimmed as in JobDAO.parse).
pub(crate) const JOB_COLUMNS: &str = r#"j._id AS id, j._owner AS owner, TRIM(j._dataStore) AS data_store,
  j.command, j.commandArgs AS args, j.state::text AS state, j.manualState::text AS manual_state,
  j._worker AS worker, j._voxelytics_workflowHash AS workflow_hash, j.latestRunId AS latest_run_id,
  j.latestRunErrorDetails AS error_details, j.returnValue AS return_value,
  j.retriedBySuperUser AS retried_by_superuser, j.started, j.ended, j.lastRetry AS last_retry, j.created"#;

/// Settings for the jobs routes that are not covered by other configuration.
#[derive(Clone, Debug)]
pub struct JobsConfig {
    /// jobs.workerLivenessTimeout: a worker heartbeat younger than this is "recent".
    pub worker_liveness_timeout: Duration,
    /// silhouette.tokenAuthenticator.jobExpiry: lifetime of the per-job user tokens
    /// handed to workers.
    pub job_token_expiry: Duration,
}

impl Default for JobsConfig {
    fn default() -> Self {
        Self {
            worker_liveness_timeout: Duration::from_secs(60),
            job_token_expiry: Duration::from_secs(7 * 86_400),
        }
    }
}

#[derive(Clone)]
struct JobRoutes {
    enabled: bool,
    config: JobsConfig,
    auth: AuthRouteConfig,
}

pub fn router(enabled: bool, config: JobsConfig, auth: AuthRouteConfig) -> Router<AppState> {
    Router::new()
        .route("/jobs", get(list))
        .route("/jobs/status", get(status))
        .route("/jobs/getCreditCost", get(credit_cost))
        .route("/jobs/{id}", get(read))
        .route("/jobs/{id}/cancel", patch(cancel))
        .route("/jobs/{id}/retry", patch(retry))
        .route("/jobs/{id}/export", get(redirect_to_export))
        .layer(Extension(JobRoutes {
            enabled,
            config,
            auth,
        }))
}

fn require_enabled(routes: &JobRoutes) -> ApiResult<()> {
    if routes.enabled {
        Ok(())
    } else {
        Err(ApiError::bad_request(crate::msg::job::NOT_ENABLED))
    }
}

/// A row of webknossos.jobs (JobDAO's Job), with enum columns as text.
#[derive(sqlx::FromRow, Clone, Debug)]
pub(crate) struct Job {
    pub id: String,
    pub owner: String,
    pub data_store: String,
    pub command: String,
    pub args: Value,
    pub state: String,
    pub manual_state: Option<String>,
    #[expect(dead_code, reason = "selected with the job row, not rendered")]
    pub worker: Option<String>,
    pub workflow_hash: Option<String>,
    pub latest_run_id: Option<String>,
    pub error_details: Option<Value>,
    pub return_value: Option<String>,
    pub retried_by_superuser: bool,
    pub started: Option<DateTime<Utc>>,
    pub ended: Option<DateTime<Utc>>,
    pub last_retry: Option<DateTime<Utc>>,
    pub created: DateTime<Utc>,
}

impl Job {
    pub(crate) fn effective_state(&self) -> &str {
        self.manual_state.as_deref().unwrap_or(&self.state)
    }

    /// JobDAO.parse: command, states and args must be valid.
    pub(crate) fn is_valid(&self) -> bool {
        is_job_command(&self.command)
            && JOB_STATES.contains(&self.state.as_str())
            && self.args.is_object()
            && self
                .error_details
                .as_ref()
                .is_none_or(serde_json::Value::is_object)
    }
}

/// JobDAO.findOne with the requesting user's read access. `Ok(None)` is Play's
/// empty Fox; an unparsable row is the DAO's "Parsing failed" failure.
pub(crate) async fn find_job(
    connection: &mut PgConnection,
    user_id: &str,
    job_id: &str,
) -> ApiResult<Option<Job>> {
    let query = format!(
        "SELECT {JOB_COLUMNS} FROM webknossos.jobs_ j WHERE j._id = $2 AND {JOB_READ_ACCESS}"
    );
    let job: Option<Job> = sqlx::query_as(&query)
        .bind(user_id)
        .bind(job_id)
        .fetch_optional(&mut *connection)
        .await?;
    match job {
        Some(job) if !job.is_valid() => Err(ApiError::bad_request(format!(
            "Parsing failed for row in webknossos.jobs queried by {job_id}"
        ))),
        job => Ok(job),
    }
}

/// JobCompactInfo (JsonAutoFormat: absent optional fields are omitted).
pub(crate) struct JobCompactInfo {
    pub id: String,
    pub command: String,
    pub organization_id: String,
    pub owner_first_name: String,
    pub owner_last_name: String,
    pub owner_email: String,
    pub args: Value,
    pub state: String,
    pub error_details: Option<Value>,
    pub return_value: Option<String>,
    pub voxelytics_workflow_hash: Option<String>,
    pub created: DateTime<Utc>,
    pub started: Option<DateTime<Utc>>,
    pub ended: Option<DateTime<Utc>>,
    pub last_retry: Option<DateTime<Utc>>,
    pub cost_in_milli_credits: Option<i32>,
}

impl JobCompactInfo {
    /// JobCompactInfo.enrich + Json.toJson: strip worker tokens from the
    /// arguments and add the result link.
    pub(crate) fn into_json(self) -> Value {
        let mut args = self.args;
        if let Some(args) = args.as_object_mut() {
            args.remove("webknossos_token");
            args.remove("user_auth_token");
        }
        let result_link = result_link(
            &self.command,
            &self.state,
            &args,
            self.return_value.as_deref(),
            &self.id,
            &self.organization_id,
        );
        let millis = |date: DateTime<Utc>| json!(date.timestamp_millis());
        let mut value = Map::new();
        value.insert("id".into(), json!(self.id));
        value.insert("command".into(), json!(self.command));
        value.insert("organizationId".into(), json!(self.organization_id));
        value.insert("ownerFirstName".into(), json!(self.owner_first_name));
        value.insert("ownerLastName".into(), json!(self.owner_last_name));
        value.insert("ownerEmail".into(), json!(self.owner_email));
        value.insert("args".into(), args);
        value.insert("state".into(), json!(self.state));
        let optional = [
            ("errorDetails", self.error_details),
            ("returnValue", self.return_value.map(Value::from)),
            ("resultLink", result_link.map(Value::from)),
            (
                "voxelyticsWorkflowHash",
                self.voxelytics_workflow_hash.map(Value::from),
            ),
            ("created", Some(millis(self.created))),
            ("started", self.started.map(millis)),
            ("ended", self.ended.map(millis)),
            ("lastRetry", self.last_retry.map(millis)),
            (
                "costInMilliCredits",
                self.cost_in_milli_credits.map(Value::from),
            ),
        ];
        for (key, field) in optional {
            if let Some(field) = field {
                value.insert(key.into(), field);
            }
        }
        Value::Object(value)
    }
}

/// JobService.publicWrites with the requesting user's access context.
pub(crate) async fn public_writes(
    connection: &mut PgConnection,
    user_id: &str,
    job: &Job,
) -> ApiResult<Value> {
    // UserDAO.findOne (read access: managed team member, own organization as admin, self).
    let owner: (String, String) = sqlx::query_as(
        r#"SELECT u._organization, u._multiUser FROM webknossos.users_ u
          WHERE u._id = $2 AND (
            u._id IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN
              (SELECT _team FROM webknossos.user_team_roles WHERE _user = $1 AND isTeamManager))
            OR u._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1 AND isAdmin)
            OR u._id = $1)"#,
    )
    .bind(user_id)
    .bind(&job.owner)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::bad_request(crate::msg::user::NOT_FOUND_NO_ID))?;
    let (owner_organization, owner_multi_user) = owner;
    // MultiUserDAO.findOne (no access restriction, empty Fox when missing).
    let (first_name, last_name, email): (String, String, String) = sqlx::query_as(
        "SELECT firstName, lastName, email FROM webknossos.multiUsers_ WHERE _id = $1",
    )
    .bind(&owner_multi_user)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // OrganizationDAO.findOne (read access: an organization of the user's account, or superuser).
    let organization: String = sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.organizations_ WHERE _id = $2 AND (
            _id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser =
              (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1))
            OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN
              (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)))"#,
    )
    .bind(user_id)
    .bind(&owner_organization)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| {
        ApiError::bad_request(crate::msg::organization::not_found(&owner_organization))
    })?;
    // CreditTransactionService.findTransactionOfJob; any failure means "no cost".
    let cost_query = format!(
        r#"SELECT milli_credit_delta FROM webknossos.credit_transactions_
          WHERE _paid_job = $2 AND {CREDIT_READ_ACCESS} ORDER BY created_at, _id LIMIT 1"#
    );
    let delta: Option<i32> = sqlx::query_scalar(&cost_query)
        .bind(user_id)
        .bind(&job.id)
        .fetch_optional(&mut *connection)
        .await?;
    Ok(JobCompactInfo {
        id: job.id.clone(),
        command: job.command.clone(),
        organization_id: organization,
        owner_first_name: first_name,
        owner_last_name: last_name,
        owner_email: email,
        args: job.args.clone(),
        state: job.effective_state().to_owned(),
        error_details: job.error_details.clone(),
        return_value: job.return_value.clone(),
        voxelytics_workflow_hash: job.workflow_hash.clone(),
        created: job.created,
        started: job.started,
        ended: job.ended,
        last_retry: job.last_retry,
        // The delta is negative, the cost positive.
        cost_in_milli_credits: delta.map(|delta| -delta),
    }
    .into_json())
}

/// JobResultLinks.constructResultLink (`state` is the effective state).
pub(crate) fn result_link(
    command: &str,
    state: &str,
    args: &Value,
    return_value: Option<&str>,
    job_id: &str,
    organization: &str,
) -> Option<String> {
    if state != "SUCCESS" {
        return None;
    }
    let string_arg = |key: &str| args.get(key).and_then(Value::as_str);
    match command {
        "convert_to_wkw" | "compute_mesh_file" => match string_arg("dataset_id") {
            Some(id) => {
                let prefix = string_arg("dataset_name")
                    .map(|name| format!("{name}-"))
                    .unwrap_or_default();
                Some(format!("/datasets/{prefix}{id}/view"))
            }
            None => string_arg("dataset_name")
                .map(|name| format!("/datasets/{organization}/{name}/view")),
        },
        "export_tiff" | "render_animation" => Some(format!("/api/jobs/{job_id}/export")),
        "infer_nuclei"
        | "infer_neurons"
        | "materialize_volume_annotation"
        | "infer_with_model"
        | "infer_mitochondria"
        | "align_sections"
        | "infer_instances" => return_value.map(|return_value| {
            link_from_dataset_or_annotation_return_value(return_value, organization)
        }),
        _ => None,
    }
}

/// JobResultLinks.linkFromDatasetOrAnnotationReturnValue. Newer jobs return the path (or url) of
/// the annotation containing their result, which already is a link. Older jobs returned a dataset
/// name, a directoryName or a datasetId.
fn link_from_dataset_or_annotation_return_value(return_value: &str, organization: &str) -> String {
    if return_value.starts_with('/')
        || return_value.starts_with("http://")
        || return_value.starts_with("https://")
    {
        return_value.to_owned()
    // ObjectId.fromStringSync accepts 24 hex digits in either case.
    } else if return_value.len() == 24 && return_value.bytes().all(|b| b.is_ascii_hexdigit()) {
        format!("/datasets/{}/view", return_value.to_ascii_lowercase())
    } else {
        format!("/datasets/{organization}/{return_value}/view")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    command: Option<String>,
    skip_for_deleted_datasets: Option<bool>,
}

#[derive(sqlx::FromRow)]
struct CompactRow {
    id: String,
    command: String,
    organization: String,
    first_name: String,
    last_name: String,
    email: String,
    args: Value,
    state: String,
    return_value: Option<String>,
    error_details: Option<Value>,
    workflow_hash: Option<String>,
    created: DateTime<Utc>,
    started: Option<DateTime<Utc>>,
    ended: Option<DateTime<Utc>>,
    last_retry: Option<DateTime<Utc>>,
    milli_credit_delta: Option<i32>,
}

// Query extraction precedes authentication: Play binds route parameters first.
async fn list(
    State(state): State<AppState>,
    Extension(routes): Extension<JobRoutes>,
    Query(query): Query<ListQuery>,
    user: AuthUser,
) -> ApiResult<Json<Vec<Value>>> {
    require_enabled(&routes)?;
    if let Some(command) = &query.command
        && !is_job_command(command)
    {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    // JobDAO.findAllCompact. The credit lateral join has no access check (as in Scala);
    // retries can attach several transactions with the same delta, so one suffices.
    let sql = format!(
        r#"SELECT j._id AS id, j.command, u._organization AS organization, mu.firstName AS first_name,
            mu.lastName AS last_name, mu.email, j.commandArgs AS args,
            COALESCE(j.manualState, j.state)::text AS state, j.returnValue AS return_value,
            j.latestRunErrorDetails AS error_details, j._voxelytics_workflowHash AS workflow_hash,
            j.created, j.started, j.ended, j.lastRetry AS last_retry, ct.milli_credit_delta
          FROM webknossos.jobs_ j
          JOIN webknossos.users_ u ON j._owner = u._id
          JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
          LEFT JOIN LATERAL (SELECT milli_credit_delta FROM webknossos.credit_transactions_
            WHERE _paid_job = j._id LIMIT 1) ct ON TRUE
          WHERE ($2::text IS NULL OR j.command = $2)
            AND {JOB_LIST_ACCESS}
            AND (NOT $3 OR (j.commandArgs->>'dataset_id')::text IN
              (SELECT _id FROM webknossos.datasets WHERE status NOT IN ($4, $5, $6)))
          ORDER BY j.created DESC, j._id DESC"#
    );
    let rows: Vec<CompactRow> = sqlx::query_as(&sql)
        .bind(&user.id)
        .bind(&query.command)
        .bind(query.skip_for_deleted_datasets.unwrap_or(false))
        .bind(UNREPORTED_DATASET_STATUSES[0])
        .bind(UNREPORTED_DATASET_STATUSES[1])
        .bind(UNREPORTED_DATASET_STATUSES[2])
        .fetch_all(&state.pool)
        .await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        // JobCommand/JobState/JsObject parsing without message: an empty Fox.
        if !is_job_command(&row.command)
            || !row.args.is_object()
            || row.error_details.as_ref().is_some_and(|v| !v.is_object())
        {
            return Err(ApiError::not_found(crate::msg::NOT_FOUND));
        }
        result.push(
            JobCompactInfo {
                id: row.id,
                command: row.command,
                organization_id: row.organization,
                owner_first_name: row.first_name,
                owner_last_name: row.last_name,
                owner_email: row.email,
                args: row.args,
                state: row.state,
                error_details: row.error_details,
                return_value: row.return_value,
                voxelytics_workflow_hash: row.workflow_hash,
                created: row.created,
                started: row.started,
                ended: row.ended,
                last_retry: row.last_retry,
                cost_in_milli_credits: row.milli_credit_delta.map(|delta| -delta),
            }
            .into_json(),
        );
    }
    Ok(Json(result))
}

#[derive(sqlx::FromRow)]
struct WorkerRow {
    id: String,
    name: String,
    max_high: i32,
    max_low: i32,
    commands: Vec<String>,
    created: DateTime<Utc>,
    last_heart_beat: DateTime<Utc>,
    last_reported_version: Option<String>,
}

/// JobController.status: all workers (global access) and job counts by worker state.
async fn status(
    State(state): State<AppState>,
    Extension(routes): Extension<JobRoutes>,
    _user: AuthUser,
) -> ApiResult<Json<Value>> {
    let counts: Vec<(String, i64)> = sqlx::query_as(
        r#"SELECT state::text, COUNT(_id) FROM webknossos.jobs_
          WHERE manualState IS NULL GROUP BY state ORDER BY state"#,
    )
    .fetch_all(&state.pool)
    .await?;
    let workers: Vec<WorkerRow> = sqlx::query_as(
        r#"SELECT _id AS id, name, maxParallelHighPriorityJobs AS max_high,
            maxParallelLowPriorityJobs AS max_low, supportedJobCommands AS commands, created,
            lastHeartBeat AS last_heart_beat, lastReportedVersion AS last_reported_version
          FROM webknossos.workers_ ORDER BY created, _id"#,
    )
    .fetch_all(&state.pool)
    .await?;
    let now = Utc::now();
    let timeout = chrono::Duration::from_std(routes.config.worker_liveness_timeout)
        .unwrap_or(chrono::Duration::MAX);
    let mut workers_json = Vec::with_capacity(workers.len());
    for worker in workers {
        let mut commands: Vec<String> = Vec::new();
        for command in worker.commands {
            if !is_job_command(&command) {
                return Err(ApiError::bad_request(
                    crate::msg::request::list_row_parse_failed("webknossos.workers"),
                ));
            }
            if !commands.contains(&command) {
                commands.push(command);
            }
        }
        workers_json.push(json!({
            "id": worker.id,
            "name": worker.name,
            "maxParallelHighPriorityJobs": worker.max_high,
            "maxParallelLowPriorityJobs": worker.max_low,
            "supportedJobCommands": commands,
            "created": worker.created.timestamp_millis(),
            "lastHeartBeat": worker.last_heart_beat.timestamp_millis(),
            "lastHeartBeatIsRecent": now - worker.last_heart_beat < timeout,
            "lastReportedVersion": worker.last_reported_version,
        }));
    }
    let jobs_by_state: Map<String, Value> = counts
        .into_iter()
        .map(|(state, count)| (state, Value::from(count)))
        .collect();
    Ok(Json(json!({
        "workers": workers_json,
        "jobsByState": jobs_by_state,
    })))
}

async fn read(
    State(state): State<AppState>,
    Extension(routes): Extension<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    require_enabled(&routes)?;
    let mut connection = state.pool.acquire().await?;
    let job = find_job(&mut connection, &user.id, id.as_str())
        .await
        .map_err(job_not_found)?
        .ok_or_else(|| ApiError::bad_request(crate::msg::job::NOT_FOUND))?;
    Ok(Json(public_writes(&mut connection, &user.id, &job).await?))
}

/// `?~> Msg.Job.notFound` replaces failure messages, but database errors stay errors.
fn job_not_found(error: ApiError) -> ApiError {
    if error.status == StatusCode::BAD_REQUEST {
        ApiError::bad_request(crate::msg::job::NOT_FOUND)
    } else {
        error
    }
}

pub(crate) async fn serializable(pool: &PgPool) -> ApiResult<Transaction<'static, Postgres>> {
    let mut transaction = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await?;
    Ok(transaction)
}

/// Job cancelling protocol: the user sets manualState immediately; the worker
/// later sets state. Pending/started paid jobs get their reservation refunded.
async fn cancel(
    State(state): State<AppState>,
    Extension(routes): Extension<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    require_enabled(&routes)?;
    let mut transaction = serializable(&state.pool).await?;
    let job = find_job(&mut transaction, &user.id, id.as_str())
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // JobDAO.updateManualState: update access equals read access, checked by find_job.
    // Finished jobs stay as they are; cancelling them would hide their result and make the
    // worker see them as to-cancel on every poll.
    sqlx::query(
        "UPDATE webknossos.jobs SET manualState = 'CANCELLED'
         WHERE _id = $1 AND state NOT IN ('SUCCESS', 'FAILURE')",
    )
        .bind(&job.id)
        .execute(&mut *transaction)
        .await?;
    if job.state == "PENDING" || job.state == "STARTED" {
        refund_transaction_for_job(&mut transaction, &job.id, true)
            .await
            .map_err(|error| {
                if error.status.is_server_error() {
                    error
                } else {
                    ApiError::bad_request(crate::msg::job::credits::REFUND_FAILED)
                }
            })?;
    }
    transaction.commit().await?;
    let mut connection = state.pool.acquire().await?;
    // Like Scala, the response shows the job as read before cancelling.
    Ok(Json(public_writes(&mut connection, &user.id, &job).await?))
}

/// CreditTransactionService.refundTransactionForJob (global access): refund the
/// job's pending reservation, if any. Run inside a SERIALIZABLE transaction.
pub(crate) async fn refund_transaction_for_job(
    connection: &mut PgConnection,
    job_id: &str,
    is_cancelled: bool,
) -> ApiResult<()> {
    let pending: Option<String> = sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.credit_transactions_
          WHERE _paid_job = $1 AND transaction_state = 'Pending'
          ORDER BY created_at, _id LIMIT 1 FOR UPDATE"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *connection)
    .await?;
    let Some(transaction_id) = pending else {
        // Assume a transaction-less (unpaid) job.
        return Ok(());
    };
    let comment = if is_cancelled {
        format!("Refund for cancelled job {job_id}.")
    } else {
        format!("Refund for failed job {job_id}.")
    };
    // CreditTransactionDAO.refundTransaction: the refund amount is NULL (and the
    // insert fails) unless the reservation is still pending with a non-positive delta.
    let inserted = sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, _related_transaction, milli_credit_delta, comment, transaction_state, credit_state)
          SELECT $1, _organization, _id,
            (SELECT milli_credit_delta * -1 FROM webknossos.credit_transactions
              WHERE _id = $2 AND transaction_state = 'Pending' AND credit_state = 'Pending'
                AND milli_credit_delta <= 0),
            $3, 'Complete', 'Refunding'
          FROM webknossos.credit_transactions WHERE _id = $2"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&transaction_id)
    .bind(&comment)
    .execute(&mut *connection)
    .await
    .map_err(refund_error)?
    .rows_affected();
    let updated = sqlx::query(
        r#"UPDATE webknossos.credit_transactions
          SET transaction_state = 'Complete', credit_state = 'Refunded', updated_at = NOW()
          WHERE _id = $1 AND transaction_state = 'Pending' AND milli_credit_delta <= 0"#,
    )
    .bind(&transaction_id)
    .execute(&mut *connection)
    .await
    .map_err(refund_error)?
    .rows_affected();
    if inserted != 1 || updated != 1 {
        return Err(ApiError::bad_request(format!(
            "Failed to refund transaction {transaction_id} properly."
        )));
    }
    Ok(())
}

/// Constraint and trigger violations are Fox failures (400); other database errors stay errors.
fn refund_error(error: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(database) = &error
        && database
            .code()
            .is_some_and(|code| code.starts_with("23") || code == "P0004")
    {
        return ApiError::bad_request(crate::msg::job::credits::REFUND_FAILED);
    }
    error.into()
}

/// Users may retry a failed job once; superusers always.
async fn retry(
    State(state): State<AppState>,
    Extension(routes): Extension<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    require_enabled(&routes)?;
    let mut connection = state.pool.acquire().await?;
    let job = find_job(&mut connection, &user.id, id.as_str())
        .await
        .map_err(job_not_found)?
        .ok_or_else(|| ApiError::bad_request(crate::msg::job::NOT_FOUND))?;
    if !(user.is_superuser || job.last_retry.is_none()) {
        return Err(ApiError::forbidden(ALREADY_RETRIED));
    }
    let mut transaction = serializable(&state.pool).await?;
    // JobDAO.retryOne: only failed or cancelled jobs are reset (otherwise a no-op). The retry
    // limit is re-checked here so that concurrent retries cannot both pass it.
    let reset = sqlx::query(
        r#"UPDATE webknossos.jobs
          SET state = 'PENDING', manualState = NULL, retriedBySuperUser = $2, lastRetry = NOW()
          WHERE _id = $1 AND ($2 OR lastRetry IS NULL)
            AND (state IN ('FAILURE', 'CANCELLED') OR manualState = 'CANCELLED')"#,
    )
    .bind(&job.id)
    .bind(user.is_superuser)
    .execute(&mut *transaction)
    .await?
    .rows_affected();
    // Credits are only reserved for jobs that actually rerun; a failure rolls the reset back.
    if reset == 1 {
        reserve_credits_for_retry(&mut transaction, &user.id, &job.id).await?;
    }
    transaction.commit().await?;
    // Like Scala, the response shows the job as read before retrying.
    Ok(Json(public_writes(&mut connection, &user.id, &job).await?))
}

/// CreditTransactionService.reserveCreditsForRetry with the user's access: if the
/// job has a (visible) credit transaction, reserve the same amount again.
async fn reserve_credits_for_retry(
    connection: &mut PgConnection,
    user_id: &str,
    job_id: &str,
) -> ApiResult<()> {
    let existing_query = format!(
        r#"SELECT _organization, milli_credit_delta, comment FROM webknossos.credit_transactions_
          WHERE _paid_job = $2 AND {CREDIT_READ_ACCESS} ORDER BY created_at, _id LIMIT 1"#
    );
    let existing: Option<(String, i32, String)> = sqlx::query_as(&existing_query)
        .bind(user_id)
        .bind(job_id)
        .fetch_optional(&mut *connection)
        .await?;
    let Some((organization, delta, comment)) = existing else {
        // Assume a transaction-less (unpaid) job.
        return Ok(());
    };
    let balance = milli_credit_balance(connection, user_id, &organization).await?;
    if balance < -i64::from(delta) {
        return Err(ApiError::bad_request(NOT_ENOUGH_CREDITS));
    }
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, milli_credit_delta, comment, _paid_job,
           transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES ($1, $2, $3, $4, $5, 'Pending', 'Pending', NULL, NOW(), NOW(), FALSE)"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&organization)
    .bind(delta)
    .bind(&comment)
    .bind(job_id)
    .execute(&mut *connection)
    .await
    .map_err(crate::organization::credit_transactions::balance_error)?;
    Ok(())
}

/// CreditTransactionDAO.getMilliCreditBalance with the user's read access
/// (users without credit access see a balance of 0).
pub(crate) async fn milli_credit_balance(
    connection: &mut PgConnection,
    user_id: &str,
    organization: &str,
) -> ApiResult<i64> {
    let query = format!(
        r#"SELECT COALESCE(SUM(milli_credit_delta), 0)::bigint FROM webknossos.credit_transactions_
          WHERE _organization = $2 AND {CREDIT_READ_ACCESS}"#
    );
    Ok(sqlx::query_scalar(&query)
        .bind(user_id)
        .bind(organization)
        .fetch_one(&mut *connection)
        .await?)
}

/// Redirect to the datastore's export download, authenticated with the user's
/// (found or newly created) Authentication token. No jobs-enabled check (as in Scala).
async fn redirect_to_export(
    State(state): State<AppState>,
    Extension(routes): Extension<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Response> {
    let mut connection = state.pool.acquire().await?;
    let job = find_job(&mut connection, &user.id, id.as_str())
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // DataStoreDAO.findOneByName (read access: unrestricted or the user's organization).
    let public_url: String = sqlx::query_scalar(
        r#"SELECT publicUrl FROM webknossos.dataStores_ WHERE name = $1 AND
          (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization IN
            (SELECT _organization FROM webknossos.users_ WHERE _id = $2))"#,
    )
    .bind(&job.data_store)
    .bind(&user.id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    drop(connection);
    let token = find_or_create_token(&state.pool, &user.id, &routes.auth).await?;
    let token: String = url::form_urlencoded::byte_serialize(token.as_bytes()).collect();
    // Play's Redirect(url, queryString) appends with '?' or '&' and answers 303.
    let base = format!("{public_url}/data/exports/{id}/download");
    let separator = if base.contains('?') { '&' } else { '?' };
    let location = format!("{base}{separator}token={token}");
    Ok((StatusCode::SEE_OTHER, [(header::LOCATION, location)]).into_response())
}

/// CombinedAuthenticatorService.findOrCreateTokenForUser, with the same usable-token
/// filter as GET /auth/token (`crate::auth::routes::get_token`): reuse a valid
/// Authentication token, otherwise retire the old ones and create a new one.
async fn find_or_create_token(
    pool: &PgPool,
    user_id: &str,
    config: &AuthRouteConfig,
) -> ApiResult<String> {
    let mut transaction = pool.begin().await?;
    // Serialize concurrent creation for the same user.
    sqlx::query("SELECT _id FROM webknossos.users WHERE _id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
    let existing: Option<String> = sqlx::query_scalar(
        r#"SELECT token.value FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          WHERE token._user = $1 AND token.tokenType = 'Authentication' AND NOT token.isDeleted
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000 < token.idleTimeout))
            AND (usr.loggedOutEverywhereTime IS NULL OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens AS matching WHERE matching.value = token.value AND NOT matching.isDeleted) = 1
          ORDER BY token.created, token._id LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if let Some(token) = existing {
        transaction.commit().await?;
        return Ok(token);
    }
    let expiry_ms =
        i64::try_from(config.auth_expiry.as_millis()).map_err(|_| ApiError::internal())?;
    let idle_ms =
        i64::try_from(config.auth_idle_timeout.as_millis()).map_err(|_| ApiError::internal())?;
    if expiry_ms <= 0 || idle_ms <= 0 {
        return Err(ApiError::internal());
    }
    sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted",
    )
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    let value = URL_SAFE_NO_PAD.encode(random);
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
          (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
          VALUES ($1, $2, $3, statement_timestamp(),
            statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
            'Authentication', statement_timestamp())"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(value)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreditCostQuery {
    command: String,
    bounding_box_in_mag: String,
}

/// Feature key with the per-gigavoxel cost of a paid job command.
fn cost_feature(command: &str) -> Option<(&'static str, i64)> {
    Some(match command {
        "infer_neurons" => ("neuronInferralCostInMilliCreditsPerGVx", 1000),
        "infer_nuclei" => ("nucleiInferralCostInMilliCreditsPerGVx", 1000),
        "infer_mitochondria" => ("mitochondriaInferralCostInMilliCreditsPerGVx", 1000),
        "infer_instances" => ("instancesInferralCostInMilliCreditsPerGVx", 1000),
        "train_neuron_model" | "train_instance_model" => ("", 0),
        "align_sections" => ("alignmentCostInMilliCreditsPerGVx", 500),
        _ => return None,
    })
}

/// JobService.calculateJobCostInMilliCredits; `Err` carries Scala's failure message.
pub(crate) fn job_cost_in_milli_credits(
    features: &Map<String, Value>,
    command: &str,
    bounding_box_in_target_mag: &BoundingBox,
) -> Result<i32, String> {
    let (key, default) =
        cost_feature(command).ok_or_else(|| format!("Unsupported job command {command}"))?;
    let per_gvx = if key.is_empty() {
        0
    } else {
        features
            .get(key)
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok())
            .map_or(default, i64::from)
    };
    // Scala: the volume is computed as Double so that huge bounding boxes cannot
    // overflow (empty boxes cost nothing); math.ceil(..).toInt saturates, at least 0.
    let bbox = bounding_box_in_target_mag;
    let volume_in_gvx = if bbox.is_empty() {
        0.0
    } else {
        f64::from(bbox.width) * f64::from(bbox.height) * f64::from(bbox.depth) / 1e9
    };
    let cost = (volume_in_gvx * per_gvx as f64).ceil() as i32;
    Ok(cost.max(0))
}

// Query extraction precedes authentication: Play binds route parameters first.
async fn credit_cost(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Query(query): Query<CreditCostQuery>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let bounding_box = BoundingBox::from_literal(&query.bounding_box_in_mag)
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if !is_job_command(&query.command) {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    let cost = job_cost_in_milli_credits(&misc.config().features, &query.command, &bounding_box)
        .map_err(ApiError::bad_request)?;
    let mut connection = state.pool.acquire().await?;
    let balance = milli_credit_balance(&mut connection, &user.id, &user.organization_id).await?;
    Ok(Json(json!({
        "costInMilliCredits": cost,
        "hasEnoughCredits": i64::from(cost) <= balance,
        "organizationMilliCredits": balance,
    })))
}

#[cfg(test)]
mod tests;
