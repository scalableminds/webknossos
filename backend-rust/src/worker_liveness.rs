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

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::{
    scheduler::{
        Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    slack::{self, SlackNotificationService},
};

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "worker-liveness";
/// Scala `WorkerLivenessService.tickerInterval`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(60);
/// Scala `WorkerLivenessService.tickerInitialDelay`.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(60);
/// Scala `jobs.workerLivenessReReportInterval` default (application.conf).
pub const DEFAULT_RE_REPORT_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// Largest accepted duration in seconds (same bound as housekeeping).
const MAX_SECONDS: u64 = i32::MAX as u64;

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
) -> Result<WorkerLivenessConfig, String> {
    let seconds = |name: &str, allow_zero: bool| -> Result<Option<Duration>, String> {
        let Some(value) = values.get(name) else {
            return Ok(None);
        };
        let seconds: u64 = value
            .parse()
            .map_err(|_| format!("{name} must be an unsigned integer"))?;
        if seconds == 0 && !allow_zero {
            return Err(format!("{name} must be greater than zero"));
        }
        if seconds > MAX_SECONDS {
            return Err(format!("{name} exceeds the supported duration"));
        }
        Ok(Some(Duration::from_secs(seconds)))
    };
    let enabled = values
        .get("WK_WORKER_LIVENESS_ENABLED")
        .map(|value| {
            value
                .parse()
                .map_err(|_| "WK_WORKER_LIVENESS_ENABLED must be true or false".to_owned())
        })
        .transpose()?
        .unwrap_or(true);
    Ok(WorkerLivenessConfig {
        schedule: JobSchedule {
            enabled,
            interval: seconds("WK_WORKER_LIVENESS_INTERVAL_SECONDS", false)?
                .unwrap_or(DEFAULT_INTERVAL),
            initial_delay: seconds("WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS", true)?
                .unwrap_or(DEFAULT_INITIAL_DELAY),
        },
        re_report_interval: seconds("WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS", false)?
            .unwrap_or(DEFAULT_RE_REPORT_INTERVAL),
    })
}

/// One worker row as the tick needs it.
#[derive(Clone, Debug, PartialEq, Eq, sqlx::FromRow)]
pub struct WorkerHeartbeat {
    pub id: String,
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
    reported_as_dead: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
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
    pub fn reported_as_dead(&self, now: DateTime<Utc>) -> Vec<String> {
        let store = self
            .reported_as_dead
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<String> = store
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
        let workers: Vec<WorkerHeartbeat> = sqlx::query_as(
            "SELECT _id AS id, name, lastHeartBeat AS last_heart_beat \
             FROM webknossos.workers_ ORDER BY created, _id",
        )
        .fetch_all(&mut *transaction)
        .await?;
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
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect()
    }

    fn worker(id: &str, last_heart_beat: DateTime<Utc>) -> WorkerHeartbeat {
        WorkerHeartbeat {
            id: id.into(),
            name: format!("worker {id}"),
            last_heart_beat,
        }
    }

    #[test]
    fn defaults_match_scala() {
        let config = config_from_values(&HashMap::new()).unwrap();
        assert_eq!(config, WorkerLivenessConfig::default());
        assert!(config.schedule.enabled);
        assert_eq!(config.schedule.interval, Duration::from_secs(60));
        assert_eq!(config.schedule.initial_delay, Duration::from_secs(60));
        assert_eq!(config.re_report_interval, Duration::from_secs(3600));
    }

    #[test]
    fn overrides() {
        let config = config_from_values(&values(&[
            ("WK_WORKER_LIVENESS_ENABLED", "false"),
            ("WK_WORKER_LIVENESS_INTERVAL_SECONDS", "5"),
            ("WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS", "0"),
            ("WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS", "120"),
        ]))
        .unwrap();
        assert_eq!(
            config,
            WorkerLivenessConfig {
                schedule: JobSchedule {
                    enabled: false,
                    interval: Duration::from_secs(5),
                    initial_delay: Duration::ZERO,
                },
                re_report_interval: Duration::from_secs(120),
            }
        );
    }

