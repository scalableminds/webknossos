//! WKRemoteWorkerController: the routes polled and called by job workers,
//! authenticated by the worker key (`?key=`), not by a user token.
//!
//! - `GET /jobs/request`: heartbeat, reserve pending jobs, hand out jobs to run/cancel.
//! - `POST /jobs/:id/status`: state transitions plus credit completion/refund.
//! - `POST /jobs/:id/attachVoxelyticsWorkflow`, `POST /jobs/:id/attachDatasetToInference`.
use std::time::Duration;

use axum::{
    Extension, Json, Router,
    extract::State,
    http::Method,
    response::Response,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, PgPool};

use crate::{
    AppState,
    application_info::{MiscState, ok_empty},
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as JsonBody, Path, Query},
    id::{ObjectId, PathObjectId},
    jobs::{self, JOB_COLUMNS, JOB_COMMANDS, JOB_STATES, Job, JobsConfig},
    mail::{Mail, MailSender, templates},
    service_clients::ServiceClients,
    slack::{self, SlackNotificationService},
};

/// Msg.notFound: Play's response for an empty Fox.
const NOT_FOUND: &str = "Could not find or access the requested resource.";
const WORKER_NOT_FOUND: &str = "Could not find this worker in the database.";
const JOB_NOT_FOUND: &str = "Job could not be found or accessed.";
const UPDATE_STATUS_FAILED: &str = "Could not update job status.";
const CLEANUP_FAILED: &str = "Could not clean up failed job.";
const CREDITS_FAILED: &str = "Could not perform credit transaction.";
const REFUND_FAILED: &str = "Could not perform credit transaction refund.";
const VOXELYTICS_NOT_ENABLED: &str =
    "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance.";
const AI_INFERENCE_NOT_FOUND: &str = "Could not find requested AI inference.";
const JOBS_PARSING_FAILED: &str = "Parsing failed for a row in webknossos.jobs during list query";

/// JobCommand.highPriorityJobs; every other command is low priority.
const HIGH_PRIORITY_COMMANDS: [&str; 2] = ["convert_to_wkw", "export_tiff"];
/// WKRemoteWorkerController.reserveNextJobs(pendingIterationCount = 10).
const RESERVE_ITERATIONS: usize = 10;

#[derive(Clone)]
struct WorkerRoutes {
    job_token_expiry: Duration,
    token_idle_timeout: Duration,
}

/// `config.job_token_expiry` is silhouette's jobExpiry; `token_idle_timeout` its
/// authenticatorIdleTimeout (shared with Authentication tokens).
pub fn router(config: &JobsConfig, token_idle_timeout: Duration) -> Router<AppState> {
    Router::new()
        .route("/jobs/request", get(request_jobs))
        .route("/jobs/{id}/status", post(update_status))
        .route(
            "/jobs/{id}/attachVoxelyticsWorkflow",
            post(attach_voxelytics_workflow),
        )
        .route(
            "/jobs/{id}/attachDatasetToInference",
            post(attach_dataset_to_inference),
        )
        .layer(Extension(WorkerRoutes {
            job_token_expiry: config.job_token_expiry,
            token_idle_timeout,
        }))
}

#[derive(Deserialize)]
struct KeyQuery {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestQuery {
    key: String,
    worker_version: Option<String>,
}

#[derive(sqlx::FromRow)]
struct Worker {
    id: String,
    data_store: String,
    max_high: i32,
    max_low: i32,
    commands: Vec<String>,
    last_reported_version: Option<String>,
}

impl Worker {
    fn supports(&self, command: &str) -> bool {
        self.commands.iter().any(|supported| supported == command)
    }
}

/// WorkerDAO.findOneByKey (`?~> Msg.Job.workerNotFound`): a missing worker and an
/// unparsable one (unknown supported job command) are both 400 workerNotFound.
async fn find_worker(
    connection: &mut PgConnection,
    key: &str,
    for_update: bool,
) -> ApiResult<Worker> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let query = format!(
        r#"SELECT _id AS id, _dataStore AS data_store, maxParallelHighPriorityJobs AS max_high,
            maxParallelLowPriorityJobs AS max_low, supportedJobCommands AS commands,
            lastReportedVersion AS last_reported_version
          FROM webknossos.workers_ WHERE key = $1{lock}"#
    );
    let worker: Option<Worker> = sqlx::query_as(&query)
        .bind(key)
        .fetch_optional(&mut *connection)
        .await?;
    match worker {
        Some(worker) if worker.commands.iter().all(|c| jobs::is_job_command(c)) => Ok(worker),
        _ => Err(ApiError::bad_request(WORKER_NOT_FOUND)),
    }
}

