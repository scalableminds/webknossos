# Voxelytics (batch J4)

Owner files: `src/voxelytics.rs` (handlers/JSON/request models), `src/voxelytics_dao.rs` (VoxelyticsDAO SQL),
`src/voxelytics_loki.rs` (LokiClient), `tests/voxelytics.rs`.
Shared edits (additive): `src/lib.rs` (`pub mod voxelytics; mod voxelytics_dao; mod voxelytics_loki;`,
`voxelytics: VoxelyticsConfig` in RouteOptions + all constructors, `.merge(voxelytics::router(voxelytics))`,
new `router_with_voxelytics(state, misc, voxelytics)`), `src/config.rs` (`Config.voxelytics`, `voxelytics_config()`
env parsing + 3 invalid cases in the config unit test), `tests/server_boundary.rs` (`voxelytics: Default::default()`).

## Status
- Status: done (9/9 routes implemented, wired, tested; full suite green).
- Done: POST/GET /voxelytics/workflows, GET/DELETE /voxelytics/workflows/:hash, POST .../events,
  GET .../chunkStatistics, GET .../artifactChecksums, POST/GET /voxelytics/logs.
- In-flight: none.
- Next step: coordinator regenerates MIGRATION_STATUS.md; add env vars below to .env.example/README.
- Evidence: tests/voxelytics.rs 2 DB tests pass (full workflow/events/report/statistics/delete flow; Loki mock with
  /ready polling, push, batched query); 6 unit tests in src/voxelytics*.rs; clippy --all-targets -D warnings clean;
  rustfmt --check clean for all touched files; full DB suite (`--no-fail-fast -- --include-ignored`, verify-a)
  211 passed / 0 failed.

## Config
- Feature flag: `features.voxelyticsEnabled` from MiscState (set via `WK_FEATURES_JSON='{"voxelyticsEnabled":true}'`);
  default false -> every route 400 "Voxelytics workflow reporting and logging are not enabled ...".
- `WK_VOXELYTICS_STALE_TIMEOUT_SECONDS` (default 1200), `WK_VOXELYTICS_LOKI_URI` (default empty = Loki disabled,
  validated http(s) without credentials/query), `WK_VOXELYTICS_LOKI_TENANT` (X-Scope-OrgID), `WK_VOXELYTICS_LOKI_USER`,
  `WK_VOXELYTICS_LOKI_PASSWORD` (basic auth; redacted in Debug), `WK_VOXELYTICS_LOKI_STARTUP_TIMEOUT_SECONDS` (60).
- Loki `wk_url` label = MiscConfig.public_uri (WK_PUBLIC_URL without trailing slash), as Play's http.uri.

## Contract notes
- SQL ported 1:1 (runs/tasks/chunks-with-state STALE derivation, visibleRunsQ, latest chunk/task states, artifacts
  with foreignWorkflow, task counts, chunk statistics, checksums). Stale timeout bound as ms; IN-lists as `= ANY($n)`;
  multi-row VALUES upserts as one `jsonb_to_recordset($2)` statement (same "affect row twice" semantics: e.g. two
  heartbeats in one request -> 500 as in Play). Aggregates cast to BIGINT/FLOAT8; NULL doubles -> 0.0 (Slick getDouble).
- JSON: case-class outputs omit None fields; Json.obj outputs write null (listing beginTime/endTime/taskCounts,
  report task beginTime/endTime/currentExecutionId, workflow.yamlContent). Timestamps in epoch ms. foreignWorkflow
  = [hash, runId]. Run sort: beginTime desc, missing last (sortBy.reverse).
- Errors: listing 404 "No voxelytics tasks found."/"No voxelytics workflows found."; report 404 "Voxelytics workflow
  not found." / "Voxelytics workflow runs not found."; events: run lookup (admin: any run of org; others: own) 404,
  storage failures 500; DELETE: non-superuser 400 superUserOnly, hash unknown in ANY org 404, deletes only in the
  user's org + clears jobs._voxelytics_workflowHash (one transaction); logs: run not in org 404 Msg.notFound,
  Loki unconfigured 400 "Loki is not enabled." (empty push and limit<=0 query succeed without Loki), upstream
  non-2xx status preserved with generic "Loki request failed.", startup wait timeout 500.
- Events are stored in one transaction in type declaration order (run, task(+artifacts), chunk, heartbeat,
  profiling, checksum) in batches of 500; Play used class-hash order without a transaction.
- storeWorkflow runs in one transaction (Play: parallel, no transaction).

## Deviations / gaps (for review)
- storeWorkflow: Play's `checkAuthForWorkflowCreation` result is discarded (Scala value discard), so any org member
  could take over another user's run. Rust ENFORCES the intended check: 401 "Voxelytics workflow run already exists
  by another user." unless admin or the run is new/own. getLogs keeps Play's effective behavior (any run of the org,
  consistent with allowUnlisted report access) — its discarded ownership check is NOT enforced.
- artifactChecksums without artifactName: Play generated invalid SQL (`WHERE ORDER BY`) and failed; Rust returns all
  artifacts of the task (frontend always passes artifactName).
- Loki: LogQL values are quoted/escaped (Play interpolated raw run/task names) and the org id is regex-escaped in
  `wk_org=~`; failed startup waits are retried by later requests (Play memoized the failure in a lazy val);
  non-Z `@timestamp` parsed as 24h `%Y-%m-%dT%H:%M:%S%.f` local time (Play's SimpleDateFormat used 12h `hh` and
  lenient millis); redirects are not followed (credentials); response size capped at 64 MiB; defensive stop if Loki
  returns entries at/after the window end.
- Event `type` missing/unknown -> 400 (Play threw -> 500). Long JSON fields accept only integral numbers.