    #[test]
    fn invalid_values_are_rejected() {
        for (key, value) in [
            ("WK_WORKER_LIVENESS_ENABLED", "yes"),
            ("WK_WORKER_LIVENESS_INTERVAL_SECONDS", "0"),
            ("WK_WORKER_LIVENESS_INTERVAL_SECONDS", "-5"),
            ("WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS", "x"),
            ("WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS", "0"),
            (
                "WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS",
                "2147483648",
            ),
        ] {
            let error = config_from_values(&values(&[(key, value)])).unwrap_err();
            assert!(error.starts_with(key), "{key}={value}: {error}");
        }
    }

    #[test]
    fn advisory_lock_key_is_pinned_and_unique() {
        // Independently computed FNV-1a; a rename would silently change the lock identity.
        assert_eq!(advisory_lock_key(JOB_NAME), -3_852_075_854_085_818_392);
        let mut keys: Vec<i64> = crate::housekeeping::HousekeepingJob::ALL
            .iter()
            .map(|job| job.advisory_lock_key())
            .collect();
        keys.push(advisory_lock_key(crate::credit_ticker::JOB_NAME));
        keys.push(advisory_lock_key(crate::dataset_storage::JOB_NAME));
        assert!(!keys.contains(&advisory_lock_key(JOB_NAME)));
    }

    #[test]
    fn heart_beat_recency_is_strict() {
        let monitor = WorkerLivenessMonitor::new(
            Duration::from_secs(60),
            DEFAULT_RE_REPORT_INTERVAL,
            SlackNotificationService::default(),
        );
        let now = Utc::now();
        assert!(monitor.heart_beat_is_recent(now - chrono::Duration::seconds(59), now));
        assert!(!monitor.heart_beat_is_recent(now - chrono::Duration::seconds(60), now));
    }

    #[test]
    fn evaluate_reports_missing_once_re_reports_after_expiry_and_returns() {
        let monitor = WorkerLivenessMonitor::new(
            Duration::from_secs(60),
            Duration::from_secs(3600),
            SlackNotificationService::default(),
        );
        let t0 = Utc::now();
        let dead = worker("a", t0 - chrono::Duration::minutes(5));
        let alive = worker("b", t0);
        let changes = monitor.evaluate(&[dead.clone(), alive], t0);
        assert_eq!(changes, vec![LivenessChange::Missing(dead.clone())]);
        assert_eq!(monitor.reported_as_dead(t0), vec!["a".to_owned()]);
        // Still missing within the re-report interval: nothing.
        let t1 = t0 + chrono::Duration::minutes(59);
        let alive = worker("b", t1);
        assert!(monitor.evaluate(&[dead.clone(), alive], t1).is_empty());
        // Entry expired: reported again.
        let t2 = t0 + chrono::Duration::minutes(60);
        assert_eq!(
            monitor.evaluate(std::slice::from_ref(&dead), t2),
            vec![LivenessChange::Missing(dead.clone())]
        );
        // Heartbeat again: return reported once, store emptied.
        let back = worker("a", t2);
        assert_eq!(
            monitor.evaluate(std::slice::from_ref(&back), t2),
            vec![LivenessChange::Returned(back.clone())]
        );
        assert!(monitor.evaluate(std::slice::from_ref(&back), t2).is_empty());
        assert!(monitor.reported_as_dead(t2).is_empty());
    }

    #[test]
    fn return_after_expiry_is_not_reported() {
        // Scala: once the TemporaryStore entry expired, a returning worker is not in the store.
        let monitor = WorkerLivenessMonitor::new(
            Duration::from_secs(60),
            Duration::from_secs(600),
            SlackNotificationService::default(),
        );
        let t0 = Utc::now();
        monitor.evaluate(&[worker("a", t0 - chrono::Duration::minutes(5))], t0);
        let t1 = t0 + chrono::Duration::minutes(11);
        assert!(monitor.evaluate(&[worker("a", t1)], t1).is_empty());
    }

    #[tokio::test]
    async fn disabled_monitor_spawns_no_job() {
        let pool = PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused").unwrap();
        let config = WorkerLivenessConfig {
            schedule: JobSchedule {
                enabled: false,
                ..WorkerLivenessConfig::default().schedule
            },
            ..WorkerLivenessConfig::default()
        };
        let handle = spawn(pool.clone(), &config, Duration::from_secs(60));
        assert!(handle.job_names().is_empty());
        handle.shutdown().await;
        let handle = spawn(
            pool,
            &WorkerLivenessConfig::default(),
            Duration::from_secs(60),
        );
        assert_eq!(handle.job_names(), vec![JOB_NAME]);
        handle.shutdown().await;
    }
}