fn high_priority(command: &str) -> bool {
    HIGH_PRIORITY_COMMANDS.contains(&command)
}

/// The commands of one priority class, optionally restricted to the worker's.
fn commands(high: bool, worker: Option<&Worker>) -> Vec<String> {
    JOB_COMMANDS
        .iter()
        .filter(|command| high_priority(command) == high)
        .filter(|command| worker.is_none_or(|worker| worker.supports(command)))
        .map(|command| (*command).to_owned())
        .collect()
}

/// Worker polling. One transaction holds the worker row lock, so polls of the same
/// worker are serialized (its parallelism limits hold); pending jobs are claimed with
/// `FOR UPDATE SKIP LOCKED` plus `_worker IS NULL`, so no job goes to two workers.
async fn request_jobs(
    State(state): State<AppState>,
    Extension(routes): Extension<WorkerRoutes>,
    Query(query): Query<RequestQuery>,
) -> ApiResult<Json<Value>> {
    let mut transaction = state.pool.begin().await?;
    let worker = find_worker(&mut transaction, &query.key, true).await?;
    // WorkerDAO.updateHeartBeat / updateLastReportedVersion (only if it changed).
    let new_version = query
        .worker_version
        .as_ref()
        .filter(|version| worker.last_reported_version.as_ref() != Some(*version));
    sqlx::query(
        r#"UPDATE webknossos.workers SET lastHeartBeat = NOW(),
            lastReportedVersion = COALESCE($2, lastReportedVersion) WHERE _id = $1"#,
    )
    .bind(&worker.id)
    .bind(new_version)
    .execute(&mut *transaction)
    .await?;
    reserve_next_jobs(&mut transaction, &worker).await?;
    let to_run = worker_jobs(
        &mut transaction,
        &worker.id,
        "j.state IN ('PENDING', 'STARTED') AND j.manualState IS NULL",
    )
    .await?;
    // Jobs cancelled by a user (manualState) that the worker has not cancelled yet.
    let to_cancel = worker_jobs(
        &mut transaction,
        &worker.id,
        "j.state != 'CANCELLED' AND j.manualState = 'CANCELLED'",
    )
    .await?;
    transaction.commit().await?;
    let to_run: Vec<&Job> = to_run
        .iter()
        .filter(|job| !to_cancel.iter().any(|cancelled| cancelled.id == job.id))
        .collect();
    let mut to_run_json = Vec::with_capacity(to_run.len());
    for job in to_run {
        to_run_json.push(parameter_writes(&state.pool, &routes, job).await?);
    }
    let mut to_cancel_json = Vec::with_capacity(to_cancel.len());
    for job in &to_cancel {
        to_cancel_json.push(parameter_writes(&state.pool, &routes, job).await?);
    }
    Ok(Json(
        json!({"to_run": to_run_json, "to_cancel": to_cancel_json}),
    ))
}

