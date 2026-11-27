//! Alignment project input data cleanup: the `IntervalScheduler` of Scala's
//! `AlignmentProjectService` (interval `webKnossos.alignmentProjects.inputDataCleanupInterval`,
//! default 6 h, the default initial delay of 10 s, always enabled).
//!
//! Uploaded input data is only kept for `inputDataRetention` (default 90 days) after the project
//! was created, instead of counting towards the storage quota. Every tick deletes the input data
//! (`AlignmentProjectService.deleteInputData`) of all projects created before `now - retention`
//! whose input data still exists, abandoned uploads included; projects with pending or running
//! jobs are skipped until those have finished. Failures are counted and logged, the other
//! projects are still processed.
//!
//! Cross-instance serialization follows the other jobs with datastore RPCs: a tick holds
//! `pg_try_advisory_xact_lock(advisory_lock_key("alignment-project-cleanup"))` for the whole run
//! and is skipped while another instance holds it. Play takes no lock; a parallel Play run only
//! deletes paths that are already gone.
use std::time::Duration;

use chrono::Utc;
use sqlx::PgPool;

use crate::{
    alignment_project::{
        AlignmentProjectsConfig, alignment_project_dao,
        service::{AlignmentProject, delete_input_data},
    },
    background::scheduler::{
        Job, JobError, JobOutcome, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    stores::client::ServiceClients,
};

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "alignment-project-cleanup";

/// One tick: advisory lock (skip if held elsewhere), then delete the expired input data.
pub async fn run_cleanup(
    pool: &PgPool,
    clients: &ServiceClients,
    input_data_retention: Duration,
) -> Result<JobOutcome, JobError> {
    let mut lock = pool.begin().await?;
    if !try_advisory_xact_lock(&mut lock, advisory_lock_key(JOB_NAME)).await? {
        lock.rollback().await?;
        return Ok(JobOutcome::SkippedLocked);
    }
    let created_before = Utc::now() - chrono::Duration::from_std(input_data_retention)?;
    let rows =
        alignment_project_dao::find_all_with_expired_input_data(&mut lock, created_before).await?;
    let total = rows.len();
    let mut failed = 0;
    for row in rows {
        let (id, name) = (row.id.clone(), row.name.clone());
        tracing::info!(
            alignment_project = %id,
            "Deleting expired input data of alignment project {id} ({name})..."
        );
        let result = match AlignmentProject::parse(row) {
            Ok(project) => delete_input_data(pool, clients, &project).await,
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            failed += 1;
            tracing::warn!(
                alignment_project = %id,
                error = %error.message,
                status = %error.status,
                "Could not delete the expired input data of alignment project {id}: {}",
                error.message
            );
        }
    }
    if failed > 0 {
        tracing::warn!("Could not delete the expired input data of {failed} alignment projects.");
    }
    lock.commit().await?;
    Ok(JobOutcome::Completed(format!(
        "Deleted the expired input data of {} alignment projects ({failed} failed).",
        total - failed
    )))
}

/// Scheduler with the cleanup job registered (also when disabled, so that is logged).
pub fn scheduler(
    pool: PgPool,
    clients: ServiceClients,
    config: &AlignmentProjectsConfig,
) -> Scheduler {
    let mut scheduler = Scheduler::new();
    let retention = config.input_data_retention;
    scheduler.add(Job::new(JOB_NAME, config.input_data_cleanup, move || {
        let pool = pool.clone();
        let clients = clients.clone();
        async move { run_cleanup(&pool, &clients, retention).await }
    }));
    scheduler
}

/// Starts the cleanup on the current runtime. Call [`SchedulerHandle::shutdown`] before closing
/// the pool.
pub fn spawn(
    pool: PgPool,
    clients: ServiceClients,
    config: &AlignmentProjectsConfig,
) -> SchedulerHandle {
    scheduler(pool, clients, config).spawn()
}
