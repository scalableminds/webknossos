# Rust migration coordinator checkpoint

Updated: 2026-10-09. This is a resumable work log, not a claim of completion. The full backend-refactor goal is active and unbounded; do not mark complete when an incremental batch passes.

## ACTIVE: Claude Code coordinator (session 54cc7dc1, from 2026-10-09 07:38)

- Canonical location: MAIN checkout `backend-rust/`. The worktree copy `.claude/worktrees/webknossos-backend-rust-429edc/backend-rust` is STALE; do not edit it.
- Codex activity: no file changes after 07:35; treated as stopped. If unexpected edits appear, stop and ask the user.
- Baseline 07:45: fmt clean; clippy clean after config.rs field_reassign_with_default fix; full DB suite 106 pass / 1 fail (`tests/dataset_remote.rs` storage test fixture inserts usedStorage mags without dataset_mags/layer rows, FK `mags_ref`). Route inventory 113/287.
- Concurrency: max 2 Claude sub-agents. Each has disjoint file ownership, its own `CARGO_TARGET_DIR` (`/tmp/webknossos-rust-verify-a` / `-b`), shared `CARGO_HOME=/tmp/webknossos-rust-cargo`, and its own `checkpoints/<area>.md` updated at every milestone (Status / Done / Next step / Evidence).
- Shared files (lib.rs, config.rs, Cargo.toml, auth.rs): agents may make small additive edits (re-read immediately before editing); coordinator regenerates MIGRATION_STATUS.md and runs the central verification after each agent returns.

