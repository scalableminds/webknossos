//! JobController core: list, status, read, cancel, retry, export redirect and
//! credit cost; plus the shared Job model, JobDAO read access and the
//! `JobService.publicWrites` serializer (JobCompactInfo) reused by other modules.
//!
//! Worker-facing routes (`/jobs/request`, `/jobs/:id/status`, attach*) live in
//! `job_workers.rs`; job submission (`/jobs/run/*`), voxelytics and AI models elsewhere.
use std::{collections::BTreeMap, time::Duration};

use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, patch},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{PgConnection, PgPool};

use crate::{
    AppState,
    auth::AuthUser,
    auth::routes::AuthRouteConfig,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    job::dao,
    system::application_info::MiscState,
    util::id::{ObjectId, PathObjectId},
};
use axum::extract::FromRef;
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

pub(crate) fn is_job_command(command: &str) -> bool {
    JOB_COMMANDS.contains(&command)
}

pub(crate) use dao::JOB_COLUMNS;

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

/// The configuration the job routes read, taken from the app state per request.
impl FromRef<AppState> for JobRoutes {
    fn from_ref(state: &AppState) -> Self {
        Self {
            enabled: state.jobs_enabled.0,
            config: state.jobs.clone(),
            auth: state.auth_routes.clone(),
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/jobs", get(list))
        .route("/jobs/status", get(status))
        .route("/jobs/getCreditCost", get(credit_cost))
        .route("/jobs/{id}", get(read))
        .route("/jobs/{id}/cancel", patch(cancel))
        .route("/jobs/{id}/retry", patch(retry))
        .route("/jobs/{id}/export", get(redirect_to_export))
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
    pub id: ObjectId,
    pub owner: ObjectId,
    pub data_store: String,
    pub command: String,
    pub args: Value,
    pub state: String,
    pub manual_state: Option<String>,
    #[expect(dead_code, reason = "selected with the job row, not rendered")]
    pub worker: Option<ObjectId>,
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
    user_id: &ObjectId,
    job_id: &ObjectId,
) -> ApiResult<Option<Job>> {
    let job = dao::find_one(connection, user_id, job_id).await?;
    match job {
        Some(job) if !job.is_valid() => Err(ApiError::bad_request(format!(
            "Parsing failed for row in webknossos.jobs queried by {job_id}"
        ))),
        job => Ok(job),
    }
}

/// JobCompactInfo (JsonAutoFormat: absent optional fields are omitted).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobCompactInfo {
    pub id: ObjectId,
    pub command: String,
    pub organization_id: String,
    pub owner_first_name: String,
    pub owner_last_name: String,
    pub owner_email: String,
    /// The stored job arguments.
    pub args: Value,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_value: Option<String>,
    /// Set by [`JobCompactInfo::enrich`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voxelytics_workflow_hash: Option<String>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub created: DateTime<Utc>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "chrono::serde::ts_milliseconds_option"
    )]
    pub started: Option<DateTime<Utc>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "chrono::serde::ts_milliseconds_option"
    )]
    pub ended: Option<DateTime<Utc>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "chrono::serde::ts_milliseconds_option"
    )]
    pub last_retry: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_in_milli_credits: Option<i32>,
}

impl JobCompactInfo {
    /// JobCompactInfo.enrich: strip worker tokens from the arguments and add the result link.
    pub(crate) fn enrich(mut self) -> Self {
        if let Some(args) = self.args.as_object_mut() {
            args.remove("webknossos_token");
            args.remove("user_auth_token");
        }
        self.result_link = result_link(
            &self.command,
            &self.state,
            &self.args,
            self.return_value.as_deref(),
            &self.id,
            &self.organization_id,
        );
        self
    }
}

/// JobService.publicWrites with the requesting user's access context.
pub(crate) async fn public_writes(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    job: &Job,
) -> ApiResult<JobCompactInfo> {
    let owner = dao::find_owner_organization_and_multi_user(connection, user_id, &job.owner)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::user::NOT_FOUND_NO_ID))?;
    let (owner_organization, owner_multi_user) = owner;
    let (first_name, last_name, email) =
        dao::find_multi_user_name_and_email(connection, &owner_multi_user)
            .await?
            .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let organization = dao::find_readable_organization_id(connection, user_id, &owner_organization)
        .await?
        .ok_or_else(|| {
            ApiError::bad_request(crate::msg::organization::not_found(&owner_organization))
        })?;
    // CreditTransactionService.findTransactionOfJob; any failure means "no cost".
    let delta = dao::find_credit_delta_of_job(connection, user_id, &job.id).await?;
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
        result_link: None,
        voxelytics_workflow_hash: job.workflow_hash.clone(),
        created: job.created,
        started: job.started,
        ended: job.ended,
        last_retry: job.last_retry,
        // The delta is negative, the cost positive.
        cost_in_milli_credits: delta.map(|delta| -delta),
    }
    .enrich())
}

