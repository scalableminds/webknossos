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
    error::ApiError,
    job::routes::{JobCompactInfo, NOT_ENOUGH_CREDITS},
    organization::pricing::PricingPlan,
    system::application_info::MiscState,
    util::id::ObjectId,
};
use webknossos_common::geometry::BoundingBox;

const NO_WORKER: &str =
    "No worker supporting the requested job is available for the selected data store.";
const PAID_NO_ADMIN_OR_MANAGER: &str =
    "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers.";
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

/// JobService.assertCustomConfigurationAllowed: arbitrary workflow config
/// overrides are reserved for super users (`assertIsSuperUser ~> FORBIDDEN`).
pub(crate) fn assert_custom_configuration_allowed(
    custom_configuration: Option<&Map<String, Value>>,
    user: &AuthUser,
) -> Result<(), Failure> {
    if custom_configuration.is_some_and(|configuration| !configuration.is_empty())
        && !user.is_superuser
    {
        return Err(
            Failure::new(crate::msg::user::SUPER_USER_ONLY).with_param(StatusCode::FORBIDDEN)
        );
    }
    Ok(())
}

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

/// JobService.assertJobsAllowedByPricingPlan `~> FORBIDDEN`.
pub(crate) fn assert_jobs_allowed_by_pricing_plan(pricing_plan: Option<String>) -> RunResult<()> {
    let pricing_plan = pricing_plan
        .as_deref()
        .and_then(PricingPlan::parse)
        .ok_or_else(|| RunError::Api(ApiError::internal()))?;
    if !pricing_plan.allows_jobs() {
        return Err(Failure::with_status(
            crate::msg::job::NOT_AVAILABLE_IN_PLAN,
            StatusCode::FORBIDDEN,
        )
        .into());
    }
    Ok(())
}

/// JobService.assertJobCanBeSubmitted: jobs enabled, the organization's
/// pricing plan allows jobs, a worker of the datastore supports the command,
/// storage quota.
async fn assert_job_can_be_submitted(
    connection: &mut PgConnection,
    enabled: bool,
    user: &AuthUser,
    submission: &Submission<'_>,
) -> RunResult<()> {
    if !enabled {
        return Err(Failure::new(crate::msg::job::NOT_ENABLED).into());
    }
    let pricing_plan =
        job_submission_dao::find_pricing_plan(&mut *connection, &user.organization_id)
            .await?
            .ok_or_else(|| {
                Failure::new(crate::msg::organization::not_found(&user.organization_id))
            })?;
    assert_jobs_allowed_by_pricing_plan(Some(pricing_plan))?;
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
    assert_storage_not_exceeded(connection, submission.command, &user.organization_id).await
}

/// JobService.submitJob: [`assert_job_can_be_submitted`], then insert the
/// pending job. Returns the new job id.
pub(crate) async fn submit_job(
    connection: &mut PgConnection,
    enabled: bool,
    user: &AuthUser,
    submission: &Submission<'_>,
) -> RunResult<ObjectId> {
    assert_job_can_be_submitted(connection, enabled, user, submission).await?;
    insert_job(connection, user, submission).await
}

/// JobService.insertJob. Callers have to check [`assert_job_can_be_submitted`] first.
async fn insert_job(
    connection: &mut PgConnection,
    user: &AuthUser,
    submission: &Submission<'_>,
) -> RunResult<ObjectId> {
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

/// JobService.submitPaidJob: paid-job permission, [`assert_job_can_be_submitted`]
/// (checked before reserving the credits, so that failures are reported with
/// their specific error), cost, balance, the pending credit reservation and the
/// job, all in the job's transaction. Database errors roll everything back
/// (Play refunds a failed job insert instead).
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
) -> RunResult<ObjectId> {
    if !may_start_paid_jobs {
        return Err(Failure::new(PAID_NO_ADMIN_OR_MANAGER).into());
    }
    assert_job_can_be_submitted(connection, enabled, user, submission).await?;
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
    let job_id = insert_job(connection, user, submission).await?;
    job_submission_dao::update_credit_transaction_paid_job(connection, &transaction_id, &job_id)
        .await?;
    Ok(job_id)
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
/// paid-job permission (dataset manager, team manager or admin), jobs enabled,
/// pricing plan, worker support, storage quota, cost from
/// `bounding_box_in_target_mag` and balance. Every failure rolls back.
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
    let job_id = submit_paid_job(
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
    Ok(PendingPaidJob {
        transaction,
        job_id,
        command: submission.command,
    })
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
