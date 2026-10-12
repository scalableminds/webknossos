# Rust migration coordinator checkpoint

Updated 2026-10-09 19:11 UTC. Active coordinator: Codex /root, resumed by explicit user request. Canonical directory is the main checkout `/Users/therold/Programming/scalableminds/webknossos/backend-rust`. Prior Claude coordinator log is preserved in [coordinator-2026-10-09-history.md](coordinator-2026-10-09-history.md); its ownership/session instructions are historical.

The full Rust backend migration goal remains active. Main application first, then datastore and tracingstore engines. A green route batch is not completion. Keep all work in backend-rust; preserve unrelated tools/worktree. No rm on macOS. No commits, deployment or PR requested.


## Superseded (2026-10-09 19:50 local): Claude Code coordinator resumed by explicit user request ("keep going until the queue is done")
- Codex coordinator idle since 16:30 local (no edits since); its queue below is adopted unchanged. If Codex resumes, STOP and coordinate (one coordinator at a time).
- Max 2 Claude sub-agents, each with a small bounded batch (<= ~6 routes), own checkpoint file, verify-a / verify-b target dirs.
- Agent log (Claude):
  - 19:55 started N1 annotation infra (tracingstore client + protobuf + saved provider; no routes; verify-b; status in annotations.md) and J5b-1 (AI upload-to-path 2 routes + expose job_submission helpers; verify-a; ai-models.md).
  - J5b-1 DONE (238 tests). Started J5b-2 training (verify-a).
  - N1 DONE (245 tests; prost/protox build.rs codec, tracingstore_client, saved provider; compound -> 501). Started N2 compound provider+cache (verify-b).
  - J5b-2 DONE (247 tests). Started J5b-3 inference (verify-a).
  - J5b-3 DONE (258 tests, 225/287). AiModelController complete. Started R1 datastore callbacks: status, datasource(s), realpaths, GET/PUT datasources/:id (verify-a, remote-datastore.md). R2 = 7 upload reserve/report; R3 = deleteDataset/findDatasetId/findDatasetLocalRootPath/jobExportProperties; R4 = 8 tracingstore callbacks (needs N2 temp data-source store).
  - N2 DONE (compound provider + 60-min cache + temp data-source store; 258 tests). Possible flake: ai_models::inference_submits_paid_job_with_target_mag_cost_and_inference_atomically failed once, passed on rerun — 6/6 isolated reruns pass after J5b-3 finished; likely observed while J5b-3 was mid-edit. Recheck in next full central run. Started N3 4 metadata routes (verify-b).
  - N3 DONE (4 metadata routes, 265 tests). Annotation batch plan (details in annotations.md "Status N3"):
    N4 lifecycle DB-only (finish x2, reopen, DELETE x2, collaborationMode) [started, verify-b];
    N5 mutex/reservedIds/transfer (5); N6 info x2 + sandbox + createExplorational (4);
    N7 tracingstore writes: duplicate, reset, merge x2, tasks/:id/assign (5) + R4 tracingstore callbacks (8) alongside N6/N7;
    N8 user/tasks/request, POST /tasks, /tasks/createFromFiles (3); N9 annotation IO upload/download x2 (split upload vs download).
  - Planned next: J5b-2 training (2), J5b-3 inference (2), N2 compound provider+cache, N3 4 metadata routes, then remaining annotation lifecycle/IO/task-creation in ~6-route batches, R1-R3 datastore callbacks, R4 tracingstore callbacks, OIDC, WebAuthn.

## ACTIVE: Codex resumed 2026-10-09 19:12 UTC

- Latest user says continue and see coordinator.md. A read of the exact Claude coordinator54cc7dc1 transcript confirms N4 and R1 agent turns terminal FAILED at18:30UTC due account spend limit, coordinator stopped; no cargo/rustc processes at takeover. R1 checkpoint/code completed before its terminal notification. Do not treat the old ACTIVE claim below as live work.
- New external progress adopted: all13 AI routes, annotation proto/client, saved+compound provider/cache, four metadata routes, six datastore callbacks. Inventory now235/287; prior267-test report must be centrally revalidated. Earlier230-test evidence is historical.
- Small Sol6.1 assignments NOW: `/root/ai_models_finish` owns R3 four callbacks in new remote_datastore_lookup.rs/tests + checkpoint remote-datastore-lookup.md, and narrow shared delete_from_db extraction in dataset_lifecycle.rs. `/root/annotation_contracts` owns N4b three routes (DELETE typed/untyped annotation, collaborationMode) in new annotation_lifecycle.rs/tests + checkpoint annotation-lifecycle.md. No training/upload work or duplicate codec modules.
- Parent owns tracingstore_client.rs/tests codec correction (deep proto2 required fields/unknown wire compatibility), lib/config/Cargo/docs and central verification. No other module edits authorized to agents without coordinating.
- Report and save checkpoints at milestones/~3minutes. Each assignment ends at its stated bounded batch. Agents use verify-a/verify-b, parent uses verify. No schema bootstrap except fresh TestDb.
- Remaining N4a finish/finishAll/reopen is not implemented; needs time-interaction writer/config/cache invalidation. Then N5–N9 and R2/R4 (scope below). Full migration stays active.

## Completed bounded Sol 6.1 assignments

