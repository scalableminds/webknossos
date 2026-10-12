# G2 scheduler + housekeeping checkpoint

Status (2026-10-11): DONE, pending parent main.rs wiring. Owner: sub-agent `scheduler-housekeeping`.
Owned: src/scheduler.rs, src/housekeeping.rs, tests/housekeeping.rs, .env.example (appended), this file.
Not touched: lib.rs, config.rs, main.rs, Cargo.* (scaffold signatures `HousekeepingConfig` + `config_from_values` kept).

## Scala truth
- `Startup.scala:50-68` `WkCleanUpService.register(desc, interval)` = pekko `scheduleWithFixedDelay(interval,
  interval)`: first run after one interval; log `Completed cleanup job: <desc>. Result: ...`, warn
  `Failed to execute cleanup job: <desc>. <msg>`, error on exception. No cross-instance locking.
- `AnnotationMutexService` extends `IntervalScheduler`: interval 1 h, initial delay 10 s, next run only after
  interval has passed since the previous *completion* (no overlap); log `Cleaned up N expired annotation mutexes.`

| job (Rust name) | Scala DAO | SQL (Rust, bound) | interval | first run |
|---|---|---|---|---|
| expired-tokens | TokenDAO.deleteAllExpired | `UPDATE tokens SET isDeleted = TRUE WHERE expirationDateTime <= $now` | dataStoreExpiry (1 d) | after interval |
| old-tokens | TokenDAO.hardDeleteOldTokens | `DELETE FROM tokens WHERE isDeleted AND expirationDateTime <= $now-7d` | 1 d | after interval |
| expired-invites | InviteDAO.deleteAllExpired | `UPDATE invites SET isDeleted = TRUE WHERE expirationDateTime <= $now` | 1 d | after interval |
| initializing-annotations | AnnotationDAO.deleteOldInitializingAnnotations | `DELETE FROM annotations WHERE state = 'Initializing' AND created < (NOW() - INTERVAL '1 hour')` | 1 d | after interval |
| expired-thumbnails | ThumbnailDAO.removeAllExpired(10 days) | `DELETE FROM dataset_thumbnails WHERE created < $now-10d` | 1 d | after interval |
| expired-annotation-mutexes | AnnotationMutexDAO.deleteExpired | `DELETE FROM annotation_mutexes WHERE expiry < NOW()` | 1 h | 10 s |

`$now` = application clock (`Utc::now()`), as Scala uses `Instant.now`; `NOW()` kept where Scala SQL has it.
Scala parity quirks kept: the token/invite UPDATE re-marks already-deleted expired rows (counted again);
deleting Initializing annotations does not delete `annotation_layers` (no FK in schema) and fails like Scala if an
`annotation_privateLinks` row references one (FK without cascade); cascading tables (mutexes, sharedTeams, ...) follow.

## Config (`WK_HOUSEKEEPING_*`, parsed in housekeeping::config_from_values)

| key | default | notes |
|---|---|---|
| `WK_HOUSEKEEPING_ENABLED` | `true` | master switch; false -> `spawn` returns an empty handle |
| `WK_HOUSEKEEPING_<JOB>_ENABLED` | `true` | per job |
| `WK_HOUSEKEEPING_<JOB>_INTERVAL_SECONDS` | 86400; EXPIRED_TOKENS = `WK_DATASTORE_TOKEN_EXPIRY_SECONDS` (86400); EXPIRED_ANNOTATION_MUTEXES = 3600 | > 0, <= i32::MAX |
| `WK_HOUSEKEEPING_<JOB>_INITIAL_DELAY_SECONDS` | = job interval (Scala fixed delay); EXPIRED_ANNOTATION_MUTEXES = 10 | >= 0, <= i32::MAX |

`<JOB>` in EXPIRED_TOKENS, OLD_TOKENS, EXPIRED_INVITES, INITIALIZING_ANNOTATIONS, EXPIRED_THUMBNAILS,
EXPIRED_ANNOTATION_MUTEXES. Invalid booleans/numbers are config errors (message starts with the key).
Default `true` (Scala parity) deviates from the main-app-gaps.md suggestion "default false while Play runs": the
jobs are idempotent single statements, so running beside Scala is harmless. Parent may flip the default.
Note: as in Scala, a process restarted more often than the interval never runs the daily jobs; set
`..._INITIAL_DELAY_SECONDS` lower if that matters.

