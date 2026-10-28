//! Worker liveness monitor: Scala `WorkerLivenessService` (`app/models/job/Worker.scala`, an
//! `IntervalScheduler` with initial delay 1 min and interval 1 min, always enabled).
//!
//! Every tick loads all non-deleted workers (`WorkerDAO.findAll`, the `workers_` view) and, per
//! worker:
//! - heartbeat not recent (`now - lastHeartBeat < jobs.workerLivenessTimeout` is false) and the
//!   worker is not in the in-memory "reported as dead" store: Slack warn `Worker missing` (plus a
//!   warn log) and insert it into the store for `jobs.workerLivenessReReportInterval` (1 h). Once
//!   that entry expires while the worker is still missing, the next tick reports it again.
//! - heartbeat recent and the worker is in the store: Slack success `Worker return` (plus an info
//!   log) and remove it from the store.
//!
//! The liveness timeout is the existing `WK_WORKER_LIVENESS_TIMEOUT_SECONDS`
//! (`Config.jobs.worker_liveness_timeout`, also used for `lastHeartBeatIsRecent` in the API) and
//! is passed to [`spawn`].
//!
//! Cross-instance behavior: a tick runs inside one transaction holding
//! `pg_try_advisory_xact_lock(advisory_lock_key("worker-liveness"))` (scheduler convention) and is
//! skipped when another instance holds it. The lock only prevents simultaneous ticks; the
//! "reported as dead" store stays in process memory exactly as in Scala, so every instance keeps
//! its own store. With N instances a missing worker can therefore be reported up to N times per
//! re-report interval (once by each instance that wins a tick), and the return is reported by
//! every instance that had reported the worker missing. This matches Scala, where every instance
//! runs its own `WorkerLivenessService` without any lock.
//!
//! Deviation (benign): Scala's `TemporaryStore.insert(.., to)` schedules a removal that is not
//! cancelled by an earlier `remove`; if a worker returns and goes missing again within one
//! re-report interval, Scala's stale removal timer can fire early and cause an earlier re-report.
//! Here every insertion carries its own expiry.

mod background_worker_liveness_dao;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::{
    background::scheduler::{
        Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    config::{ConfigError, Env},
    slack::{self, SlackNotificationService},
    util::id::ObjectId,
};

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "worker-liveness";
/// Scala `WorkerLivenessService.tickerInterval`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(60);
/// Scala `WorkerLivenessService.tickerInitialDelay`.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(60);
/// Scala `jobs.workerLivenessReReportInterval` default (application.conf).
pub const DEFAULT_RE_REPORT_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// `WK_WORKER_LIVENESS_*` settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkerLivenessConfig {
    pub schedule: JobSchedule,
    /// `jobs.workerLivenessReReportInterval`: how long a missing worker stays reported before it
    /// is reported again.
    pub re_report_interval: Duration,
}

impl Default for WorkerLivenessConfig {
    /// Scala defaults: enabled, every minute, first run after one minute, re-report after 1 h.
    fn default() -> Self {
        Self {
            schedule: JobSchedule {
                enabled: true,
                interval: DEFAULT_INTERVAL,
                initial_delay: DEFAULT_INITIAL_DELAY,
            },
            re_report_interval: DEFAULT_RE_REPORT_INTERVAL,
        }
    }
}

/// Parses worker liveness monitor settings from environment values (called by config.rs).
///
/// - `WK_WORKER_LIVENESS_ENABLED` (default `true`; Scala has no switch).
/// - `WK_WORKER_LIVENESS_INTERVAL_SECONDS` (> 0, default 60).
/// - `WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS` (>= 0, default 60).
/// - `WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS` (> 0, default 3600;
///   `jobs.workerLivenessReReportInterval`).
///
/// The liveness timeout itself is `WK_WORKER_LIVENESS_TIMEOUT_SECONDS` (`JobsConfig`).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<WorkerLivenessConfig, ConfigError> {
    let env = Env::new(values);
    let defaults = WorkerLivenessConfig::default();
    Ok(WorkerLivenessConfig {
        schedule: JobSchedule::from_env(env, "WK_WORKER_LIVENESS", defaults.schedule)?,
        re_report_interval: env
            .seconds("WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS", false)?
            .unwrap_or(defaults.re_report_interval),
    })
}

/// One worker row as the tick needs it.
#[derive(Clone, Debug, PartialEq, Eq, sqlx::FromRow)]
pub struct WorkerHeartbeat {
    pub id: ObjectId,
    pub name: String,
    pub last_heart_beat: DateTime<Utc>,
}

/// A liveness change detected by a tick.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LivenessChange {
    /// Reported as missing (`Worker missing`).
    Missing(WorkerHeartbeat),
    /// Reported as returned (`Worker return`).
    Returned(WorkerHeartbeat),
}

/// The monitor: detection settings, Slack target and the in-memory "reported as dead" store
/// (Scala `reportedAsDeadTemporaryStore`: worker id -> expiry). Clones share the store.
#[derive(Clone, Debug)]
pub struct WorkerLivenessMonitor {
    liveness_timeout: Duration,
    re_report_interval: Duration,
    slack: SlackNotificationService,
    reported_as_dead: Arc<Mutex<HashMap<ObjectId, DateTime<Utc>>>>,
}