/// WKRemoteWorkerController.reserveNextJobs: claim the oldest assignable pending job
/// of the worker's datastore while the worker has free high/low priority slots.
async fn reserve_next_jobs(connection: &mut PgConnection, worker: &Worker) -> ApiResult<()> {
    let all_high = commands(true, None);
    let all_low = commands(false, None);
    let supported_high = commands(true, Some(worker));
    let supported_low = commands(false, Some(worker));
    for _ in 0..RESERVE_ITERATIONS {
        let unfinished_high = count_unfinished(connection, &worker.id, &all_high).await?;
        let unfinished_low = count_unfinished(connection, &worker.id, &all_low).await?;
        let pending_high = count_pending(connection, &worker.data_store, &supported_high).await?;
        let pending_low = count_pending(connection, &worker.data_store, &supported_low).await?;
        let may_assign_high = unfinished_high < i64::from(worker.max_high) && pending_high > 0;
        let may_assign_low = unfinished_low < i64::from(worker.max_low) && pending_low > 0;
        if !may_assign_high && !may_assign_low {
            break;
        }
        let mut assignable = Vec::new();
        if may_assign_low {
            assignable.extend(supported_low.iter().cloned());
        }
        if may_assign_high {
            assignable.extend(supported_high.iter().cloned());
        }
        // JobDAO.reserveNextJob.
        sqlx::query(
            r#"UPDATE webknossos.jobs SET _worker = $1
              WHERE _worker IS NULL AND _id = (
                SELECT _id FROM webknossos.jobs_
                WHERE state = 'PENDING' AND _dataStore = $2 AND manualState IS NULL
                  AND _worker IS NULL AND command = ANY($3)
                ORDER BY created, _id LIMIT 1 FOR UPDATE SKIP LOCKED)"#,
        )
        .bind(&worker.id)
        .bind(&worker.data_store)
        .bind(&assignable)
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

/// JobDAO.countUnfinishedByWorker.
async fn count_unfinished(
    connection: &mut PgConnection,
    worker_id: &str,
    commands: &[String],
) -> ApiResult<i64> {
    if commands.is_empty() {
        return Ok(0);
    }
    Ok(sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM webknossos.jobs_
          WHERE _worker = $1 AND state IN ('PENDING', 'STARTED') AND command = ANY($2)
            AND manualState IS NULL"#,
    )
    .bind(worker_id)
    .bind(commands)
    .fetch_one(&mut *connection)
    .await?)
}

/// JobDAO.countUnassignedPendingForDataStore.
async fn count_pending(
    connection: &mut PgConnection,
    data_store: &str,
    commands: &[String],
) -> ApiResult<i64> {
    if commands.is_empty() {
        return Ok(0);
    }
    Ok(sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM webknossos.jobs_
          WHERE state = 'PENDING' AND command = ANY($2) AND manualState IS NULL
            AND _dataStore = $1 AND _worker IS NULL"#,
    )
    .bind(data_store)
    .bind(commands)
    .fetch_one(&mut *connection)
    .await?)
}

/// JobDAO.findAllUnfinishedByWorker / findAllCancellingByWorker (parseAll).
async fn worker_jobs(
    connection: &mut PgConnection,
    worker_id: &str,
    condition: &str,
) -> ApiResult<Vec<Job>> {
    let query = format!(
        "SELECT {JOB_COLUMNS} FROM webknossos.jobs_ j WHERE j._worker = $1 AND {condition} ORDER BY j.created, j._id"
    );
    let jobs: Vec<Job> = sqlx::query_as(&query)
        .bind(worker_id)
        .fetch_all(&mut *connection)
        .await?;
    if jobs.iter().any(|job| !job.is_valid()) {
        return Err(ApiError::bad_request(JOBS_PARSING_FAILED));
    }
    Ok(jobs)
}

/// JobService.parameterWrites: the job as the worker sees it, with a fresh Job
/// token of the owner (createAndInitJobTokenForUser, old tokens are kept).
async fn parameter_writes(pool: &PgPool, routes: &WorkerRoutes, job: &Job) -> ApiResult<Value> {
    // UserDAO.findOne with global access: an empty Fox when the owner is gone.
    let owner: Option<String> =
        sqlx::query_scalar("SELECT _id FROM webknossos.users_ WHERE _id = $1")
            .bind(&job.owner)
            .fetch_optional(pool)
            .await?;
    let owner = owner.ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    let token = insert_job_token(pool, &owner, routes).await?;
    let mut kwargs = job.args.as_object().cloned().unwrap_or_default();
    kwargs.insert("user_auth_token".into(), Value::String(token));
    Ok(json!({
        "job_id": job.id,
        "command": job.command,
        "job_kwargs": kwargs,
    }))
}

