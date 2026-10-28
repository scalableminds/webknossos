//! JobService.submitJob / submitPaidJob: worker selection, storage quota and credit reservation.
use axum::{Json, http::StatusCode};
use serde_json::{Map, Value, json};
use sqlx::PgConnection;

use super::{
    failure::{Failure, RunError, RunResult},
    job_submission_dao::{self},
};
use crate::{
    AppState,
    auth::AuthUser,
    job::routes::{JobCompactInfo, NOT_ENOUGH_CREDITS},
    system::application_info::MiscState,
    util::id::ObjectId,
};
use webknossos_common::geometry::BoundingBox;

const NO_WORKER: &str =
    "No worker supporting the requested job is available for the selected data store.";
const PAID_NO_ADMIN_OR_MANAGER: &str =
    "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers.";
const SUBMIT_FAILED: &str = "Could not submit job.";
pub(super) const STORAGE_EXCEEDED: &str = "Cannot start this job because the storage quota of the organization is exceeded, so its results could not be stored. Please free up storage or upgrade your plan.";
pub(super) const ORGANIZATION_STORAGE_EXCEEDED: &str =
    "The storage quota of the organization is exceeded.";

/// JobCommand.jobsWritingToStorage: refused while the storage quota is exceeded.
const JOBS_WRITING_TO_STORAGE: [&str; 7] = [
    "align_sections",
    "compute_mesh_file",
    "compute_segment_index_file",
    "infer_instances",
    "infer_mitochondria",
    "infer_neurons",
    "materialize_volume_annotation",
];

/// A job to submit: JobCommand, commandArgs and the datastore whose workers run it.
pub(crate) struct Submission<'a> {
    pub(crate) command: &'static str,
    pub(crate) args: Value,
    pub(crate) data_store: &'a str,
}

/// OrganizationService.assertUsedStorageNotExceeded for storage-writing commands,
/// `?~> Msg.Job.storageExceeded ~> FORBIDDEN`.
async fn assert_storage_not_exceeded(
    connection: &mut PgConnection,
    command: &str,
    organization: &str,
) -> RunResult<()> {
    if !JOBS_WRITING_TO_STORAGE.contains(&command) {
        return Ok(());
    }
    let included: Option<i64> = job_submission_dao::find_included_storage(connection, organization)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(organization)))?;
    let Some(included) = included else {
        return Ok(());
    };
    let used: i64 = job_submission_dao::find_used_storage_bytes(connection, organization).await?;
    if used > included {
        return Err(Failure::new(ORGANIZATION_STORAGE_EXCEEDED)
            .wrap(STORAGE_EXCEEDED)
            .with_param(StatusCode::FORBIDDEN)
            .into());
    }
    Ok(())
}

/// JobService.submitJob: jobs enabled, a worker of the datastore supports the
/// command, storage quota, insert the pending job. Returns the new job id.
pub(crate) async fn submit_job(
    connection: &mut PgConnection,
    enabled: bool,
    user: &AuthUser,
    submission: &Submission<'_>,
) -> RunResult<ObjectId> {
    if !enabled {
        return Err(Failure::new(crate::msg::job::NOT_ENABLED).into());
    }
    // WorkerDAO.findAllByDataStore: union of all workers' supported commands;
    // an unparsable worker row fails the lookup.
    let commands: Vec<Vec<String>> = job_submission_dao::find_supported_job_commands_by_data_store(
        connection,
        submission.data_store,
    )
    .await?;
    let parsable = commands
        .iter()
        .flatten()
        .all(|command| crate::job::routes::is_job_command(command));
    if !parsable
        || !commands
            .iter()
            .flatten()
            .any(|command| command == submission.command)
    {
        return Err(Failure::new(NO_WORKER).into());
    }
    assert_storage_not_exceeded(connection, submission.command, &user.organization_id).await?;
    let job_id = ObjectId::new();
    job_submission_dao::insert_one(
        connection,
        &job_id,
        &user.id,
        submission.data_store,
        submission.command,
        &submission.args,
    )
    .await?;
    Ok(job_id)
}

enum PaidSubmission {
    Submitted(ObjectId),
    /// Expected submission failures retain Scala's reservation/refund audit pair.
    Refunded(Failure),
}

/// JobService.submitPaidJob: paid-job permission, storage quota, cost, balance and
/// the pending credit reservation, all in the job's transaction. An expected
/// submission failure commits a refunded audit pair; database errors roll back.
#[allow(clippy::too_many_arguments)]
async fn submit_paid_job(
    connection: &mut PgConnection,
    enabled: bool,
    may_start_paid_jobs: bool,
    misc: &MiscState,
    user: &AuthUser,
    submission: &Submission<'_>,
    bounding_box_in_target_mag: BoundingBox,
    comment: &str,
) -> RunResult<PaidSubmission> {
    if !may_start_paid_jobs {
        return Err(Failure::new(PAID_NO_ADMIN_OR_MANAGER).into());
    }
    assert_storage_not_exceeded(connection, submission.command, &user.organization_id).await?;
    let cost = crate::job::routes::job_cost_in_milli_credits(
        &misc.config().features,
        submission.command,
        &bounding_box_in_target_mag,
    )
    .map_err(Failure::new)?;
    let balance =
        crate::job::job_dao::get_milli_credit_balance(connection, &user.id, &user.organization_id)
            .await?;
    if balance < i64::from(cost) {
        return Err(Failure::new(NOT_ENOUGH_CREDITS).into());
    }
    let transaction_id = ObjectId::new();
    job_submission_dao::insert_pending_credit_transaction(
        connection,
        &transaction_id,
        &user.organization_id,
        -cost,
        comment,
    )
    .await
    .map_err(crate::organization::credit_transactions::balance_error)?;
    let job_id = match submit_job(connection, enabled, user, submission).await {
        Ok(job_id) => job_id,
        Err(RunError::Failure(_)) => {
            job_submission_dao::insert_refund_credit_transaction(
                connection,
                &ObjectId::new(),
                &user.organization_id,
                &transaction_id,
                cost,
                &format!("Refund for transaction {transaction_id}."),
            )
            .await?;
            job_submission_dao::update_credit_transaction_refunded(connection, &transaction_id)
                .await?;
            return Ok(PaidSubmission::Refunded(Failure::new(SUBMIT_FAILED)));
        }
        Err(error) => return Err(error),
    };
    job_submission_dao::update_credit_transaction_paid_job(connection, &transaction_id, &job_id)
        .await?;
    Ok(PaidSubmission::Submitted(job_id))
}