- `/root/jobs_run_finish`: J2 complete. Eight jobs/run routes, valid Job token authentication, paid reservation/refund audit semantics, storage/worker checks and atomic failures. Files: job_submission.rs, auth.rs, tests/job_submission.rs, tests/authentication.rs. Recovery details [jobs-run.md](jobs-run.md).
- `/root/ai_models_finish`: J5a complete. Seven AI model CRUD/voxel-size and inference read routes with real HTTP datastore mocks and permission/rollback coverage. Details [ai-models.md](ai-models.md).
- `/root/annotation_contracts`: bounded read-only research for four annotation metadata/sharing routes completed. No code/routes claimed. Details [annotations.md](annotations.md).
- Parent integrated modules and corrected ObjectId contracts: uppercase hex normalization; URI path prefixes only; JSON/query prefixes rejected; String-backed script/project/task-type/folder IDs normalize before SQL; callback resource IDs normalize too. Regression tests cover typed/tuple binding, preserved layer names, user and script paths, JSON owner IDs and folder queries.
- All agents finished; no overlapping file ownership remains. Resume with fresh small assignments after reading actual files/checkpoints. Save Status / Done / Next / Evidence at milestones and roughly every three minutes; report concise progress to parent. Parent owns lib/config/Cargo/inventory and central checks.

## Verification and current evidence

- Full integrated central suite (session87523) succeeded: **230 tests passed, 0 failed, 0 ignored**, including PostgreSQL, local HTTP, auth/token concurrency and process lifecycle tests. Log `/tmp/webknossos-rust-j2-j5a-verification.log` (53 harness summaries including empty main/doc harnesses).
- `cargo fmt --check`, `cargo clippy --locked --offline --all-targets -- -D warnings`, and route inventory `--check` passed. Latest clippy session1312 exit0 includes final callback normalization.
- Final callback normalization landed after full suite: focused tests/user_access passed 2/2 in session9440 (exit0), including uppercase resource IDs. No other code changes since the full suite.
- Inventory regenerated: **219/287 main application route registrations**, up from 204. Registration coverage is NOT behavioral parity or overall migration completion.
- Baseline recovery suite 211 also passed. Both J2 and J5a have additional agent focused/unit verification in their checkpoints. No Scala differential run or real compute worker run has been performed.
- Isolated PostgreSQL remains running at 127.0.0.1:55439. The ordinary PostgreSQL service/databases are unrelated and must not be used for destructive schema bootstrap.
- README and generated inventory prose refreshed to reflect actual browser/dataset/account/jobs progress and the remaining SMTP/external-side-effect/background-worker gaps.

## Queue (completed route groups, remaining work)

Completed groups per prior checkpoints: PostgreSQL/Axum foundation; teams/scripts/folders; users/projects/task types/task reads; token/browser auth and onboarding; all DatasetController routes and path deletion; application info/analytics/initial data; time/reports; credits/publications; organization/pricing/terms; jobs reads/worker callbacks; voxelytics. Review against Scala and broaden differential coverage before replacement claims.

1. J5b next: split into **two AI upload-to-path routes**, then **two model-training routes**, then **two model-inference routes**. Existing AiModelController, ai_models.rs, dataset_upload_paths.rs and job_submission.rs are references. Shared J2 submission helpers are currently private; expose a coherent helper boundary centrally rather than duplicating job/credit/storage logic. Do not assign all six at once.
2. Annotation provider prerequisites before four metadata/sharing routes: saved-type alias parsing is straightforward, but compounds require parent DAO authorization, real tracingstore merge protobuf RPC, temporary data-source registration and a 60-minute type+ID cache. annotations.md records exact contracts and traps. Do not replace compound support with a persisted annotation lookup or claim full routes for saved-only variants.
3. Split provider/codec/cache, annotation lifecycle/IO and task-creation into separate bounded tasks (23 AnnotationController + 3 IO + 4 task routes remain).
4. Main-app datastore callbacks (17) in 2–3 batches and tracingstore callbacks (8).
6. Real mail delivery and other deferred integrations/background tasks; differential Play tests, observability/performance, schema ownership and cutover.
7. Datastore engine, then tracingstore engine including binary formats/codecs/FossilDB/update concurrency.
8. Remaining auth OIDC (3), WebAuthn ceremonies (4).

## Reproducible verification

CARGO_HOME=/tmp/webknossos-rust-cargo. Parent CARGO_TARGET_DIR=/tmp/webknossos-rust-verify; J2 verify-b; J5a verify-a. Avoid concurrent builds in the same target. PostgreSQL15 test URL: postgres://wk_rust_test@127.0.0.1:55439/postgres. Tests create a fresh wk_rust_test_<uuid> and bootstrap only that DB; schema185 remains Scala-owned. Network tests need sandbox escalation.

```sh
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --manifest-path backend-rust/Cargo.toml --locked --offline -- --include-ignored
CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify cargo clippy --manifest-path backend-rust/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo fmt --manifest-path backend-rust/Cargo.toml --check
python3 backend-rust/tools/route_inventory.py
python3 backend-rust/tools/route_inventory.py --check
```

Restart only if PG is stopped: `/opt/homebrew/opt/postgresql@15/bin/pg_ctl -D /tmp/webknossos-rust-postgres/data -l /tmp/webknossos-rust-postgres/server.log -o '-h 127.0.0.1 -p 55439 -k /tmp/webknossos-rust-postgres' start`.
