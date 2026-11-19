# TW1 pure time-interaction planner/core

Updated 2026-10-10. Status: **TW1 complete** (pure planner + per-user cache state + inline tests). No DB executor, SQL, mail, HTTP routes, clock or randomness. Contract research remains in time-interaction-writer.md. Owner edited only src/time_interaction.rs and this checkpoint.

## Done

Public API in `src/time_interaction.rs` (module already registered in lib.rs):
- `TimeInteractionConfig::new(pause_millis)` (1..=MAX_DURATION_MILLIS) / `Default` = `DEFAULT_PAUSE_MILLIS` 60000.
- `plan_interactions(&config, cached: Option<&SpanSnapshot>, annotation_id, timestamps: &[i64]) -> Result<Option<InteractionPlan>, TimeInteractionError>`; `Ok(None)` for empty input (caller logs warning, no cache/SQL). Any `Err` = no writes, no cache change.
- `InteractionPlan { inserts: Vec<PlannedInsert>, closes: Vec<PlannedClose>, next_cached: PlannedSpan }`, both lists in Scala prepend-flush order (newest first). `SpanRef::{Existing(ObjectId), New(ordinal)}`; ordinal = chronological creation index. `PlannedClose { span, before, after, delta_millis }` (after = absolute row values; delta ≥ 0). `SpanState { annotation_id: Option, time_millis, last_update_millis, number_of_updates, created_millis }`. `new_span_count()`, `next_cached_snapshot(&new_ids)`, `SpanRef::resolve(&new_ids)`.
- `TimeInteractionState` (Clone, Default; process-local `userId -> Option<SpanSnapshot>`, starts empty, never loaded from DB) with `lock_user(&user).await -> UserActivityGuard` (per-user tokio mutex); guard `cached()`, `plan(..)`, `publish(snapshot)` (consumes; drop = rollback).
- `is_potential_contributor(user, owner, collaboration_mode_str)` = owner || Exclusive/Concurrent.
- Constants `MAX_DURATION_MILLIS` (Scala FiniteDuration ms bound 9_223_372_036_854), `MIN_STORABLE_MILLIS` (PG 4714-11-24 BC), `MAX_STORABLE_MILLIS` (chrono max).
- Semantics: unsorted input, cached gap `< pause` continues (negative too), equality interrupts, short-gap switch closes old span at first timestamp (old annotation credited; legacy None annotation = switch), negative closes skipped without count, zero delta counts, new span count starts 0, wrapping Long subtraction + FiniteDuration range check, wrapping time/count addition (Scala parity). Deviation: persisted timestamps outside chrono/PG range are rejected up front instead of failing mid-flush.

## Evidence

- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-a cargo test --locked --offline --lib time_interaction` → 19 passed, 0 failed.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-a) → clean. `rustfmt --edition 2024 --check src/time_interaction.rs` → clean.

## Next (parent / TW2)

Parent: add tokio `sync` feature explicitly to Cargo.toml (currently compiles via feature unification; main.rs oneshot relies on it too). Add config `WK_TIME_TRACKING_PAUSE_MILLIS` (default 60000, via `TimeInteractionConfig::new`) and `WK_TIME_TRACKING_ONLY_WITH_SIGNIFICANT_CHANGES` (default false); add one shared `TimeInteractionState` to AppState/extension.

TW2 executor requirements:
1. Order: `guard = state.lock_user(user).await` BEFORE `pool.begin()`; `plan = guard.plan(..)?` (None → return Ok, no tx). Map `TimeInteractionError` to a failure response (Scala: exception → Fox failure).
2. Allocate `ObjectId::new()` per insert, `ids[ordinal]`; resolve `SpanRef`s.
3. In one transaction, inserts in `plan.inserts` order: `INSERT INTO webknossos.timespans(_id,_user,_annotation,time,lastUpdate,numberOfUpdates,created,isDeleted)` with time 0, numberOfUpdates 0 explicitly (schema default is 1), lastUpdate=created, isDeleted false.
4. Then for each close in `plan.closes` order: `UPDATE webknossos.timespans SET _user,_annotation,time,lastUpdate,numberOfUpdates,isDeleted WHERE _id` (absolute `after` values, not created); if `after.annotation_id` is Some: `UPDATE webknossos.annotations SET tracingTime=COALESCE(tracingTime,0)+delta WHERE _id` (global); reload annotation through caller access context (failure aborts the tx, as Scala fails the chain); if it has `_task`: `UPDATE webknossos.tasks SET tracingTime=COALESCE(tracingTime,0)+delta` (global); record threshold candidate (annotation tracingTime after, delta).
5. Lock affected annotation/task rows in one stable order (e.g. sorted ids, tasks `FOR NO KEY UPDATE`) before the updates to avoid cross-user deadlocks; SQL overflow → rollback.
6. On commit: `guard.publish(plan.next_cached_snapshot(&ids)?)`, then best-effort over-limit mail (crossing `tracingTime >= expectedTime && tracingTime - delta < expectedTime`, project owner email; subject/body in time-interaction-writer.md). On error/drop: no publish, no mail.
7. Tests (isolated DB): fields/counts/created, null totals → 0, switch credits old annotation+task, rollback leaves cache unchanged, threshold mail once, missing expectedTime harmless.

# TW2 transactional executor (src/time_interaction_writer.rs)

Updated 2026-10-10. Status: **TW2 complete** (library only, no routes). Owner edited only src/time_interaction_writer.rs, NEW tests/time_interaction_writer.rs and this section; no lib/config/Cargo/time_interaction.rs changes.

## Done
- `TimeInteractionWriter::new(TimeInteractionState, TimeInteractionConfig, OverLimitNotifier)` (Clone; one per app, parent builds it from `config.time_tracking.interaction`, the shared state, the app `MailSender` and public URI). `OverLimitNotifier::new(mailer, public_uri)` trims trailing `/` (Play `conf.Http.uri`).
- `writer.log_user_interaction(&pool, AccessContext, &user_id, &annotation_id, &[i64]) -> ApiResult<()>`: empty -> warn + Ok (no lock/tx); else lock_user -> begin -> apply -> commit -> publish cache -> mail.
- `writer.log_user_interaction_if_potential_contributor(&pool, access, &user_id, &annotation_id, &owner_id, collaboration_mode, timestamp)`: no-op unless owner or Exclusive/Concurrent.
- Low level for callers owning a transaction: `apply_interactions(&mut tx, &guard, &config, access, &annotation_id, &ts) -> ApiResult<Option<PendingInteraction>>` (guard must be taken BEFORE `begin`), then after commit `pending.publish_after_commit(guard, &pool, writer.notifier()).await`; drop on rollback.
- Executor: lock credited annotations (global, incl. deleted) sorted `FOR NO KEY UPDATE`, then their tasks sorted `FOR NO KEY UPDATE`; inserts (plan order, explicit time 0/numberOfUpdates 0, lastUpdate=created, isDeleted false, ids `ObjectId::new()` per ordinal); closes (plan order): absolute span UPDATE (no created), global `annotations.tracingTime=COALESCE(..,0)+delta`, reload via `annotation_access::find_optional(tx, access.requester, id, access.global)` (None -> 404, rollback), global task increment; legacy None annotation = span update only.
- Over-limit mail: crossing `t>=expected && t.wrapping_sub(delta)<expected` with t = row-locked post-update annotation total per close; live owner/multiUser/task/project/expectedTime/project-owner lookup after commit, failures logged+swallowed. Mail built in this module (`over_limit_mail`, exact Scala subject/recipient, plain-text body with `{uri}/annotations/Task/{id}`) and sent via shared `MailSender` (LogMailer default does not deliver SMTP — crate-wide limitation). No fake sends.
- Error mapping (`impl From<TimeInteractionError> for ApiError`): DurationOutOfRange -> 500 (Scala uncaught IllegalArgumentException); TimestampNotStorable -> 400 (Scala fails at SQL as Fox Failure); InvalidPause/NewSpanIdCount -> 500. Reload Empty -> 404 `Could not find or access the requested resource.` (Play Msg.notFound). SQL errors -> crate `From<sqlx::Error>` (overflow 22003 -> 400 `Invalid resource values.`; Scala used 400 with internal FAILED chains).
- Improvements over Scala (documented in module docs): atomic plan, cache published after commit, per-user serialization, row-locked threshold crossing (no duplicate mails).

## Evidence
- `cargo test --locked --offline --test time_interaction_writer -- --include-ignored` (verify-a, PG 55439) -> 6 passed: new span insert + extension + task propagation + empty no-op; pause split without idle credit; short-gap switch credits old annotation/task; rollback on unreadable reload (404), BIGINT overflow (400) and planner error (500) leaves rows/totals/cache unchanged, global context succeeds; over-limit mail exactly once + missing expectedTime harmless; contributor gate.
- `cargo test --lib time_interaction_writer` -> 2 passed (mail format, error mapping). Clippy all-targets -D warnings clean; rustfmt --check clean.

## Next (callers)
- Parent: build one `TimeInteractionWriter` in app assembly (Extension) sharing a single `TimeInteractionState`.
- finish/finishAll: after finish state commit + provider reload, call `log_user_interaction_if_potential_contributor` with requester `AccessContext::requester(Some(user))`, ORIGINAL annotation owner/collaboration mode, client `timestamp`; finishAll per item serially, stop at first error.
- info: authenticated + timestamp + typ Task/Explorational -> contributor-gated call with requester context.
- handleTracingUpdateReport: if user resolved && (significant>0 || !only_with_significant_changes) -> `log_user_interaction(pool, AccessContext::global(None), user, annotation, &timestamps)` (no gate).