### Work queue (SMALL batches, <= ~8 routes or one finish-up each, so an agent finishes in one run; mark [x] when verified centrally)
- [x] A1 browser-auth core (16 routes)
- [x] B1 datasets: all 37 DatasetController routes + PathDeletion; 151 tests pass; 157/287 routes
- [x] M1 (171 tests pass) Application (buildinfo/features/checkCertificate/helpEmail) + Analytics (2) + InitialData (1)  [application_info.rs exists, wired, untested]
- [x] M2 (checkpoint time-reports.md) Time (4) + Report (2)  [time_tracking.rs, reports.rs exist, NOT wired]
- [x] M3 (checkpoint credits-publications.md) CreditTransaction (4) + Publication (2)
- [x] M4 (checkpoint organization-pricing.md) Organization remainder: POST/DELETE organizations, operatorData, pricing (4), termsOfService (3)
- [x] M5 (checkpoint users-projects.md) transferActiveTasks + PATCH /users/:id. (POST /tasks, /tasks/createFromFiles, /tasks/:id/assign, /user/tasks/request moved to annotation batches: they create annotations via tracingstore)
- [x] J1 (checkpoint jobs.md) Jobs read/list/status/cancel/retry/export/getCreditCost
- [x] J3 (checkpoint jobs-worker.md) WKRemoteWorker (4)
- [x] J4 (checkpoint voxelytics.md) Voxelytics (9)
- [ ] J2 (in progress, verify-b, checkpoint jobs-run.md) jobs/run/* (8) + accept Job tokens in auth.rs
- [ ] J5a (in progress, verify-a, checkpoint ai-models.md) AiModels read/update/delete/voxelSize + inferences list/read
- [ ] J5b AiModels training/inference runs (4) + reserveUploadToPath/finishUploadToPath — after J2
- [ ] N0 tracingstore client + annotation contract research (checkpoint annotations.md); N1..Nn Annotations (23 + IO 3), split into ~6-route batches after a contract-research pass
- [ ] R1 WKRemoteDataStore (17, split 2-3 batches); R2 WKRemoteTracingStore (8)
- [ ] Auth remainder: OIDC (3); WebAuthn auth/register (4)
- [ ] Then: differential tests vs Play, datastore, tracingstore

### Agent log
(appended by coordinator when agents start/finish)
- 07:50 started A1 browser-auth (target dir verify-a) and B1 datasets (verify-b). On resume: read their checkpoints; relaunch a fresh agent per unfinished item with the same prompt shape.
- 08:40 A1 done. Note: Rust WK_EMAIL_VERIFICATION_ENABLED defaults true, Play false (only matters with REQUIRED=true). Started A2 misc-controllers (verify-a).
- 08:20 both agents killed by usage limit. 13:30 resumed: crate builds. Per user: scope agents small enough to finish. Started B1-finish (verify-b) and M1 (verify-a).
- B1-finish DONE (SAM route + test). Started M2 (verify-b).
- M1 DONE. (done: .env.example) add M1 env vars (WK_ANALYTICS_*, WK_FEATURES_JSON, WK_BUILD_*, WK_CERTIFICATE_PUBLIC_KEY, WK_SUPPORT_EMAIL, WK_SAMPLE_*, WK_LOCAL_*STORE*) to .env.example/README. Sample org/local stores default OFF (deliberate). Started M3 (verify-a).
- M2 DONE. Cross-cutting TODO: ObjectId path extractor rejects Play's `prefix-<id>` form; fix centrally later. Started M4 (verify-b).
- M3 DONE (182/287). Started M5 (verify-a).
- M4 DONE (187 tests). Cleanup TODO: dedupe organizations::insert_organization vs browser_auth_onboarding::create_organization. Started J1 (verify-b).
- J1 DONE. Cleanup TODO: jobs.rs copies find-or-create token from auth_routes::get_token -> share. Started J3 (verify-b).
- M5 DONE (197 tests). REVIEW: users PATCH enforces checkTeamManagerOnlyUpdates which Play effectively ignores (discarded Boolean) -> self-experience edits now rejected; decide parity vs fix. Cleanup TODO: users.rs copies user-limit check from browser_auth_onboarding. Started J4 (verify-a).
- J3 DONE. Started J2 (verify-b). Users PATCH team-manager-only check: KEPT strict (deliberate security deviation: Play lets non-managers raise their own experiences -> task-eligibility escalation; team changes are filtered by requester anyway).
- J4 DONE (211 tests). Also deliberate: voxelytics storeWorkflow ownership check enforced (Play discards it). Started J5a (verify-a).

## (Superseded) Handover to Claude Code coordinator (2026-10-09 07:35) — BLOCKED, awaiting user

- Claude Code session (worktree `.claude/worktrees/webknossos-backend-rust-429edc`, branch `worktree-webknossos-backend-rust-429edc`) copied `backend-rust/` from the main checkout (rsync, `target/` excluded) at 07:33. The main-checkout copy is untouched and still the copy Codex last wrote.
- The Codex coordinator (CodexCLI pid 7169, idle at handover) last wrote checkpoints at 07:28. Its in-flight batch is UNVERIFIED: browser-auth (design only), service clients/dataset_remote (3 routes + thumbnails next), annotation_lists (6 routes, 3 DB tests written).
- The auto-mode safety check blocked cargo commands here as possible interference with that workload. The user must confirm that Codex is stopped and pick the canonical location before any build, edit or sub-agent starts.
- Once confirmed: (1) baseline `cargo fmt --check`, clippy, full DB suite against the 55439 cluster; (2) at most 2 Claude sub-agents with disjoint file ownership, each keeping its own `checkpoints/<area>.md`: A = browser-auth (`src/browser_auth.rs`), B = dataset thumbnails + remaining DatasetController routes; (3) coordinator owns lib.rs/config/Cargo/inventory and regenerates MIGRATION_STATUS.md.
- Agents in the Claude setup run cargo themselves with separate `CARGO_TARGET_DIR`s (`/tmp/webknossos-rust-verify-a`, `-b`), shared `CARGO_HOME=/tmp/webknossos-rust-cargo`, and keep their modules compiling at every step.

## User scope

Port the WEBKNOSSOS backend into `backend-rust/`. Build PostgreSQL, CRUD, and web foundations first; main application before datastore and tracingstore. Delegate to **gpt-6.1-sol** agents. Latest request: implement the next route groups and save durable checkpoints with periodic agent reports to survive usage resets.

## Repository and safety

- Worktree: `/Users/therold/Programming/scalableminds/webknossos`.
- Read root and `backend-rust/AGENTS.md`. No `rm` commands on macOS.
- All Rust work is presently untracked in `backend-rust/`; preserve it. `tools/worktree/` is unrelated existing untracked work.
- Existing Scala schema version 185 is authoritative. Never apply destructive `schema/schema.sql` to an existing database. Tests create their own uniquely named database first.
- No commits, PR, or deployment requested. No Scala/frontend files changed.

## Completed previous batch

Axum/Tokio, SQLx pool/schema checks, token authentication, errors/extractors/IDs, lifecycle/health/logging/timeouts; teams/scripts/projects/task types/folders/user preferences/organizations/maintenance/short links. Last fully verified batch: 58 of 287 application route registrations, 55 passing tests including PostgreSQL integration, fmt and clippy clean. Route count measures registrations, not complete parity.

## Current ownership

- `/root/datasets_stage2`: `src/dataset_access.rs`, `src/datasets.rs`, `src/dataset_configuration.rs`, corresponding tests. See [datasets.md](datasets.md).
- `/root/tasks_stage2`: `src/tasks.rs`, `tests/tasks.rs`. See [tasks.md](tasks.md).
- `/root/auth_routes_stage2`: `src/auth_routes.rs`, `tests/auth_routes.rs`. See [auth-lifecycle.md](auth-lifecycle.md).
- Coordinator: `src/lib.rs`, `src/config.rs`, dependencies, `src/legacy_datasets.rs`, shared visibility changes, docs/inventory, central compilation/testing.

Current follow-on delegation (same Sol 6.1 agents, resumed after their temporary quota errors):
- Dataset agent finishes serialization/configuration review fixes, then continues dataset metadata/lookup routes in its existing modules.
- Task agent now owns NEW `src/annotation_access.rs`, `src/annotation_private_links.rs`, `tests/annotation_private_links.rs`, checkpoint `annotation-private-links.md` for private-link CRUD/source.
- Auth agent now owns NEW `src/credentials.rs`, `tests/credentials.rs`, `src/data_stores.rs`, `tests/data_stores.rs`, checkpoint `credentials.md` for credential lookup/internal storage and datastore registry.
- Coordinator additionally owns `src/tracing_stores.rs` and `tests/tracing_stores.rs` (main application registry, not the separate tracingstore engine).

Agents must save checkpoints at milestones/every few minutes and report to parent. If agents are unavailable after reset, inspect their files/checkpoints before continuing; do not overwrite partial work.

## Current integration status (updated after first successful batch checks)

- New auth config and dependencies `base64 0.22`, `getrandom 0.4` wired. `auth::extract_token`, `scripts::SELECT_SCRIPT`, `task_types::PUBLIC_TASK_TYPE` exposed `pub(crate)`.
- `tasks`, `auth_routes`, `datasets`, `dataset_access`, `dataset_configuration`, `tracing_stores` modules wired. Latest/legacy datasets mounted correctly, including configurations.
- `legacy_datasets.rs` list and safe recursive largestSegmentId adapters wired with unit and PostgreSQL HTTP version test. Legacy v10–15 list default is full; `compact=true` selects compact. v10–14 full reads/lists downgrade safe bigint envelopes; v15+ retains envelopes.
- Config adds jobs/token expiry/idle/passkeys/logout redirect environment fields; tests/server_boundary literal updated.
- Initial all-target compile passed. Task integration tests 4/4 pass (initial missing required fixture booleans fixed). Auth lifecycle tests 8/8 pass including monotonic cutoff and idempotent passkey deletion.
- Dataset version test passes for latest plus v10–16. Dataset first 3 tests and configuration 2 tests pass. Additional review fixes for typed transforms/axisOrder/mappings/worker-command validation, admin configuration read permissions and personal configuration locking have since landed; revalidation in progress.
- Clippy all-targets passed before the latest review/registry changes; formatting and full suite still required after current changes.
- Current test process session 21803: datasets/config/tracing-store registry, may have completed by resume. Inspect output before restarting.
- Auth browser login/cookies/CSRF/registration/email/OIDC remain pending. Entire migration is far from complete.
- README updated; route inventory scanner now recognizes split routers and omits duplicate legacy variants. Last generated count before tracing registry was 83/287; regenerate after wiring further modules.

## Reproducible verification

Rust installed via Homebrew. Cached dependencies: `CARGO_HOME=/tmp/webknossos-rust-cargo`. Use consistent clean target directory `CARGO_TARGET_DIR=/tmp/webknossos-rust-verify` (previous default target had stale doc artifacts). Centralize Cargo runs to avoid concurrent agent contention.

Isolated PostgreSQL 15 test cluster is currently running on loopback port 55439, data `/tmp/webknossos-rust-postgres/data`, user `wk_rust_test`, socket directory `/tmp/webknossos-rust-postgres`. It was created only for this task. Restart only if stopped:

```sh
/opt/homebrew/opt/postgresql@15/bin/pg_ctl -D /tmp/webknossos-rust-postgres/data -l /tmp/webknossos-rust-postgres/server.log -o '-h 127.0.0.1 -p 55439 -k /tmp/webknossos-rust-postgres' start
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --manifest-path backend-rust/Cargo.toml --locked --offline -- --include-ignored
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify cargo clippy --manifest-path backend-rust/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo fmt --manifest-path backend-rust/Cargo.toml --check
python3 backend-rust/tools/route_inventory.py
python3 backend-rust/tools/route_inventory.py --check
```

PostgreSQL start/tests need sandbox escalation for local TCP/shared memory. No new package fetch needed for current dependencies. DB tests create fresh DBs and clean them on success; a panic may leave a generated DB for debugging. Do not bootstrap the admin URL database.

## Next concrete steps

1. Inspect session 21803. Continue new credential/registry and annotation private-link delegation from saved checkpoints.
2. Wire new modules only when actual implementations exist; run appropriate isolated DB tests, fix compilation/contract failures with owning agents.
3. Review security/concurrency and real contract behavior. Unsupported remote tracing/datastore flows must remain pending, not stubs.
4. Update README and generated route inventory. Run fmt, clippy, and full suite including ignored DB tests after integrations.
5. Keep goal active and continue the main application migration; datastore and tracingstore engine phases follow main application. Update checkpoints periodically with evidence. Stop only the isolated test cluster when work actually stops.