async fn insert_job_token(
    pool: &PgPool,
    user_id: &str,
    routes: &WorkerRoutes,
) -> ApiResult<String> {
    let expiry_ms =
        i64::try_from(routes.job_token_expiry.as_millis()).map_err(|_| ApiError::internal())?;
    let idle_ms =
        i64::try_from(routes.token_idle_timeout.as_millis()).map_err(|_| ApiError::internal())?;
    if expiry_ms <= 0 || idle_ms <= 0 {
        return Err(ApiError::internal());
    }
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    let value = URL_SAFE_NO_PAD.encode(random);
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
          (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
          VALUES ($1, $2, $3, statement_timestamp(),
            statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
            'Job', statement_timestamp())"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .execute(pool)
    .await?;
    Ok(value)
}

/// JobStatus (JsonAutoFormat; absent and null optional fields are None).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobStatus {
    latest_run_id: Option<String>,
    state: JobState,
    return_value: Option<String>,
    #[serde(default, deserialize_with = "crate::instant::optional")]
    started: Option<DateTime<Utc>>,
    #[serde(default, deserialize_with = "crate::instant::optional")]
    ended: Option<DateTime<Utc>>,
    error_details: Option<Map<String, Value>>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::upper_case_acronyms)]
enum JobState {
    PENDING,
    STARTED,
    SUCCESS,
    FAILURE,
    CANCELLED,
}

impl JobState {
    fn as_str(self) -> &'static str {
        JOB_STATES[self as usize]
    }
}

/// Worker status report. Deviation from Scala (separate auto-commits): the status
/// update, failed-conversion cleanup and credit completion/refund run in one
/// transaction holding the job row lock, so a failing step leaves the job unchanged
/// and concurrent reports for one job cannot complete or refund credits twice.
/// Notifications and upload cleanup are fire-and-forget after the commit.
#[allow(clippy::too_many_arguments)]
async fn update_status(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(mailer): Extension<MailSender>,
    Extension(clients): Extension<ServiceClients>,
    slack: SlackNotificationService,
    Path(id): Path<PathObjectId>,
    Query(query): Query<KeyQuery>,
    JsonBody(status): JsonBody<JobStatus>,
) -> ApiResult<Response> {
    let mut transaction = state.pool.begin().await?;
    find_worker(&mut transaction, &query.key, false).await?;
    // JobDAO.findOne with global access.
    let before = find_job_global(&mut transaction, id.as_str(), true)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    // JobDAO.updateStatus: absent optional fields are written as NULL.
    sqlx::query(
        r#"UPDATE webknossos.jobs SET latestRunId = $2, latestRunErrorDetails = $3,
            state = $4::webknossos.JOB_STATE, returnValue = $5, started = $6, ended = $7
          WHERE _id = $1"#,
    )
    .bind(&before.id)
    .bind(&status.latest_run_id)
    .bind(status.error_details.clone().map(Value::Object))
    .bind(status.state.as_str())
    .bind(&status.return_value)
    .bind(status.started)
    .bind(status.ended)
    .execute(&mut *transaction)
    .await
    .map_err(|error| failure_as(error, UPDATE_STATUS_FAILED))?;
    let after = find_job_global(&mut transaction, &before.id, false)
        .await
        .map_err(|error| replace_failure(error, JOB_NOT_FOUND))?
        .ok_or_else(|| ApiError::bad_request(JOB_NOT_FOUND))?;
    clean_up_if_failed(&mut transaction, &after).await?;
    if status.state == JobState::SUCCESS {
        complete_transaction_of_job(&mut transaction, &after.id)
            .await
            .map_err(|error| replace_failure(error, CREDITS_FAILED))?;
    }
    if before.state != status.state.as_str()
        && matches!(status.state, JobState::FAILURE | JobState::CANCELLED)
    {
        jobs::refund_transaction_for_job(
            &mut transaction,
            &before.id,
            status.state == JobState::CANCELLED,
        )
        .await
        .map_err(|error| replace_failure(error, REFUND_FAILED))?;
    }
    transaction.commit().await?;
    track_status_change(&state, &misc, &mailer, &slack, &before, &after);
    clean_up_upload_files_if_needed(&state, &clients, &before, &after);
    Ok(ok_empty())
}