/// JobResultLinks.constructResultLink (`state` is the effective state).
pub(crate) fn result_link(
    command: &str,
    state: &str,
    args: &Value,
    return_value: Option<&str>,
    job_id: &ObjectId,
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

// Query extraction precedes authentication: Play binds route parameters first.
async fn list(
    State(state): State<AppState>,
    State(routes): State<JobRoutes>,
    Query(query): Query<ListQuery>,
    user: AuthUser,
) -> ApiResult<Json<Vec<JobCompactInfo>>> {
    require_enabled(&routes)?;
    if let Some(command) = &query.command
        && !is_job_command(command)
    {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    let skip_for_deleted_datasets = query.skip_for_deleted_datasets.unwrap_or(false);
    let rows = dao::find_all_compact(
        &state.pool,
        &user.id,
        query.command.as_deref(),
        skip_for_deleted_datasets,
    )
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
                result_link: None,
                voxelytics_workflow_hash: row.workflow_hash,
                created: row.created,
                started: row.started,
                ended: row.ended,
                last_retry: row.last_retry,
                cost_in_milli_credits: row.milli_credit_delta.map(|delta| -delta),
            }
            .enrich(),
        );
    }
    Ok(Json(result))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobsStatus {
    workers: Vec<WorkerStatus>,
    jobs_by_state: BTreeMap<String, i64>,
}

/// WorkerService.publicWrites.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerStatus {
    id: ObjectId,
    name: String,
    max_parallel_high_priority_jobs: i32,
    max_parallel_low_priority_jobs: i32,
    supported_job_commands: Vec<String>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    created: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    last_heart_beat: DateTime<Utc>,
    last_heart_beat_is_recent: bool,
    last_reported_version: Option<String>,
}

/// JobController.status: all workers (global access) and job counts by worker state.
async fn status(
    State(state): State<AppState>,
    State(routes): State<JobRoutes>,
    _user: AuthUser,
) -> ApiResult<Json<JobsStatus>> {
    let counts = dao::count_by_state(&state.pool).await?;
    let workers = dao::find_all_workers(&state.pool).await?;
    let now = Utc::now();
    let timeout = chrono::Duration::from_std(routes.config.worker_liveness_timeout)
        .unwrap_or(chrono::Duration::MAX);
    let mut worker_statuses = Vec::with_capacity(workers.len());
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
        worker_statuses.push(WorkerStatus {
            id: worker.id,
            name: worker.name,
            max_parallel_high_priority_jobs: worker.max_high,
            max_parallel_low_priority_jobs: worker.max_low,
            supported_job_commands: commands,
            created: worker.created,
            last_heart_beat_is_recent: now - worker.last_heart_beat < timeout,
            last_heart_beat: worker.last_heart_beat,
            last_reported_version: worker.last_reported_version,
        });
    }
    Ok(Json(JobsStatus {
        workers: worker_statuses,
        jobs_by_state: counts.into_iter().collect(),
    }))
}

