//! Free credit ticker: Scala `FreeCreditTransactionService` (an `IntervalScheduler`, interval
//! 20 min, initial delay 10 s, always enabled). Each tick runs
//! `CreditTransactionDAO.runRevokeExpiredCredits` and then `handOutMonthlyFreeCredits`
//! (`SELECT webknossos.hand_out_monthly_free_credits(jobs.monthlyFreeMilliCredits)`).
//!
//! The SQL is shared with the superuser route `/maintenance/revokeExpiredCredits`
//! ([`crate::organization::credit_transactions::revoke_expired_credits`]) and organization creation
//! ([`crate::organization::credit_transactions::organization_credit_transactions_dao::hand_out_monthly_free_credits`]). Both steps are idempotent: only
//! pending expired grants are revoked, and the SQL function grants an organization at most once
//! per month (it skips organizations that already have a grant expiring next month).
//!
//! Cross-instance serialization follows `housekeeping.rs`: every run opens one transaction that
//! takes `pg_try_advisory_xact_lock(advisory_lock_key("free-credit-ticker"))` and skips the run
//! if another instance holds it. That transaction stays open for the whole run and also executes
//! the monthly hand-out; the revocations run in their own SERIALIZABLE per-organization
//! transactions (as in Scala), so a run uses two pool connections at once.

use std::{collections::HashMap, time::Duration};

use sqlx::PgPool;

use crate::{
    background::scheduler::{
        Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    config::{ConfigError, Env},
    organization::credit_transactions::organization_credit_transactions_dao::hand_out_monthly_free_credits,
    organization::credit_transactions::revoke_expired_credits,
};

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "free-credit-ticker";
/// Scala `FreeCreditTransactionService.tickerInterval`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// Scala `IntervalScheduler.tickerInitialDelay` default.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(10);

/// `WK_CREDIT_TICKER_*` settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreditTickerConfig {
    pub schedule: JobSchedule,
}

impl Default for CreditTickerConfig {
    /// Scala defaults: enabled, every 20 minutes, first run after 10 seconds.
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
/// - `WK_CREDIT_TICKER_ENABLED` (default `true`; Scala has no switch, the ticker always runs).
/// - `WK_CREDIT_TICKER_INTERVAL_SECONDS` (> 0, default 1200).
/// - `WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS` (>= 0, default 10).
///
/// The granted amount is `WK_JOBS_MONTHLY_FREE_MILLI_CREDITS` (`MiscConfig`), passed to [`spawn`].
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<CreditTickerConfig, ConfigError> {
    Ok(CreditTickerConfig {
        schedule: JobSchedule::from_env(
            Env::new(values),
            "WK_CREDIT_TICKER",
            CreditTickerConfig::default().schedule,
        )?,
    })
}

/// One tick: advisory lock (skip if held elsewhere), revoke expired credits, hand out the monthly
/// free credits, commit. Revocation failures of single grants are reported (Slack hook in
/// `crate::organization::credit_transactions::notify_failed_revocations`) and do not stop the hand-out; any other
/// error aborts the tick before the hand-out, like Scala's Fox chain.
pub async fn run(
    pool: &PgPool,
    monthly_free_milli_credits: i32,
) -> Result<JobOutcome, sqlx::Error> {
    let mut lock = pool.begin().await?;
    if !try_advisory_xact_lock(&mut lock, advisory_lock_key(JOB_NAME)).await? {
        lock.rollback().await?;
        return Ok(JobOutcome::SkippedLocked);
    }
    let failed = revoke_expired_credits(pool).await?;
    hand_out_monthly_free_credits(&mut lock, monthly_free_milli_credits).await?;
    lock.commit().await?;
    let mut message = "Finished revoking and handing out free monthly credits.".to_owned();
    if !failed.is_empty() {
        message.push_str(&format!(
            " {} expired grants could not be revoked.",
            failed.len()
        ));
    }
    Ok(JobOutcome::Completed(message))
}

/// Scheduler with the ticker job registered (also when disabled, so that is logged).
pub fn scheduler(
    pool: PgPool,
    config: &CreditTickerConfig,
    monthly_free_milli_credits: i32,
) -> Scheduler {
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new(JOB_NAME, config.schedule, move || {
        let pool = pool.clone();
        async move { Ok(run(&pool, monthly_free_milli_credits).await?) }
    }));
    scheduler
}

/// Starts the ticker on the current runtime (`monthly_free_milli_credits` is
/// `config.misc.monthly_free_milli_credits`). Call [`SchedulerHandle::shutdown`] before closing
/// the pool.
pub fn spawn(
    pool: PgPool,
    config: &CreditTickerConfig,
    monthly_free_milli_credits: i32,
) -> SchedulerHandle {
    scheduler(pool, config, monthly_free_milli_credits).spawn()
}

#[cfg(test)]
mod background_credit_ticker_tests;