async fn find_job_global(
    connection: &mut PgConnection,
    job_id: &str,
    for_update: bool,
) -> ApiResult<Option<Job>> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let query = format!("SELECT {JOB_COLUMNS} FROM webknossos.jobs_ j WHERE j._id = $1{lock}");
    let job: Option<Job> = sqlx::query_as(&query)
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

/// `?~> message` replaces failure messages; server errors stay server errors.
fn replace_failure(error: ApiError, message: &str) -> ApiError {
    if error.status.is_server_error() {
        error
    } else {
        ApiError::bad_request(message)
    }
}

/// Constraint, data and trigger violations are Fox failures (400 with `message`).
fn failure_as(error: sqlx::Error, message: &str) -> ApiError {
    if let sqlx::Error::Database(database) = &error
        && database.code().is_some_and(|code| {
            code.starts_with("23") || code.starts_with("22") || code.starts_with("P0")
        })
    {
        return ApiError::bad_request(message);
    }
    error.into()
}

/// JobService.cleanUpIfFailed: a failed WKW conversion removes its dataset from the
/// database (DatasetDAO.deleteDataset), freeing the directory name.
async fn clean_up_if_failed(connection: &mut PgConnection, job: &Job) -> ApiResult<()> {
    if job.state != "FAILURE" || job.command != "convert_to_wkw" {
        return Ok(());
    }
    let string_arg = |key: &str| job.args.get(key).and_then(Value::as_str);
    let (Some(directory_name), Some(organization)) = (
        string_arg("dataset_directory_name"),
        string_arg("organization_id"),
    ) else {
        return Err(ApiError::bad_request(CLEANUP_FAILED));
    };
    tracing::info!(
        job = %job.id,
        "WKW conversion job failed. Deleting dataset from the database, freeing the directoryName..."
    );
    let dataset: Option<String> = sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.datasets_ WHERE directoryName = $1 AND _organization = $2
          ORDER BY created, _id LIMIT 1"#,
    )
    .bind(directory_name)
    .bind(organization)
    .fetch_optional(&mut *connection)
    .await?;
    let dataset = dataset.ok_or_else(|| ApiError::bad_request(CLEANUP_FAILED))?;
    for statement in [
        "DELETE FROM webknossos.dataset_mags WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layers WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $1",
        "DELETE FROM webknossos.datasets WHERE _id = $1",
    ] {
        sqlx::query(statement)
            .bind(&dataset)
            .execute(&mut *connection)
            .await
            .map_err(|error| failure_as(error, CLEANUP_FAILED))?;
    }
    Ok(())
}

