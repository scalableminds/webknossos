//! Periodic pool health log: Scala `SlickPoolHealthLogger` (scheduled in `Startup.scala` every
//! 10 minutes after an initial 10 minutes) and `util.diagnostics.ThreadPoolHealthLogger` (same
//! interval, Pekko default dispatcher). Neither has a config switch and both log at INFO; Scala
//! only warns when it cannot introspect a pool.
//!
//! Rust logs one line per tick with the sqlx `PgPool` state (open, idle, in-use and maximum
//! connections; the same [`DbPoolSnapshot`] `/metrics` exports) and Tokio's stable runtime
//! metrics ([`RuntimeSnapshot`]: workers, alive tasks, global queue depth). There is no
//! counterpart of Slick's JDBC executor (sqlx is async) or of the JVM thread states.
//!
//! Deviation: the line is a WARN when every allowed connection is in use (Hikari's
//! `threadsAwaitingConnection` has no sqlx counterpart, so a saturated pool is the closest signal
//! that requests are waiting for a connection); Scala always logs INFO.
//!
//! No advisory lock: every instance logs its own pools.

use std::{collections::HashMap, time::Duration};

use sqlx::PgPool;

use crate::{
    background::scheduler::{Job, JobError, JobOutcome, JobSchedule, Scheduler, SchedulerHandle},
    config::{ConfigError, Env},
    system::metrics::{DbPoolSnapshot, RuntimeSnapshot},
};

/// Job name (log field).
pub const JOB_NAME: &str = "pool-health-log";
/// Scala `scheduleWithFixedDelay(10 minutes, 10 minutes)`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(10 * 60);
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(10 * 60);

/// `WK_POOL_HEALTH_LOG_*` settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolHealthLogConfig {
    pub schedule: JobSchedule,
}

impl Default for PoolHealthLogConfig {
    /// Scala defaults: enabled, every 10 minutes, first run after 10 minutes.
    fn default() -> Self {
        Self {
            schedule: JobSchedule {
                enabled: true,
                interval: DEFAULT_INTERVAL,
                initial_delay: DEFAULT_INITIAL_DELAY,
            },
        }
    }
}

/// Parses settings from environment values (called by config.rs).
///
/// - `WK_POOL_HEALTH_LOG_ENABLED` (default `true`; Scala has no switch).
/// - `WK_POOL_HEALTH_LOG_INTERVAL_SECONDS` (> 0, default 600).
/// - `WK_POOL_HEALTH_LOG_INITIAL_DELAY_SECONDS` (>= 0, default 600).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<PoolHealthLogConfig, ConfigError> {
    let defaults = PoolHealthLogConfig::default();
    Ok(PoolHealthLogConfig {
        schedule: JobSchedule::from_env(Env::new(values), "WK_POOL_HEALTH_LOG", defaults.schedule)?,
    })
}

/// The log line of one tick and whether it is a warning.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolHealth {
    /// Every allowed database connection is in use.
    pub db_pool_saturated: bool,
    pub message: String,
}

/// Builds the log line and the warning decision from a snapshot.
pub fn assess(db: DbPoolSnapshot, runtime: Option<RuntimeSnapshot>) -> PoolHealth {
    let db_pool_saturated = db.max > 0 && db.in_use() >= db.max;
    let mut message = format!(
        "Pool health: DB pool: size={}, inUse={}, idle={}, maxConnections={}",
        db.size,
        db.in_use(),
        db.idle,
        db.max
    );
    match runtime {
        Some(runtime) => message.push_str(&format!(
            "; Tokio runtime: workers={}, aliveTasks={}, globalQueueDepth={}.",
            runtime.workers, runtime.alive_tasks, runtime.global_queue_depth
        )),
        None => message.push_str("; Tokio runtime: not available."),
    }
    if db_pool_saturated {
        message.push_str(" All database connections are in use.");
    }
    PoolHealth {
        db_pool_saturated,
        message,
    }
}

fn log(health: &PoolHealth, db: DbPoolSnapshot, runtime: Option<RuntimeSnapshot>) {
    let workers = runtime.map(|runtime| runtime.workers);
    let alive_tasks = runtime.map(|runtime| runtime.alive_tasks);
    let global_queue_depth = runtime.map(|runtime| runtime.global_queue_depth);
    macro_rules! emit {
        ($level:ident) => {
            tracing::$level!(
                db_pool_size = db.size,
                db_pool_in_use = db.in_use(),
                db_pool_idle = db.idle,
                db_pool_max = db.max,
                tokio_workers = workers,
                tokio_alive_tasks = alive_tasks,
                tokio_global_queue_depth = global_queue_depth,
                "{}",
                health.message
            )
        };
    }
    if health.db_pool_saturated {
        emit!(warn);
    } else {
        emit!(info);
    }
}

/// One tick: snapshot both pools and log them. Returns the logged assessment.
pub fn run(pool: &PgPool) -> PoolHealth {
    let db = DbPoolSnapshot::of(pool);
    let runtime = RuntimeSnapshot::current();
    let health = assess(db, runtime);
    log(&health, db, runtime);
    health
}

/// Scheduler with the log job registered (also when disabled, so that is logged).
pub fn scheduler(pool: PgPool, config: &PoolHealthLogConfig) -> Scheduler {
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new(JOB_NAME, config.schedule, move || {
        let pool = pool.clone();
        async move {
            run(&pool);
            Ok::<_, JobError>(JobOutcome::Completed("Logged pool health.".into()))
        }
    }));
    scheduler
}

/// Starts the log job on the current runtime. Call [`SchedulerHandle::shutdown`] before closing
/// the pool.
pub fn spawn(pool: PgPool, config: &PoolHealthLogConfig) -> SchedulerHandle {
    scheduler(pool, config).spawn()
}

#[cfg(test)]
mod background_pool_health_log_tests;
