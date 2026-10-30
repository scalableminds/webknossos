# Credit ticker (gap G3) checkpoint

Status: DONE (2026-10-11), waiting only on the parent's main.rs wiring (below). Owner: credit-ticker sub-agent.

## Scala truth
`app/models/organization/FreeCreditTransactionService.scala` (`IntervalScheduler`): interval 20 min, initial delay
10 s (`IntervalScheduler.tickerInitialDelay` default), always enabled, no config keys. A tick runs
`CreditTransactionDAO.runRevokeExpiredCredits` and then `handOutMonthlyFreeCredits`
(`SELECT webknossos.hand_out_monthly_free_credits(jobs.monthlyFreeMilliCredits)`), and logs
"Finished revoking and handing out free monthly credits.". When revocations fail, it sends
`slackNotificationService.warn("Failed to revoke some expired credits for organizations", ...)`.

## Implementation
- `src/credit_ticker.rs`: `CreditTickerConfig { schedule: JobSchedule }`, `config_from_values(&HashMap)`
  (signatures unchanged), `run(pool, monthly_free_milli_credits) -> Result<JobOutcome, sqlx::Error>`,
  `scheduler(...)`, `pub fn spawn(pool, &CreditTickerConfig, monthly_free_milli_credits: i32) -> SchedulerHandle`.
  It reuses the generic `src/scheduler.rs` (`Job`, `JobSchedule`, `advisory_lock_key`, `try_advisory_xact_lock`).
- Lock: `pg_try_advisory_xact_lock(advisory_lock_key("free-credit-ticker"))` = -6829639099625385059 (pinned in a
  unit test, cross-checked with Python FNV-1a). A unit test asserts that it differs from every `HousekeepingJob` key
  (for example expired-tokens 8171176992823393154). The lock transaction stays open for the whole run and runs
  the hand-out. Revocations use their own SERIALIZABLE transaction per organization (as in Scala), so one run
  uses 2 pool connections.
- Shared SQL with no duplicates:
  - `credit_transactions::revoke_expired_credits(&PgPool) -> Result<Vec<FailedRevocation>, sqlx::Error>`, which
    is also used by `/maintenance/revokeExpiredCredits`.
  - `credit_transactions::{FailedRevocation, notify_failed_revocations, failed_revocations_slack_body}`. Until a
    Slack client is wired, the Slack hook logs the Scala title and body as `tracing::warn!`.
  - `organizations::hand_out_monthly_free_credits(&mut PgConnection, i32)`, which is also used when an
    organization is created.
- Failed single-grant revocations are reported, and the run continues with the hand-out. Any other error ends
  the tick, matching the Fox chain.

## Config (.env.example appended)
- `WK_CREDIT_TICKER_ENABLED`: default true.
- `WK_CREDIT_TICKER_INTERVAL_SECONDS`: must be > 0; default 1200.
- `WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS`: must be >= 0; default 10.
- The granted amount is the existing `WK_JOBS_MONTHLY_FREE_MILLI_CREDITS` (`config.misc.monthly_free_milli_credits`).

## main.rs wiring (parent-owned, NOT yet applied)
Add after the `housekeeping` spawn line:
```rust
    let credit_ticker = webknossos_backend::credit_ticker::spawn(
        pool.clone(),
        &config.credit_ticker,
        config.misc.monthly_free_milli_credits,
    );
```
and next to the housekeeping shutdown, before `pool.close().await`:
```rust
    if tokio::time::timeout(config.shutdown_timeout, credit_ticker.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Credit ticker did not stop before the shutdown deadline");
    }
```

## Tests
- Unit tests (`src/credit_ticker.rs`, 7): Scala defaults, overrides, invalid values, pinned lock key, lock key
  differs from housekeeping keys, Slack body text, disabled ticker spawns no job.
- `tests/credit_ticker.rs` (4, DB):
  - Exact revocations: partial, full, spent, not-yet-expired and already-revoked grants.
  - The monthly hand-out happens exactly once per due organization, and second and third runs do nothing.
  - Lock contention: the holder and 3 concurrent contenders are skipped, and the run proceeds after release.
  - The spawned scheduler runs on its schedule.
- Regression: `tests/credit_transactions.rs` (3) and `tests/organizations.rs` (3) pass.
- Clippy `--all-targets -D warnings`: clean in the ticker files. The full run is blocked by a foreign
  `too_many_arguments` in `src/browser_auth_onboarding.rs:801` (the concurrent mail agent's file). Clippy with
  `-A clippy::too_many_arguments` passes. rustfmt `--check` passes on the 4 edited files.
