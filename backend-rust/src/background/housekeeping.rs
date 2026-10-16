//! Housekeeping jobs: Scala `WkCleanUpService` registrations in `app/Startup.scala:50-68` plus the
//! hourly `AnnotationMutexService` IntervalScheduler tick. SQL is copied from the Scala DAOs:
//!
//! | job | Scala source | statement |
//! |---|---|---|
//! | `expired-tokens` | `TokenDAO.deleteAllExpired` | `UPDATE tokens SET isDeleted = TRUE WHERE expirationDateTime <= now` |
//! | `old-tokens` | `TokenDAO.hardDeleteOldTokens` | `DELETE FROM tokens WHERE isDeleted AND expirationDateTime <= now - 7 days` |
//! | `expired-invites` | `InviteDAO.deleteAllExpired` | `UPDATE invites SET isDeleted = TRUE WHERE expirationDateTime <= now` |
//! | `initializing-annotations` | `AnnotationDAO.deleteOldInitializingAnnotations` | `DELETE FROM annotations WHERE state = 'Initializing' AND created < NOW() - INTERVAL '1 hour'` |
//! | `expired-thumbnails` | `ThumbnailDAO.removeAllExpired(10 days)` | `DELETE FROM dataset_thumbnails WHERE created < now - 10 days` |
//! | `expired-annotation-mutexes` | `AnnotationMutexDAO.deleteExpired` | `DELETE FROM annotation_mutexes WHERE expiry < NOW()` |
//!
//! As in Scala, `now` is the application clock (bound parameter) except where the Scala SQL itself
//! uses `NOW()`. Every run is one transaction that first takes the job's advisory lock
//! (`crate::background::scheduler::try_advisory_xact_lock`), so concurrent instances never run the same job at once.

use std::{collections::HashMap, time::Duration};

use chrono::{DateTime, TimeDelta, Utc};
use sqlx::{PgConnection, PgPool};

use crate::background::scheduler::{
    Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
    try_advisory_xact_lock,
};

const DAY: Duration = Duration::from_secs(24 * 60 * 60);
/// Scala `TokenDAO.hardDeleteGracePeriod`.
const TOKEN_HARD_DELETE_GRACE_PERIOD: TimeDelta = TimeDelta::days(7);
/// Scala `ThumbnailCachingService.ThumbnailCacheDuration`.
const THUMBNAIL_CACHE_DURATION: TimeDelta = TimeDelta::days(10);
/// Largest accepted interval / initial delay (same bound as the token durations in config.rs).
const MAX_SECONDS: u64 = i32::MAX as u64;

/// The six housekeeping jobs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HousekeepingJob {
    ExpiredTokens,
    OldTokens,
    ExpiredInvites,
    InitializingAnnotations,
    ExpiredThumbnails,
    ExpiredAnnotationMutexes,
}

impl HousekeepingJob {
    pub const ALL: [Self; 6] = [
        Self::ExpiredTokens,
        Self::OldTokens,
        Self::ExpiredInvites,
        Self::InitializingAnnotations,
        Self::ExpiredThumbnails,
        Self::ExpiredAnnotationMutexes,
    ];

