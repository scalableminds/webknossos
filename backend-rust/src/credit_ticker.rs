//! Free credit ticker: Scala `FreeCreditTransactionService` (an `IntervalScheduler`, interval
//! 20 min, initial delay 10 s, always enabled). Each tick runs
//! `CreditTransactionDAO.runRevokeExpiredCredits` and then `handOutMonthlyFreeCredits`
//! (`SELECT webknossos.hand_out_monthly_free_credits(jobs.monthlyFreeMilliCredits)`).
//!
//! The SQL is shared with the superuser route `/maintenance/revokeExpiredCredits`
//! ([`crate::credit_transactions::revoke_expired_credits`]) and organization creation
//! ([`crate::organizations::hand_out_monthly_free_credits`]). Both steps are idempotent: only
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
    credit_transactions::revoke_expired_credits,
    organizations::hand_out_monthly_free_credits,
    scheduler::{
        Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
};

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "free-credit-ticker";
/// Scala `FreeCreditTransactionService.tickerInterval`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// Scala `IntervalScheduler.tickerInitialDelay` default.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(10);
/// Largest accepted interval / initial delay (same bound as housekeeping).
const MAX_SECONDS: u64 = i32::MAX as u64;

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
pub fn config_from_values(values: &HashMap<String, String>) -> Result<CreditTickerConfig, String> {
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
        .get("WK_CREDIT_TICKER_ENABLED")
        .map(|value| {
            value
                .parse()
                .map_err(|_| "WK_CREDIT_TICKER_ENABLED must be true or false".to_owned())
        })
        .transpose()?
        .unwrap_or(true);
    Ok(CreditTickerConfig {
        schedule: JobSchedule {
            enabled,
            interval: seconds("WK_CREDIT_TICKER_INTERVAL_SECONDS", false)?
                .unwrap_or(DEFAULT_INTERVAL),
            initial_delay: seconds("WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS", true)?
                .unwrap_or(DEFAULT_INITIAL_DELAY),
        },
    })
}

/// One tick: advisory lock (skip if held elsewhere), revoke expired credits, hand out the monthly
/// free credits, commit. Revocation failures of single grants are reported (Slack hook in
/// `credit_transactions::notify_failed_revocations`) and do not stop the hand-out; any other
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
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect()
    }

    #[test]
    fn defaults_match_scala() {
        let config = config_from_values(&HashMap::new()).unwrap();
        assert_eq!(config, CreditTickerConfig::default());
        assert!(config.schedule.enabled);
        assert_eq!(config.schedule.interval, Duration::from_secs(1200));
        assert_eq!(config.schedule.initial_delay, Duration::from_secs(10));
    }

    #[test]
    fn overrides() {
        let config = config_from_values(&values(&[
            ("WK_CREDIT_TICKER_ENABLED", "false"),
            ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "60"),
            ("WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS", "0"),
        ]))
        .unwrap();
        assert_eq!(
            config.schedule,
            JobSchedule {
                enabled: false,
                interval: Duration::from_secs(60),
                initial_delay: Duration::ZERO,
            }
        );
    }

    #[test]
    fn invalid_values_are_rejected() {
        for (key, value) in [
            ("WK_CREDIT_TICKER_ENABLED", "yes"),
            ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "0"),
            ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "-5"),
            ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "2147483648"),
            ("WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS", "x"),
        ] {
            let error = config_from_values(&values(&[(key, value)])).unwrap_err();
            assert!(error.starts_with(key), "{key}={value}: {error}");
        }
    }

    #[test]
    fn advisory_lock_key_is_pinned() {
        // Independently computed FNV-1a; a rename would silently change the lock identity.
        assert_eq!(advisory_lock_key(JOB_NAME), -6_829_639_099_625_385_059);
    }

    #[test]
    fn advisory_lock_key_differs_from_housekeeping_keys() {
        use crate::housekeeping::HousekeepingJob;
        for job in HousekeepingJob::ALL {
            assert_ne!(job.name(), JOB_NAME);
            assert_ne!(job.advisory_lock_key(), advisory_lock_key(JOB_NAME));
        }
    }

    #[test]
    fn failed_revocation_slack_body_matches_scala() {
        use crate::credit_transactions::{FailedRevocation, failed_revocations_slack_body};
        let failure = |transaction: &str, organization: &str| FailedRevocation {
            transaction_id: transaction.into(),
            organization_id: organization.into(),
        };
        assert_eq!(
            failed_revocations_slack_body(&[failure("t1", "orgA"), failure("t2", "orgB")]),
            "Failed to revoke credits for transaction t1 for organization orgA.\n\
             Failed to revoke credits for transaction t2 for organization orgB."
        );
    }

    #[tokio::test]
    async fn disabled_ticker_spawns_no_job() {
        let pool = PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused").unwrap();
        let config = CreditTickerConfig {
            schedule: JobSchedule {
                enabled: false,
                ..CreditTickerConfig::default().schedule
            },
        };
        let handle = spawn(pool.clone(), &config, 2000);
        assert!(handle.job_names().is_empty());
        handle.shutdown().await;
        let handle = spawn(pool, &CreditTickerConfig::default(), 2000);
        assert_eq!(handle.job_names(), vec![JOB_NAME]);
        handle.shutdown().await;
    }
}