async fn read(
    State(state): State<AppState>,
    State(routes): State<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<JobCompactInfo>> {
    require_enabled(&routes)?;
    let mut connection = state.pool.acquire().await?;
    let job = find_job(&mut connection, &user.id, &id)
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

/// Job cancelling protocol: the user sets manualState immediately; the worker
/// later sets state. Pending/started paid jobs get their reservation refunded.
async fn cancel(
    State(state): State<AppState>,
    State(routes): State<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<JobCompactInfo>> {
    require_enabled(&routes)?;
    let mut transaction = crate::db::begin_serializable(&state.pool).await?;
    let job = find_job(&mut transaction, &user.id, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    // JobDAO.updateManualState: update access equals read access, checked by find_job.
    dao::update_manual_state_cancelled(&mut transaction, &job.id).await?;
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
    job_id: &ObjectId,
    is_cancelled: bool,
) -> ApiResult<()> {
    let pending = dao::find_pending_transaction_of_job(connection, job_id).await?;
    let Some(transaction_id) = pending else {
        // Assume a transaction-less (unpaid) job.
        return Ok(());
    };
    let comment = if is_cancelled {
        format!("Refund for cancelled job {job_id}.")
    } else {
        format!("Refund for failed job {job_id}.")
    };
    // CreditTransactionDAO.refundTransaction.
    let inserted =
        dao::insert_refund_transaction(connection, &ObjectId::new(), &transaction_id, &comment)
            .await
            .map_err(refund_error)?;
    let updated = dao::update_transaction_refunded(connection, &transaction_id)
        .await
        .map_err(refund_error)?;
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
    State(routes): State<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<JobCompactInfo>> {
    require_enabled(&routes)?;
    let mut connection = state.pool.acquire().await?;
    let job = find_job(&mut connection, &user.id, &id)
        .await
        .map_err(job_not_found)?
        .ok_or_else(|| ApiError::bad_request(crate::msg::job::NOT_FOUND))?;
    if !(user.is_superuser || job.last_retry.is_none()) {
        return Err(ApiError::forbidden(ALREADY_RETRIED));
    }
    let mut transaction = crate::db::begin_serializable(&state.pool).await?;
    // JobDAO.retryOne.
    let reset = dao::retry_one(&mut transaction, &job.id, user.is_superuser).await?;
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
    user_id: &ObjectId,
    job_id: &ObjectId,
) -> ApiResult<()> {
    let existing = dao::find_credit_transaction_of_job(connection, user_id, job_id).await?;
    let Some((organization, delta, comment)) = existing else {
        // Assume a transaction-less (unpaid) job.
        return Ok(());
    };
    let balance = dao::get_milli_credit_balance(connection, user_id, &organization).await?;
    if balance < -i64::from(delta) {
        return Err(ApiError::bad_request(NOT_ENOUGH_CREDITS));
    }
    dao::insert_pending_credit_transaction(
        connection,
        &ObjectId::new(),
        &organization,
        delta,
        &comment,
        job_id,
    )
    .await
    .map_err(crate::organization::credit_transactions::balance_error)?;
    Ok(())
}

/// Redirect to the datastore's export download, authenticated with the user's
/// (found or newly created) Authentication token. No jobs-enabled check (as in Scala).
async fn redirect_to_export(
    State(state): State<AppState>,
    State(routes): State<JobRoutes>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Response> {
    let mut connection = state.pool.acquire().await?;
    let job = find_job(&mut connection, &user.id, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let public_url = dao::find_data_store_public_url(&mut connection, &job.data_store, &user.id)
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
    user_id: &ObjectId,
    config: &AuthRouteConfig,
) -> ApiResult<String> {
    let mut transaction = pool.begin().await?;
    // Serialize concurrent creation for the same user.
    dao::lock_user(&mut transaction, user_id).await?;
    let existing = dao::find_usable_authentication_token(&mut transaction, user_id).await?;
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
    dao::delete_authentication_tokens(&mut transaction, user_id).await?;
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    let value = URL_SAFE_NO_PAD.encode(random);
    dao::insert_authentication_token(
        &mut transaction,
        &ObjectId::new(),
        &value,
        user_id,
        expiry_ms,
        idle_ms,
    )
    .await?;
    transaction.commit().await?;
    Ok(value)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditCost {
    cost_in_milli_credits: i32,
    has_enough_credits: bool,
    organization_milli_credits: i64,
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
    State(misc): State<MiscState>,
    Query(query): Query<CreditCostQuery>,
    user: AuthUser,
) -> ApiResult<Json<CreditCost>> {
    let bounding_box = BoundingBox::from_literal(&query.bounding_box_in_mag)
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if !is_job_command(&query.command) {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    let cost = job_cost_in_milli_credits(&misc.config().features, &query.command, &bounding_box)
        .map_err(ApiError::bad_request)?;
    let mut connection = state.pool.acquire().await?;
    let balance =
        dao::get_milli_credit_balance(&mut connection, &user.id, &user.organization_id).await?;
    Ok(Json(CreditCost {
        cost_in_milli_credits: cost,
        has_enough_credits: i64::from(cost) <= balance,
        organization_milli_credits: balance,
    }))
}

#[cfg(test)]
mod tests;