## Design
- `scheduler.rs`: `Job::new(name, JobSchedule{enabled, interval, initial_delay}, || async -> Result<JobOutcome,
  JobError>)`, `Scheduler::add/spawn -> SchedulerHandle`, `SchedulerHandle::{empty, job_names, shutdown}`.
  One Tokio task per enabled job: sleep(initial_delay) -> run -> sleep(interval) after completion (never
  overlapping in-process). Errors logged at warn, panics (factory or future) contained via catch_unwind and logged
  at error; schedule continues. Stop via `tokio::sync::watch`: waiting jobs stop immediately, an in-flight run
  finishes; dropping the handle also stops jobs. Disabled jobs are logged and not spawned.
- Lock: every run = one transaction starting with `SELECT pg_try_advisory_xact_lock($key)`; if false ->
  rollback, `JobOutcome::SkippedLocked` (info log), else statement + commit (lock released with the transaction).
  Key = `scheduler::advisory_lock_key(name)`: const FNV-1a-64 of `webknossos.scheduler:<name>` (independent of the
  PostgreSQL version; pinned in unit test): expired-tokens 8171176992823393154, old-tokens -2542763403359019322,
  expired-invites -6959999106386544098, initializing-annotations -8590498379649204646, expired-thumbnails
  -618485299474650739, expired-annotation-mutexes -3287501116225812901. Scala takes no lock; a parallel Scala run
  only finds nothing left to do.
- `housekeeping.rs`: `HousekeepingJob` enum (`ALL`, `name`, `description`, `env_name`, `advisory_lock_key`,
  `default_schedule`, `execute(&mut PgConnection, now) -> rows`, `run(&PgPool) -> JobOutcome`),
  `HousekeepingConfig` (enabled + one `JobSchedule` field per job, `schedule(job)`), `scheduler(pool, &config)`,
  `spawn(pool, &config) -> SchedulerHandle`.

## Required parent wiring (src/main.rs, `run()`)

```rust
    let pool = db::connect(&config.database).await?;
    let housekeeping = webknossos_backend::housekeeping::spawn(pool.clone(), &config.housekeeping);
    // ... existing listener/server/select! unchanged ...
    // before `pool.close().await;` (also reached after the drain branch; on the
    // "Shutdown deadline exceeded" early return the runtime drop cancels the tasks):
    if tokio::time::timeout(config.shutdown_timeout, housekeeping.shutdown()).await.is_err() {
        tracing::warn!("Housekeeping jobs did not stop before the shutdown deadline");
    }
    pool.close().await;
```
Optional: `tokio = { version = "1", features = ["test-util"] }` under `[dev-dependencies]` would allow paused-time
scheduler tests; current tests use real millisecond timings (robust: overlap is checked with counters).
README/MIGRATION_STATUS: G2 can be marked done after wiring; annotation-mutex.md "hourly cleanup pending" resolved.

## Evidence (CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-b)
- `cargo test --locked --offline --lib -- scheduler housekeeping`: 11 passed (6 scheduler: no overlap +
  completion-based interval, error/future-panic/factory-panic resilience, disabled + cancellable initial delay,
  shutdown waits for in-flight run, empty handle, pinned lock keys; 5 housekeeping: Scala defaults, overrides,
  invalid values, unique names/keys, global/per-job disable). Repeated 5x, stable.
- `cargo test --locked --offline --test housekeeping -- --include-ignored` (TestDb): 9 passed: one test per job with
  exact boundary rows (`<=` vs `<`, deleted/live, state filter, cascade), lock held elsewhere -> SkippedLocked and
  other job keys unaffected, 3 contenders all skipped while held + 4 parallel runs delete rows exactly once,
  spawned scheduler runs enabled job and skips disabled one, shutdown within timeout.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: clean. `rustfmt --edition 2024 --check` on the 3
  owned files: clean.
