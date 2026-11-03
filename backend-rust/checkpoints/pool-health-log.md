# Pool health log (G12) checkpoint

Status: DONE (2026-11-03). Wired in `src/main.rs` (spawn + shutdown) and `Config.pool_health_log`.

## Scala truth
- `Startup.scala`: `ThreadPoolHealthLogger.registerPeriodicLogging` (util `diagnostics`) and
  `SlickPoolHealthLogger.logHealth` via `scheduleWithFixedDelay(10 minutes, 10 minutes)`. No config switch.
- `SlickPoolHealthLogger`: one INFO line with the Slick JDBC executor (poolSize, activeThreads, maxThreads,
  queueSize, completedTasks) and HikariCP (total/active/idle connections, threadsAwaitingConnection).
- `ThreadPoolHealthLogger`: one INFO line with JVM thread counts by state plus the Pekko default dispatcher's
  fork-join pool (parallelism, poolSize, active/running threads, queued tasks/submissions, steals). WARN only when the
  dispatcher cannot be introspected. Neither logger warns on unhealthy values.

## Implementation
- `src/system/metrics.rs`: `DbPoolSnapshot::of(pool)` (size, idle clamped to size, configured max; `in_use()`) and
  `RuntimeSnapshot::current()` (Tokio stable metrics: `num_workers`, `num_alive_tasks`, `global_queue_depth`; no
  `tokio_unstable`). `/metrics` renders the DB gauges from the same snapshot and now also exports
  `wk_tokio_workers`, `wk_tokio_alive_tasks`, `wk_tokio_global_queue_depth`.
- `src/background/pool_health_log.rs`: config, pure `assess(db, runtime) -> PoolHealth { db_pool_saturated, message }`,
  `run(pool)` (snapshot, assess, log with structured fields `db_pool_size/in_use/idle/max`,
  `tokio_workers/alive_tasks/global_queue_depth`), `scheduler`, `spawn`. No advisory lock: each instance logs its own
  pools. Message: `Pool health: DB pool: size=5, inUse=2, idle=3, maxConnections=10; Tokio runtime: workers=8,
  aliveTasks=42, globalQueueDepth=3.`

## Config
| key | default | rule |
|---|---|---|
| WK_POOL_HEALTH_LOG_ENABLED | true (Scala has no switch) | bool |
| WK_POOL_HEALTH_LOG_INTERVAL_SECONDS | 600 | > 0 |
| WK_POOL_HEALTH_LOG_INITIAL_DELAY_SECONDS | 600 | >= 0 |

## Deviations
- WARN (instead of INFO) with ` All database connections are in use.` when `in_use >= max`; sqlx exposes no waiter
  count like Hikari's `threadsAwaitingConnection`, so saturation is the closest signal.
- No JDBC executor (sqlx is async), JVM thread states, steal or completed-task counts; Tokio's stable metrics cover
  workers, alive tasks and the global queue only.
- The scheduler adds its usual `Completed cleanup job: pool-health-log` line after each tick.

## Tests
- Unit (`background_pool_health_log_tests.rs`): defaults, env parsing/errors, info/warn decision and message, disabled
  job spawns nothing. `system_metrics_tests.rs`: Tokio gauges rendered inside a runtime.
- DB (`tests/pool_health_log.rs`, ignored without `WK_RUST_TEST_DATABASE_URL`): one held connection -> INFO with
  `inUse=1`; all 5 held -> saturated.