impl WorkerLivenessMonitor {
    pub fn new(
        liveness_timeout: Duration,
        re_report_interval: Duration,
        slack: SlackNotificationService,
    ) -> Self {
        Self {
            liveness_timeout,
            re_report_interval,
            slack,
            reported_as_dead: Arc::default(),
        }
    }

    /// Ids currently in the "reported as dead" store (unexpired at `now`), sorted.
    pub fn reported_as_dead(&self, now: DateTime<Utc>) -> Vec<ObjectId> {
        let store = self
            .reported_as_dead
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<ObjectId> = store
            .iter()
            .filter(|(_, expiry)| **expiry > now)
            .map(|(id, _)| id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// `WorkerService.lastHeartBeatIsRecent`: `Instant.since(lastHeartBeat) < timeout`.
    pub fn heart_beat_is_recent(&self, last_heart_beat: DateTime<Utc>, now: DateTime<Utc>) -> bool {
        let timeout =
            chrono::Duration::from_std(self.liveness_timeout).unwrap_or(chrono::Duration::MAX);
        now.signed_duration_since(last_heart_beat) < timeout
    }

    /// `reportIfLivenessChanged` for all workers, updating the store; returns the changes in
    /// worker order. Pure apart from the store (no Slack, no database).
    pub fn evaluate(&self, workers: &[WorkerHeartbeat], now: DateTime<Utc>) -> Vec<LivenessChange> {
        let re_report =
            chrono::Duration::from_std(self.re_report_interval).unwrap_or(chrono::Duration::MAX);
        let mut store = self
            .reported_as_dead
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // TemporaryStore's scheduled removal: expired entries are gone.
        store.retain(|_, expiry| *expiry > now);
        let mut changes = Vec::new();
        for worker in workers {
            let recent = self.heart_beat_is_recent(worker.last_heart_beat, now);
            let reported = store.contains_key(&worker.id);
            if !recent && !reported {
                store.insert(
                    worker.id.clone(),
                    now.checked_add_signed(re_report)
                        .unwrap_or(DateTime::<Utc>::MAX_UTC),
                );
                changes.push(LivenessChange::Missing(worker.clone()));
            }
            if recent && reported {
                store.remove(&worker.id);
                changes.push(LivenessChange::Returned(worker.clone()));
            }
        }
        changes
    }

    /// Sends the Slack messages (and logs) for detected changes.
    pub fn report(&self, changes: &[LivenessChange], now: DateTime<Utc>) {
        for change in changes {
            match change {
                LivenessChange::Missing(worker) => self.slack.notice_worker_missing(
                    &worker.name,
                    &worker.id,
                    worker.last_heart_beat,
                    now,
                ),
                LivenessChange::Returned(worker) => self.slack.notice_worker_return(
                    &worker.name,
                    &worker.id,
                    worker.last_heart_beat,
                    now,
                ),
            }
        }
    }

    /// One tick at the current time.
    pub async fn tick(&self, pool: &PgPool) -> Result<JobOutcome, sqlx::Error> {
        self.tick_at(pool, Utc::now()).await
    }

    /// One tick at `now`: advisory lock (skip if held elsewhere), load workers, update the store,
    /// report changes, commit.
    pub async fn tick_at(
        &self,
        pool: &PgPool,
        now: DateTime<Utc>,
    ) -> Result<JobOutcome, sqlx::Error> {
        let mut transaction = pool.begin().await?;
        if !try_advisory_xact_lock(&mut transaction, advisory_lock_key(JOB_NAME)).await? {
            transaction.rollback().await?;
            return Ok(JobOutcome::SkippedLocked);
        }
        let workers = background_worker_liveness_dao::find_all_heartbeats(&mut transaction).await?;
        let changes = self.evaluate(&workers, now);
        self.report(&changes, now);
        transaction.commit().await?;
        let missing = changes
            .iter()
            .filter(|change| matches!(change, LivenessChange::Missing(_)))
            .count();
        Ok(JobOutcome::Completed(format!(
            "Checked {} workers: {missing} reported missing, {} reported returned.",
            workers.len(),
            changes.len() - missing
        )))
    }
}

/// Scheduler with the monitor job registered (also when disabled, so that is logged).
pub fn scheduler(
    pool: PgPool,
    config: &WorkerLivenessConfig,
    monitor: WorkerLivenessMonitor,
) -> Scheduler {
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new(JOB_NAME, config.schedule, move || {
        let pool = pool.clone();
        let monitor = monitor.clone();
        async move { Ok(monitor.tick(&pool).await?) }
    }));
    scheduler
}

/// Starts the monitor on the current runtime, reporting via [`slack::global`].
/// `liveness_timeout` is `config.jobs.worker_liveness_timeout`. Call
/// [`SchedulerHandle::shutdown`] before closing the pool.
pub fn spawn(
    pool: PgPool,
    config: &WorkerLivenessConfig,
    liveness_timeout: Duration,
) -> SchedulerHandle {
    let monitor =
        WorkerLivenessMonitor::new(liveness_timeout, config.re_report_interval, slack::global());
    scheduler(pool, config, monitor).spawn()
}

#[cfg(test)]
mod tests;
