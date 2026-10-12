# Worker liveness monitor (G5) checkpoint

Status: DONE (agent worker-liveness, 2026-10-11), pending parent main.rs wiring (below). Owned:
src/worker_liveness.rs, tests/worker_liveness.rs, .env.example (appended), this file. Not touched: lib.rs,
config.rs, main.rs, Cargo.*, scheduler.rs, slack.rs (existing `notice_worker_missing/_return` used unchanged).

## Scala truth
- `app/models/job/Worker.scala:111-160` `WorkerLivenessService` (IntervalScheduler, initial delay 1 min, interval
  1 min, always on). Tick: `WorkerDAO.findAll` (workers_ view, non-deleted); per worker:
  not recent (`Instant.since(lastHeartBeat) < jobs.workerLivenessTimeout` false) and not in
  `reportedAsDeadTemporaryStore` -> Slack warn `Worker missing` "Worker <name> (<id>) is not reporting. Last
  heartbeat was at <iso> (<dur> ago)" + logger.warn, insert with expiry `jobs.workerLivenessReReportInterval` (1 h);
  recent and in store -> Slack success `Worker return` "... is reporting again. ..." + logger.info, remove.
  Store = in-memory TemporaryStore (TrieMap + scheduled removal) per process.

## Config (`worker_liveness::config_from_values`, Config.worker_liveness)
| key | default | notes |
|---|---|---|
| `WK_WORKER_LIVENESS_ENABLED` | true | Scala has no switch |
| `WK_WORKER_LIVENESS_INTERVAL_SECONDS` | 60 | > 0 |
| `WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS` | 60 | >= 0 |
| `WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS` | 3600 | > 0, `jobs.workerLivenessReReportInterval` |
Timeout: existing `WK_WORKER_LIVENESS_TIMEOUT_SECONDS` (`config.jobs.worker_liveness_timeout`), spawn parameter.

## Implementation (src/worker_liveness.rs)
- `WorkerLivenessConfig { schedule: JobSchedule, re_report_interval }`, `WorkerHeartbeat`, `LivenessChange`.
- `WorkerLivenessMonitor::new(timeout, re_report, SlackNotificationService)` (clones share the store
  `Arc<Mutex<HashMap<id, expiry DateTime<Utc>>>>`): `evaluate(workers, now)` (pure, Scala branch order),
  `report`, `tick()/tick_at(pool, now)`, `reported_as_dead(now)`, `heart_beat_is_recent` (strict `<`).
- `scheduler(pool, &config, monitor)`, `pub fn spawn(pool, &WorkerLivenessConfig, liveness_timeout) ->
  SchedulerHandle` (uses `slack::global()`).
- Lock: tick = one transaction with `pg_try_advisory_xact_lock(advisory_lock_key("worker-liveness"))`
  = -3852075854085818392 (pinned; asserted distinct from housekeeping, free-credit-ticker, used-storage-scan keys).
  Workers are read inside it (`ORDER BY created, _id`); Slack sends are fire-and-forget.
- Multi-instance: the store is per process (Scala parity). The lock only prevents simultaneous ticks, so with N
  instances a missing worker may be reported up to N times per re-report interval and a return by every instance
  that reported the worker missing — same as Scala (N independent services, no lock).

## Deviations
- Scala's stale scheduled removal (TemporaryStore.insert timer is not cancelled by `remove`) can cause an early
  re-report when a worker returns and dies again within 1 h; Rust uses a per-insertion expiry.
- Expiry is checked at tick time (wall clock) instead of a removal timer: observable behavior identical.

## Required parent wiring (src/main.rs)
After the `used_storage_scan` spawn (line ~33-37):
```rust
    let worker_liveness = webknossos_backend::worker_liveness::spawn(
        pool.clone(),
        &config.worker_liveness,
        config.jobs.worker_liveness_timeout,
    );
```
Next to the other shutdowns, before `pool.close().await;`:
```rust
    if tokio::time::timeout(config.shutdown_timeout, worker_liveness.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Worker liveness monitor did not stop before the shutdown deadline");
    }
```
(`slack::install_global` already runs before, so the monitor posts to the configured webhook.) Optional: only
spawn when `config.jobs_enabled` — Scala runs it unconditionally, so not done here. G5 in main-app-gaps.md can be
marked done after wiring.

## Evidence (CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-a)
- `cargo test --lib -- worker_liveness`: 8 passed (defaults, overrides, invalid values, pinned+unique lock key,
  strict recency, missing-once/re-report/return via evaluate, no return after expiry, disabled spawn).
- `cargo test --test worker_liveness -- --include-ignored`: 3 passed (x3 stable): mock webhook exact bodies
  (missing once, silent within interval, re-report at interval, return, missing again; deleted workers ignored),
  lock held elsewhere -> 3x SkippedLocked with no store change/no message then runs, scheduler at 50 ms reports once
  and shuts down within timeout.
- clippy `--all-targets -D warnings`: clean. `rustfmt --edition 2024 --check` on both owned .rs files: clean.