    /// Stable job name: log field and advisory lock identity.
    pub const fn name(self) -> &'static str {
        match self {
            Self::ExpiredTokens => "expired-tokens",
            Self::OldTokens => "old-tokens",
            Self::ExpiredInvites => "expired-invites",
            Self::InitializingAnnotations => "initializing-annotations",
            Self::ExpiredThumbnails => "expired-thumbnails",
            Self::ExpiredAnnotationMutexes => "expired-annotation-mutexes",
        }
    }

    /// Scala job description (used in the Scala log lines).
    pub const fn description(self) -> &'static str {
        match self {
            Self::ExpiredTokens => "deletion of expired tokens",
            Self::OldTokens => "hard-deletion of old soft-deleted tokens",
            Self::ExpiredInvites => "deletion of expired invites",
            Self::InitializingAnnotations => "deletion of old annotations in initializing state",
            Self::ExpiredThumbnails => "deletion of expired thumbnails",
            Self::ExpiredAnnotationMutexes => "deletion of expired annotation mutexes",
        }
    }

    /// Infix of the `WK_HOUSEKEEPING_<JOB>_*` environment variables.
    pub const fn env_name(self) -> &'static str {
        match self {
            Self::ExpiredTokens => "EXPIRED_TOKENS",
            Self::OldTokens => "OLD_TOKENS",
            Self::ExpiredInvites => "EXPIRED_INVITES",
            Self::InitializingAnnotations => "INITIALIZING_ANNOTATIONS",
            Self::ExpiredThumbnails => "EXPIRED_THUMBNAILS",
            Self::ExpiredAnnotationMutexes => "EXPIRED_ANNOTATION_MUTEXES",
        }
    }

    pub const fn advisory_lock_key(self) -> i64 {
        advisory_lock_key(self.name())
    }

    /// Scala schedule. `datastore_token_expiry` is `silhouette.tokenAuthenticator.dataStoreExpiry`,
    /// the interval of the expired-token job. CleanUpService jobs first run after one interval
    /// (pekko `scheduleWithFixedDelay(interval, interval)`); the mutex IntervalScheduler after 10 s.
    pub fn default_schedule(self, datastore_token_expiry: Duration) -> JobSchedule {
        let (interval, initial_delay) = match self {
            Self::ExpiredTokens => (datastore_token_expiry, datastore_token_expiry),
            Self::OldTokens
            | Self::ExpiredInvites
            | Self::InitializingAnnotations
            | Self::ExpiredThumbnails => (DAY, DAY),
            Self::ExpiredAnnotationMutexes => {
                (Duration::from_secs(60 * 60), Duration::from_secs(10))
            }
        };
        JobSchedule {
            enabled: true,
            interval,
            initial_delay,
        }
    }

    /// Runs the job's statement on `connection`; returns the affected row count.
    pub async fn execute(
        self,
        connection: &mut PgConnection,
        now: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        let query = match self {
            Self::ExpiredTokens => sqlx::query(
                "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE expirationDateTime <= $1",
            )
            .bind(now),
            Self::OldTokens => sqlx::query(
                "DELETE FROM webknossos.tokens WHERE isDeleted AND expirationDateTime <= $1",
            )
            .bind(now - TOKEN_HARD_DELETE_GRACE_PERIOD),
            Self::ExpiredInvites => sqlx::query(
                "UPDATE webknossos.invites SET isDeleted = TRUE WHERE expirationDateTime <= $1",
            )
            .bind(now),
            Self::InitializingAnnotations => sqlx::query(
                "DELETE FROM webknossos.annotations \
                 WHERE state = 'Initializing'::webknossos.ANNOTATION_STATE \
                 AND created < (NOW() - INTERVAL '1 hour')",
            ),
            Self::ExpiredThumbnails => {
                sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE created < $1")
                    .bind(now - THUMBNAIL_CACHE_DURATION)
            }
            Self::ExpiredAnnotationMutexes => {
                sqlx::query("DELETE FROM webknossos.annotation_mutexes WHERE expiry < NOW()")
            }
        };
        Ok(query.execute(connection).await?.rows_affected())
    }

    /// One complete run: transaction, advisory lock (skip if held elsewhere), statement, commit.
    pub async fn run(self, pool: &PgPool) -> Result<JobOutcome, sqlx::Error> {
        let mut transaction = pool.begin().await?;
        if !try_advisory_xact_lock(&mut transaction, self.advisory_lock_key()).await? {
            transaction.rollback().await?;
            return Ok(JobOutcome::SkippedLocked);
        }
        let count = self.execute(&mut transaction, Utc::now()).await?;
        transaction.commit().await?;
        Ok(JobOutcome::Completed(self.result_message(count)))
    }

    fn result_message(self, count: u64) -> String {
        match self {
            Self::ExpiredTokens => format!("{count} expired tokens marked deleted"),
            Self::OldTokens => format!("{count} old soft-deleted tokens removed"),
            Self::ExpiredInvites => format!("{count} expired invites marked deleted"),
            Self::InitializingAnnotations => {
                format!("{count} old initializing annotations removed")
            }
            Self::ExpiredThumbnails => format!("removed {count} expired thumbnails"),
            Self::ExpiredAnnotationMutexes => {
                format!("Cleaned up {count} expired annotation mutexes.")
            }
        }
    }
}

/// `WK_HOUSEKEEPING_*` settings: global switch plus one schedule per job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HousekeepingConfig {
    pub enabled: bool,
    pub expired_tokens: JobSchedule,
    pub old_tokens: JobSchedule,
    pub expired_invites: JobSchedule,
    pub initializing_annotations: JobSchedule,
    pub expired_thumbnails: JobSchedule,
    pub expired_annotation_mutexes: JobSchedule,
}

impl Default for HousekeepingConfig {
    /// Scala defaults (dataStoreExpiry = 1 day), all jobs enabled.
    fn default() -> Self {
        Self::with_datastore_token_expiry(DAY)
    }
}

impl HousekeepingConfig {
    fn with_datastore_token_expiry(datastore_token_expiry: Duration) -> Self {
        let default = |job: HousekeepingJob| job.default_schedule(datastore_token_expiry);
        Self {
            enabled: true,
            expired_tokens: default(HousekeepingJob::ExpiredTokens),
            old_tokens: default(HousekeepingJob::OldTokens),
            expired_invites: default(HousekeepingJob::ExpiredInvites),
            initializing_annotations: default(HousekeepingJob::InitializingAnnotations),
            expired_thumbnails: default(HousekeepingJob::ExpiredThumbnails),
            expired_annotation_mutexes: default(HousekeepingJob::ExpiredAnnotationMutexes),
        }
    }