/// CreditTransactionService.completeTransactionOfJob (global access): the pending
/// reservation of the job, if any, becomes spent.
async fn complete_transaction_of_job(connection: &mut PgConnection, job_id: &str) -> ApiResult<()> {
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
    sqlx::query(
        r#"UPDATE webknossos.credit_transactions
          SET transaction_state = 'Complete', credit_state = 'Spent', updated_at = NOW()
          WHERE _id = $1"#,
    )
    .bind(&transaction_id)
    .execute(&mut *connection)
    .await
    .map_err(|error| failure_as(error, CREDITS_FAILED))?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Owner {
    id: String,
    organization: String,
    organization_name: String,
    is_admin: bool,
    is_dataset_manager: bool,
    is_superuser: bool,
    first_name: String,
    last_name: String,
    email: String,
}

/// JobService.trackStatusChange: fire-and-forget log, Slack, analytics and
/// mail notifications for newly succeeded/failed jobs. The Mailchimp tag is
/// not ported.
fn track_status_change(
    state: &AppState,
    misc: &MiscState,
    mailer: &MailSender,
    slack: &SlackNotificationService,
    before: &Job,
    after: &Job,
) {
    if matches!(before.effective_state(), "SUCCESS" | "FAILURE") {
        return;
    }
    let succeeded = after.state == "SUCCESS";
    if !succeeded && after.state != "FAILURE" {
        return;
    }
    let (state, misc, mailer, slack, after) = (
        state.clone(),
        misc.clone(),
        mailer.clone(),
        slack.clone(),
        after.clone(),
    );
    tokio::spawn(async move {
        let owner: Option<Owner> = sqlx::query_as(
            r#"SELECT u._id AS id, u._organization AS organization, o.name AS organization_name,
                u.isAdmin AS is_admin, u.isDatasetManager AS is_dataset_manager,
                m.isSuperUser AS is_superuser, m.firstName AS first_name, m.lastName AS last_name,
                m.email
              FROM webknossos.users_ u
              JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
              JOIN webknossos.organizations_ o ON o._id = u._organization
              WHERE u._id = $1"#,
        )
        .bind(&after.owner)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        let Some(owner) = owner else {
            return;
        };
        let public_uri = misc.config().public_uri.clone();
        let superuser_label = if owner.is_superuser {
            " (for superuser)"
        } else {
            ""
        };
        let duration_label =
            slack::job_duration_label(after.created, after.started, after.ended, after.last_retry);
        let workflow_link =
            slack::workflow_link_slack_formatted(&public_uri, after.workflow_hash.as_deref());
        if succeeded {
            let result_link_public = jobs::result_link(
                &after.command,
                after.effective_state(),
                &after.args,
                after.return_value.as_deref(),
                &after.id,
                &owner.organization,
            )
            .map(|link| {
                if link.starts_with('/') {
                    format!("{public_uri}{link}")
                } else {
                    link
                }
            });
            let msg = format!(
                "Job `{}` succeeded{duration_label}. Command `{}`, organization: {}.{}{workflow_link}",
                after.id,
                after.command,
                owner.organization_name,
                slack::result_link_slack_formatted(result_link_public.as_deref()),
            );
            tracing::info!("{msg}");
            slack.success(&format!("Successful job{superuser_label}"), &msg);
            let link = result_link_public.unwrap_or_else(|| public_uri.clone());
            if let Some(mail) = success_mail(&owner, &after, &link) {
                mailer.send(mail);
            }
        } else {
            let msg = format!(
                "Job `{}` failed{duration_label}. Command `{}`, organization: {}.{workflow_link}",
                after.id, after.command, owner.organization_name,
            );
            tracing::warn!("{msg}");
            slack.warn(&format!("Failed job{superuser_label}"), &msg);
            let user = AuthUser {
                id: owner.id.clone(),
                organization_id: owner.organization.clone(),
                is_admin: owner.is_admin,
                is_dataset_manager: owner.is_dataset_manager,
                is_superuser: owner.is_superuser,
            };
            let mut properties = Map::new();
            properties.insert("command".into(), Value::String(after.command.clone()));
            crate::analytics::track(&state, &misc, &user, "failed_job".into(), properties);
            if !after.retried_by_superuser {
                mailer.send(failure_mail(&owner, &after));
            }
        }
    });
}

fn dataset_name(job: &Job) -> &str {
    job.args
        .get("dataset_name")
        .and_then(Value::as_str)
        .unwrap_or("")
}

/// JobService.sendSuccessEmailNotification: DefaultMails per job command.
fn success_mail(owner: &Owner, job: &Job, link: &str) -> Option<Mail> {
    let name = format!("{} {}", owner.first_name, owner.last_name);
    let email = owner.email.as_str();
    let dataset = dataset_name(job);
    let generic = |title: &str, description: &str| {
        templates::job_successful_generic(&name, email, dataset, link, title, description)
    };
    Some(match job.command.as_str() {
        "convert_to_wkw" => templates::job_successful_upload_convert(&name, email, dataset, link),
        "export_tiff" => generic(
            "TIFF / OME-Zarr Export",
            "Your data export is ready for download.",
        ),
        "infer_neurons" => templates::job_successful_neuron_segmentation(&name, email, link),
        "infer_instances" => generic(
            "Instance Segmentation",
            "Your instance segmentation is ready.",
        ),
        "infer_mitochondria" => templates::job_successful_mito_segmentation(&name, email, link),
        "align_sections" => templates::job_successful_alignment(&name, email, dataset, link),
        "train_neuron_model" | "train_instance_model" => {
            templates::job_successful_model_training(&name, email, link)
        }
        "materialize_volume_annotation" => generic(
            "Volume Annotation Merged",
            "Your volume annotation has been successfully merged with the existing segmentation. The result is available as a new dataset in your dashboard.",
        ),
        "compute_mesh_file" => generic(
            "Mesh Generation",
            "Your 3D meshes for the whole segmentation layer of your dataset are ready. Load pre-computed meshes by right-clicking any segment and choosing the corresponding option for near instant visualizations.",
        ),
        "render_animation" => generic(
            "Dataset Animation",
            "Your WEBKNOSSOS dataset animation is ready.",
        ),
        _ => return None,
    })
}

/// DefaultMails.jobFailedUploadConvertMail / jobFailedGenericMail.
fn failure_mail(owner: &Owner, job: &Job) -> Mail {
    let name = format!("{} {}", owner.first_name, owner.last_name);
    let dataset = dataset_name(job);
    let error = job
        .error_details
        .as_ref()
        .and_then(|details| details.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty());
    if job.command == "convert_to_wkw" {
        templates::job_failed_upload_convert(&name, &owner.email, dataset, error)
    } else {
        templates::job_failed_generic(&name, &owner.email, dataset, &job.command, error)
    }
}

/// JobService.cleanUpUploadFilesIfNeeded: once a WKW conversion ends, ask its
/// datastore to remove the upload files (fire-and-forget RPC).
fn clean_up_upload_files_if_needed(
    state: &AppState,
    clients: &ServiceClients,
    before: &Job,
    after: &Job,
) {
    let just_ended = before.state != after.state
        && matches!(after.state.as_str(), "SUCCESS" | "FAILURE" | "CANCELLED");
    if after.command != "convert_to_wkw" || !just_ended {
        return;
    }
    let string_arg = |key: &str| {
        after
            .args
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let (Some(organization), Some(directory_name)) = (
        string_arg("organization_id"),
        string_arg("dataset_directory_name"),
    ) else {
        return;
    };
    let (pool, clients, data_store, job_id) = (
        state.pool.clone(),
        clients.clone(),
        after.data_store.clone(),
        after.id.clone(),
    );
    tokio::spawn(async move {
        // DataStoreDAO.findOneByName with global access.
        let url: Option<String> =
            sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name = $1")
                .bind(&data_store)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();
        let Some(url) = url else {
            return;
        };
        let result = clients
            .request(
                Method::DELETE,
                &url,
                &[
                    "data",
                    "datasets",
                    "upload",
                    "dataset",
                    "cleanUpUploadFiles",
                ],
                &[
                    ("organizationId", organization),
                    ("directoryName", directory_name),
                    ("jobId", job_id.clone()),
                ],
                None,
            )
            .await;
        if result.is_err() {
            tracing::warn!(job = %job_id, "Could not clean up upload files of conversion job");
        }
    });
}

/// JobDAO.organizationIdForJobId (base tables, `?~> Msg.Job.notFound`).
async fn organization_for_job(connection: &mut PgConnection, job_id: &str) -> ApiResult<String> {
    let organization: Option<String> = sqlx::query_scalar(
        r#"SELECT u._organization FROM webknossos.users u
          JOIN webknossos.jobs j ON j._owner = u._id WHERE j._id = $1"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *connection)
    .await?;
    organization.ok_or_else(|| ApiError::bad_request(JOB_NOT_FOUND))
}

async fn attach_voxelytics_workflow(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Path(id): Path<PathObjectId>,
    Query(query): Query<KeyQuery>,
    JsonBody(workflow_hash): JsonBody<String>,
) -> ApiResult<Response> {
    let mut transaction = state.pool.begin().await?;
    find_worker(&mut transaction, &query.key, false).await?;
    let voxelytics_enabled = misc
        .config()
        .features
        .get("voxelyticsEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !voxelytics_enabled {
        return Err(ApiError::bad_request(VOXELYTICS_NOT_ENABLED));
    }
    let organization = organization_for_job(&mut transaction, id.as_str()).await?;
    // findWorkflowByHashAndOrganization, else upsertWorkflow with a placeholder name.
    // DO NOTHING keeps a concurrently created workflow's real name.
    sqlx::query(
        r#"INSERT INTO webknossos.voxelytics_workflows (hash, name, _organization)
          VALUES ($1, 'initializing worker workflow', $2)
          ON CONFLICT (_organization, hash) DO NOTHING"#,
    )
    .bind(&workflow_hash)
    .bind(&organization)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("UPDATE webknossos.jobs SET _voxelytics_workflowHash = $2 WHERE _id = $1")
        .bind(id.as_str())
        .bind(&workflow_hash)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(ok_empty())
}

async fn attach_dataset_to_inference(
    State(state): State<AppState>,
    Path(id): Path<PathObjectId>,
    Query(query): Query<KeyQuery>,
    JsonBody(directory_name): JsonBody<String>,
) -> ApiResult<Response> {
    let mut transaction = state.pool.begin().await?;
    find_worker(&mut transaction, &query.key, false).await?;
    let organization = organization_for_job(&mut transaction, id.as_str()).await?;
    // DatasetDAO.findOneByDirectoryNameAndOrganization with global access (empty Fox).
    let dataset: Option<String> = sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.datasets_ WHERE directoryName = $1 AND _organization = $2
          ORDER BY created, _id LIMIT 1"#,
    )
    .bind(&directory_name)
    .bind(&organization)
    .fetch_optional(&mut *transaction)
    .await?;
    let dataset = dataset.ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    // AiInferenceDAO.findOneByJobId (`?~> Msg.AiInference.notFound`).
    let inference: Option<String> = sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.aiInferences_ WHERE _inferenceJob = $1
          ORDER BY created, _id LIMIT 1 FOR UPDATE"#,
    )
    .bind(id.as_str())
    .fetch_optional(&mut *transaction)
    .await?;
    let inference = inference.ok_or_else(|| ApiError::bad_request(AI_INFERENCE_NOT_FOUND))?;
    sqlx::query("UPDATE webknossos.aiInferences SET _newDataset = $2 WHERE _id = $1")
        .bind(&inference)
        .bind(&dataset)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(ok_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_classes_partition_the_commands() {
        let high = commands(true, None);
        let low = commands(false, None);
        assert_eq!(high, vec!["convert_to_wkw", "export_tiff"]);
        assert_eq!(high.len() + low.len(), JOB_COMMANDS.len());
        assert!(low.contains(&"infer_nuclei".to_owned()));
    }

    #[test]
    fn job_states_map_to_their_names() {
        assert_eq!(JobState::PENDING.as_str(), "PENDING");
        assert_eq!(JobState::CANCELLED.as_str(), "CANCELLED");
        let status: JobStatus = serde_json::from_value(json!({
            "state": "SUCCESS", "started": 1000, "ended": "1970-01-01T00:00:02Z",
            "latestRunId": null, "errorDetails": {"message": "x"}
        }))
        .unwrap();
        assert!(status.state == JobState::SUCCESS);
        assert_eq!(status.started.unwrap().timestamp_millis(), 1000);
        assert_eq!(status.ended.unwrap().timestamp_millis(), 2000);
        assert!(serde_json::from_value::<JobStatus>(json!({"state": "DONE"})).is_err());
        assert!(
            serde_json::from_value::<JobStatus>(json!({"state": "FAILURE", "errorDetails": 1}))
                .is_err()
        );
    }
}