/// A paid job (job row plus its pending credit reservation) inserted in a still
/// open serializable transaction. Callers that create dependent rows (AI models,
/// AI inferences) insert them through [`PendingPaidJob::connection`] so the job,
/// the reservation and those rows commit or roll back together, then call
/// [`PendingPaidJob::commit`]. Dropping it rolls everything back.
pub(crate) struct PendingPaidJob {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    job_id: ObjectId,
    command: &'static str,
}

impl PendingPaidJob {
    pub(crate) fn job_id(&self) -> &ObjectId {
        &self.job_id
    }

    pub(crate) fn connection(&mut self) -> &mut PgConnection {
        &mut self.transaction
    }

    /// Commits and tracks JobService.submitJob's RunJobEvent. Returns the job id.
    pub(crate) async fn commit(
        self,
        state: &AppState,
        misc: &MiscState,
        user: &AuthUser,
    ) -> RunResult<ObjectId> {
        self.transaction.commit().await?;
        let mut properties = Map::new();
        properties.insert("command".into(), json!(self.command));
        crate::system::analytics::track(state, misc, user, "run_job".into(), properties);
        Ok(self.job_id)
    }
}

/// JobService.submitPaidJob `?~> submit_failed` for routes outside JobController:
/// paid-job permission (dataset manager, team manager or admin), storage quota,
/// cost from `bounding_box_in_target_mag`, balance, worker support and jobs
/// enabled. Expected failures after the reservation commit Scala's
/// reservation/refund audit pair before failing; every other failure rolls back.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn begin_paid_job(
    state: &AppState,
    misc: &MiscState,
    jobs_enabled: bool,
    user: &AuthUser,
    submission: &Submission<'_>,
    bounding_box_in_target_mag: BoundingBox,
    comment: &str,
    submit_failed: &str,
) -> RunResult<PendingPaidJob> {
    let may_start_paid_jobs = user.is_dataset_manager
        || user
            .is_team_manager_or_admin(&state.pool)
            .await
            .map_err(RunError::Api)?;
    let mut transaction = crate::db::begin_serializable(&state.pool).await?;
    let outcome = submit_paid_job(
        &mut transaction,
        jobs_enabled,
        may_start_paid_jobs,
        misc,
        user,
        submission,
        bounding_box_in_target_mag,
        comment,
    )
    .await
    .map_err(|error| error.wrap(submit_failed))?;
    match outcome {
        PaidSubmission::Submitted(job_id) => Ok(PendingPaidJob {
            transaction,
            job_id,
            command: submission.command,
        }),
        PaidSubmission::Refunded(failure) => {
            transaction.commit().await?;
            Err(failure.wrap(submit_failed).into())
        }
    }
}

/// Submit (paid or not) in one transaction, track the RunJobEvent and answer
/// with JobService.publicWrites. Submission failures are wrapped by `submit_failed`.
pub(super) async fn run_submission(
    state: &AppState,
    misc: &MiscState,
    jobs_enabled: bool,
    user: &AuthUser,
    submission: Submission<'_>,
    paid: Option<(BoundingBox, String)>,
    submit_failed: &str,
) -> RunResult<Json<JobCompactInfo>> {
    let job_id = match paid {
        None => {
            let mut transaction = state.pool.begin().await?;
            let job_id = submit_job(&mut transaction, jobs_enabled, user, &submission)
                .await
                .map_err(|error| error.wrap(submit_failed))?;
            transaction.commit().await?;
            let mut properties = Map::new();
            properties.insert("command".into(), json!(submission.command));
            crate::system::analytics::track(state, misc, user, "run_job".into(), properties);
            job_id
        }
        Some((bounding_box, comment)) => {
            begin_paid_job(
                state,
                misc,
                jobs_enabled,
                user,
                &submission,
                bounding_box,
                &comment,
                submit_failed,
            )
            .await?
            .commit(state, misc, user)
            .await?
        }
    };
    let mut connection = state.pool.acquire().await?;
    let job = crate::job::routes::find_job(&mut connection, &user.id, &job_id)
        .await?
        .ok_or_else(|| Failure::with_status(crate::msg::NOT_FOUND, StatusCode::NOT_FOUND))?;
    Ok(Json(
        crate::job::routes::public_writes(&mut connection, &user.id, &job).await?,
    ))
}