    pub fn schedule(&self, job: HousekeepingJob) -> JobSchedule {
        match job {
            HousekeepingJob::ExpiredTokens => self.expired_tokens,
            HousekeepingJob::OldTokens => self.old_tokens,
            HousekeepingJob::ExpiredInvites => self.expired_invites,
            HousekeepingJob::InitializingAnnotations => self.initializing_annotations,
            HousekeepingJob::ExpiredThumbnails => self.expired_thumbnails,
            HousekeepingJob::ExpiredAnnotationMutexes => self.expired_annotation_mutexes,
        }
    }

    fn schedule_mut(&mut self, job: HousekeepingJob) -> &mut JobSchedule {
        match job {
            HousekeepingJob::ExpiredTokens => &mut self.expired_tokens,
            HousekeepingJob::OldTokens => &mut self.old_tokens,
            HousekeepingJob::ExpiredInvites => &mut self.expired_invites,
            HousekeepingJob::InitializingAnnotations => &mut self.initializing_annotations,
            HousekeepingJob::ExpiredThumbnails => &mut self.expired_thumbnails,
            HousekeepingJob::ExpiredAnnotationMutexes => &mut self.expired_annotation_mutexes,
        }
    }
}

/// Parses housekeeping settings from environment values (called by config.rs).
///
/// - `WK_HOUSEKEEPING_ENABLED` (default `true`): master switch.
/// - `WK_HOUSEKEEPING_<JOB>_ENABLED` (default `true`).
/// - `WK_HOUSEKEEPING_<JOB>_INTERVAL_SECONDS` (> 0, Scala default).
/// - `WK_HOUSEKEEPING_<JOB>_INITIAL_DELAY_SECONDS` (>= 0; default: the job's interval, 10 s for
///   the mutex job).
///
/// The expired-token interval defaults to `WK_DATASTORE_TOKEN_EXPIRY_SECONDS` (86400) as Scala
/// registers that job with `dataStoreExpiry`.
pub fn config_from_values(values: &HashMap<String, String>) -> Result<HousekeepingConfig, String> {
    let boolean = |name: &str| -> Result<Option<bool>, String> {
        values
            .get(name)
            .map(|value| {
                value
                    .parse()
                    .map_err(|_| format!("{name} must be true or false"))
            })
            .transpose()
    };
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
    let datastore_token_expiry =
        seconds("WK_DATASTORE_TOKEN_EXPIRY_SECONDS", false)?.unwrap_or(DAY);
    let mut config = HousekeepingConfig::with_datastore_token_expiry(datastore_token_expiry);
    config.enabled = boolean("WK_HOUSEKEEPING_ENABLED")?.unwrap_or(true);
    for job in HousekeepingJob::ALL {
        let prefix = format!("WK_HOUSEKEEPING_{}", job.env_name());
        let default = job.default_schedule(datastore_token_expiry);
        let interval = seconds(&format!("{prefix}_INTERVAL_SECONDS"), false)?;
        let initial_delay = seconds(&format!("{prefix}_INITIAL_DELAY_SECONDS"), true)?;
        let default_delay = if job == HousekeepingJob::ExpiredAnnotationMutexes {
            default.initial_delay
        } else {
            interval.unwrap_or(default.initial_delay)
        };
        *config.schedule_mut(job) = JobSchedule {
            enabled: boolean(&format!("{prefix}_ENABLED"))?.unwrap_or(true),
            interval: interval.unwrap_or(default.interval),
            initial_delay: initial_delay.unwrap_or(default_delay),
        };
    }
    Ok(config)
}

/// Scheduler with all six jobs registered (disabled jobs included, so they are logged).
pub fn scheduler(pool: PgPool, config: &HousekeepingConfig) -> Scheduler {
    let mut scheduler = Scheduler::new();
    for job in HousekeepingJob::ALL {
        let pool = pool.clone();
        scheduler.add(Job::new(job.name(), config.schedule(job), move || {
            let pool = pool.clone();
            async move { Ok(job.run(&pool).await?) }
        }));
    }
    scheduler
}

/// Starts the housekeeping jobs on the current runtime. Returns an empty handle if
/// `WK_HOUSEKEEPING_ENABLED=false`. Call [`SchedulerHandle::shutdown`] before closing the pool.
pub fn spawn(pool: PgPool, config: &HousekeepingConfig) -> SchedulerHandle {
    if !config.enabled {
        tracing::info!("Housekeeping jobs disabled (WK_HOUSEKEEPING_ENABLED=false)");
        return SchedulerHandle::empty();
    }
    scheduler(pool, config).spawn()
}

#[cfg(test)]
mod tests;
