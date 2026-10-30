# Main application cutover: differential tests, observability, schema ownership, staged traffic

Owner: Claude Code (Opus 5.5) session started 2026-10-16. Scope: the main application (`backend-rust/src`) versus Play (`app/`). The datastore DS6 work has its own checkpoints (datastore-ds6-*.md); the tracingstore engine stays Scala.

## Status

Round 3 DONE 2026-10-25 (branch `diff-coverage`): fresh baseline on `rust` 2fad899ff2 plus seven new corpora; route coverage 191 → **287/287** (`tools/app_differential/coverage.py`, guarded in CI with `--min 287`). Every step matches or is declared except the open bad-token policy item (2 steps). Open: policy decision (invalid credentials), store RPC token blocker (needs Play change). See Round 3 and Next.

## Plan (step by step; each step ends with a checkpoint update here)

- **C1 Differential tests against Play**
  - C1a Isolated environment: compile/stage Play from this worktree (Scala on the rust branch is unchanged since merge base bfdb3eef0f, so it is the authoritative oracle). Fresh database `wk_diff_seed` from `schema/schema.sql` (newly created, never an existing DB), Play inserts its sample initial data on first start, then `CREATE DATABASE … TEMPLATE wk_diff_seed` gives identical `wk_diff_play` / `wk_diff_rust` copies. Isolated Redis, no FossilDB/SMTP/Slack/analytics reach outside.
  - C1b Harness `tools/app_differential/`: stdlib Python. Replays a corpus of request steps against both servers, captures per-side values (created IDs), compares status/headers/JSON with a *consistent ObjectId bijection* (a generated id must map 1:1 across sides for the whole run) and bounded timestamp tolerance; reports categorical mismatches without secrets. After mutating sequences, dumps both databases table by table and diffs them under the same bijection (catches side-effect divergence that responses hide).
  - C1c Read corpus across all GET routes reachable with seeded data; C1d mutation sequences (teams, projects, task types, tasks, users, folders, datasets settings, annotations where the tracingstore allows); C1e triage: fix Rust bugs, record deliberate divergences with reasons in the corpus (`expected_divergence`), never blanket-ignore.
- **C2 Observability/performance**: latency/throughput comparison on the read corpus at fixed concurrency (p50/p95/p99, errors), resource use, log/request-id/metrics review against what operators need for a canary; add missing pieces (e.g. metrics endpoint) only if small and justified.
- **C3 Schema migration ownership**: document and enforce who owns schema evolution during and after cutover (Scala evolutions stay authoritative; Rust `SCHEMA_VERSION` guard; CI check that Rust compiles against the current schema; process for bumps).
- **C4 Staged traffic cutover**: route classification (read-only/idempotent/mutating/side-effectful), proxy allowlist design, shadow → canary → full stages with entry/exit criteria and rollback, runbook.

## Done

- C1a environment DONE (2026-10-16): `sbt -java-home <jdk21> -batch stage` in this worktree (48 s, JNI built), Rust `cargo build --release --locked` (59 s). `tools/app_differential/stack.py` (seed/reset/start/stop/status) owns the topology: Play :19590 on `wk_diff_play` (embedded stores), Rust :19591 on `wk_diff_rust` + Scala standalone datastore :19595 / tracingstore :19596 calling back Rust, shared isolated Redis :19592 and FossilDB :19593 (jar from main clone, v0.1.37, temp data dir). Seed: fresh `wk_diff_seed` from schema.sql + Play's own initial data (1 org, 2 users, 6 datasets, 5 AI models, project/task type/publications); clones via `CREATE DATABASE … TEMPLATE`. Rust env mirrors Play's dev conf (features JSON fetched from Play's /api/features, signer secret, sample org, email verification off).
- C1b harness DONE (first version): `tools/app_differential/replay.py` — per-side captures, id bijection (seed ids must be identical), run-time timestamp tolerance, explicit side rewrites (Rust store URLs → Play's), declared corpus-wide header divergences, `--db-diff` table diff. Corpus `corpus/read.json` (123 GET steps incl. anonymous/invalid token/missing/invalid id).
- First read run: 80/123 match. After fixes: **120/123 match, 2 declared divergences, 1 open policy item; DB diff 0 differing tables** (report /tmp/wk-diff/read-report-6.json, 2026-10-17).

## Fixes made from the differential (all in backend-rust)

- **Credits granted twice / mutex expiry skew (data corruption in mixed deployments):** sqlx pins `TimeZone=UTC`, Play's JDBC sessions use the JVM zone. `hand_out_monthly_free_credits` (DATE_TRUNC on NOW()) and the zone-less `annotation_mutexes.expiry` depend on it, so Rust re-granted the month's credits and would misread Play's mutex expiries. New `DatabaseConfig.session_time_zone` set per connection via `after_connect` (`set_config('TimeZone', …)`; the startup `options` route would be overridden by sqlx's explicit param). Resolution like the JVM: `WK_DB_TIME_ZONE`, else `TZ`, else `/etc/localtime` link, else UTC (config.rs `session_time_zone`, unit test). **Deployment rule: Play and Rust must use the same zone (ideally both UTC).**
- **Token touched on every request:** Rust's authenticate was an `UPDATE … RETURNING` per request (row lock + new tuple; parallel requests with one token serialize). Now a CTE reads, and touches only tokens with `idleTimeout` (Silhouette `touch` semantics). tests/authentication.rs adjusted.
- 401 body now Silhouette's `{"success":false,"message":"Authentication required"}` (error.rs).
- `Access-Control-Allow-Origin: *` + `Max-Age: 600` on successful dataset list (latest and legacy), shared `util::cors`.
- Admin dataset view config lists only layers with an admin configuration (dataset/configuration.rs).
- New `src/msg.rs` (subset of Play's Msg.scala, same names). Replaced 31 raw message keys (`task.unavailable`, `project.notFound`, `notAllowed`, …) that the frontend would have shown verbatim, and success messages (`task.editSuccess` …). Not-found texts for users/datasets (incl. anonymous "consider login")/maintenances/organizations; folder not-found and missing short link now 400 like Play.
- Unsupported API version (`/api/v9/...`) returns Play's ApiVersioning message.
- Dataset sharing token generated like RandomIDGenerator (16 bytes base64url).

- C1d admin CRUD corpus `corpus/admin_crud.json` (79 steps: teams, users, scripts, task types, projects, folders, datasets incl. teams/sharing/configs, maintenances, short links, organization, deletes, negative cases, user2 via cookie login): **78 match, 1 declared divergence, 0 mismatches, DB diff 0 tables** (/tmp/wk-diff/crud-report-2.json). Fixes: duplicate project/task-type names 400 (Play) instead of 409; theme update of other users uses Msg.notAllowed; short-link mismatch text. Tests adjusted (folders 400, short link 400, 401 body, duplicates). Harness: embedded run-time ms in strings (`name.deleted.at.<ms>`) normalized.

- C1d annotation/task corpus `corpus/annotations_tasks.json` (57 steps through both real tracingstores + FossilDB): **56 match, 1 declared divergence; DB: only the declared timespans consequence** (/tmp/wk-diff/ann-report-4.json). Fix: annotation `tags` keep stored order with the dataset name appended (Scala small-Set insertion order) instead of alphabetical. Harness: UUID bijection, zip-by-entry comparison, id suffixes in download names, positional pairing of ids inside messages, `unordered_keys`, `db_divergences`.
- **Combined run of all three corpora on fresh clones: 259 steps, 254 match, 4 declared, 1 open (policy); DB: 1 declared table** (/tmp/wk-diff/all-report-1.json, 2026-10-17). Harness documented in tools/app_differential/README.md.

- C1e auth corpus `corpus/auth.json` (39 steps: login form/JSON/wrong/unknown, cookie and token sessions, token issue/delete, datastore token, register incl. invalid variants, invites, password reset start/bad token, password change, logout, logoutEverywhere): **35 match, 3 declared, 1 open (policy); DB diff 0 tables** with `db_random_columns` masking random secrets (/tmp/wk-diff/auth-report-3.json). Harness: Set-Cookie attribute comparison (values/expiry masked). Tests: tag-order expectations updated (annotation_info, annotation_lists).
- Rust suite after all fixes so far: 603 passed + the 2 tag-order tests fixed afterwards (focused rerun 9/9); log /tmp/wk-diff/logs/cargo-test-2.log.

- C2 performance (tools/app_differential/bench.py + volume.sql: 2,006 datasets, 302 users, 5,000 annotations; oha in /tmp/wk-diff/tools): first run found the **compact dataset list 2-4x slower than Play** (Rust c=1 p50 35.6 ms vs 16.3; c=32 113 vs 415 rps). Causes measured with EXPLAIN ANALYZE on the reconstructed statement: per-row correlated subplans (access predicates under OR, layer names, storage) and `jsonb_build_object` per row (~8 ms of 25). Fixes: dataset READ/EDIT predicates rewritten with uncorrelated `IN (…)` sets (hashed once; same semantics incl. Rust's stricter live/same-organization rules; new explicit `COMPACT_EDIT_PREDICATE` replaces a fragile string replace), list query set-based (selection+limit first, grouped joins for large selections, LATERAL lookups for limit ≤ 500), JSON built in Rust from a `CompactDataset` struct. Result: compact list c=1 p50 13.9 ms (Play 17.4), c=32 339 rps (Play 327); search limit 20 at parity (2.8 vs 2.5 ms; 2376 vs 2415 rps). Corpora still match. Play's full (non-compact) v12 list costs ~14.5 CPU-s per request for 2006 datasets (Play-side).
- C2 observability: access log (TraceLayer on_response INFO with status/latency, `request_id` + route template in the span; raw URIs never logged — verified a `?token=` value does not appear) and Prometheus `/metrics` on a separate opt-in listener `WK_METRICS_BIND` (src/system/metrics: request counter + latency histogram by method/route/status, DB pool gauges, start time, build info; unit test). Memory note: macOS RSS overstates (purgeable pages); physical footprint after load 188 MiB (peak 235). Re-measure on the Linux deployment target.
- C3 schema ownership: tests/schema_version.rs guards `SCHEMA_VERSION` against schema.sql and the newest evolution; CUTOVER.md §3 has the ownership/upgrade rules. Rust is not in CI (no cargo in .github/workflows) — recommended job described in CUTOVER.md.
- C4 staged cutover: CUTOVER.md §2 (coexistence on one database: same TZ, same cookie secret, time tracking is process-local in both → move all time-tracking routes together and keep one Rust instance or user-sticky routing, background jobs only in one app, store callbacks via proxy), §6 (stages 0-5 with entry/exit criteria, non-mirrorable GETs, rollback).
- Verification after all changes: `cargo test -- --include-ignored` **608 passed, 0 failed** (/tmp/wk-diff/logs/cargo-test-3.log), clippy `-D warnings` clean, fmt clean, route inventory check clean.

- C2 follow-ups after the first full benchmark: (1) `EnvFilter` span-lock contention found by `sample` on a symbolized build (time overview c=32: 5.5 ms CPU/req, capped at 1.6k rps) → main.rs uses the lock-free `Targets` filter for plain RUST_LOG directives (falls back to EnvFilter for span/field directives) → 6.2k rps (Play 4.9k); compact dataset list c=32 now 448 rps (Play 409). (2) Generic vs custom plans measured per query: users listing runs unprepared (`.persistent(id.is_some())`: generic 23 ms vs custom 1+9 ms), dataset and annotation lists keep cached plans (planning 11-14 ms!). (3) Readable annotations: two-step query (page of ids first, JSON for the page only): p50 9.4 → 8.0 ms, c=32 559 → 735 rps (Play 6.5 ms / ~1150 rps). Remaining slower than Play: users list (11 vs 8 ms; 450 vs 1450 rps at c=32) and readable annotations — Postgres-bound query shapes, follow-up.
- Verification after the performance changes: 608 tests passed, clippy/fmt clean; **all four corpora on fresh clones: 298 steps, 289 match, 7 declared, 2 open (same policy item); DB: 1 declared table** (/tmp/wk-diff/all-report-2.json).
- C4 coexistence (`tools/app_differential/coexist.py`, second Rust instance on Play's database): **14/14 pass** — cookies and API tokens across backends both ways, annotation created via Play/edited via Rust identical on both, Exclusive-mode mutex respected both ways, Rust credit ticker does not duplicate Play's grant (TZ fix). **KNOWN BLOCKER:** store RPC token — Play's `RpcTokenHolder.webknossosToken` is random per process; a Rust-issued tracingstore call validated by Play (store's webKnossos.uri) gets 403. Needs a small Play change (configurable token shared with `WK_RPC_TOKEN`).

## Final benchmark (2026-10-17, after all fixes)

Identical clones with volume.sql (2,006 datasets / 302 users / 5,000 annotations), Apple M2 Pro, local PostgreSQL 15, 20 connections each, oha 8 s per level after 5 s warmup, sides alternating. Play's process also hosts its idle embedded stores. Report /tmp/wk-diff/bench-3.json.

| Endpoint | c | Play rps | Rust rps | Play p50/p99 ms | Rust p50/p99 ms | CPU ms/req Play / Rust |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| health (no db) | 1 | 3954.6 | 14954.2 | 0.25 / 0.39 | 0.06 / 0.11 | 0.279 / 0.04 |
| health (no db) | 32 | 24096.7 | 52792.6 | 1.14 / 4.4 | 0.58 / 1.2 | 0.377 / 0.117 |
| features (no db) | 1 | 2523.2 | 14345.8 | 0.39 / 0.61 | 0.07 / 0.12 | 0.301 / 0.043 |
| features (no db) | 32 | 17566.5 | 53425.5 | 1.88 / 4.57 | 0.57 / 1.2 | 0.477 / 0.122 |
| current user | 1 | 872.4 | 665.5 | 1.12 / 1.52 | 1.46 / 1.96 | 0.695 / 0.242 |
| current user | 32 | 4822.8 | 4425.9 | 6.25 / 17.37 | 5.26 / 36.88 | 0.903 / 0.241 |
| dataset read | 1 | 498.8 | 797.9 | 1.98 / 2.49 | 1.24 / 1.53 | 1.712 / 0.561 |
| dataset read | 32 | 2446.1 | 3917.8 | 11.61 / 47.01 | 7.92 / 11.92 | 2.017 / 0.73 |
| datasets compact, 2006 rows | 1 | 58.0 | 72.2 | 16.56 / 22.89 | 13.75 / 15.48 | 12.138 / 6.568 |
| datasets compact, 2006 rows | 32 | 397.3 | 426.5 | 77.63 / 160.69 | 75.14 / 142.24 | 15.664 / 7.912 |
| datasets search, limit 20 | 1 | 394.8 | 335.3 | 2.46 / 3.33 | 2.92 / 3.87 | 0.709 / 0.35 |
| datasets search, limit 20 | 32 | 2277.1 | 2129.9 | 9.52 / 93.43 | 9.48 / 63.66 | 0.613 / 0.349 |
| datasets full v12, limit 50 | 1 | 18.6 | 25.7 | 53.6 / 57.98 | 39.58 / 44.32 | 47.5 / 9.854 |
| datasets full v12, limit 50 | 32 | 93.6 | 209.8 | 345.82 / 426.62 | 147.63 / 250.45 | 60.265 / 11.002 |
| readable annotations page | 1 | 161.7 | 119.1 | 5.91 / 9.54 | 8.12 / 11.37 | 1.671 / 0.725 |
| readable annotations page | 32 | 1166.0 | 671.2 | 20.94 / 79.78 | 39.09 / 118.74 | 1.315 / 0.779 |
| users, 302 rows | 1 | 135.0 | 89.6 | 7.85 / 10.33 | 10.79 / 14.86 | 3.077 / 1.508 |
| users, 302 rows | 32 | 1410.0 | 431.1 | 15.59 / 141.01 | 70.87 / 140.33 | 4.012 / 1.659 |
| folder tree | 1 | 670.9 | 1446.9 | 1.39 / 2.51 | 0.67 / 0.93 | 0.475 / 0.209 |
| folder tree | 32 | 8482.0 | 8774.8 | 3.28 / 7.67 | 3.12 / 13.0 | 0.622 / 0.281 |
| projects with status | 1 | 731.3 | 1284.2 | 1.31 / 1.96 | 0.77 / 1.0 | 0.554 / 0.214 |
| projects with status | 32 | 7749.9 | 9629.0 | 3.31 / 19.42 | 2.91 / 9.71 | 0.798 / 0.276 |
| available tasks report | 1 | 24.0 | 48.2 | 41.72 / 44.19 | 20.66 / 23.9 | 46.44 / 11.688 |
| available tasks report | 32 | 84.0 | 168.2 | 388.18 / 516.94 | 186.97 / 347.94 | 54.234 / 18.135 |
| time overview | 1 | 389.9 | 1498.4 | 2.28 / 4.39 | 0.65 / 0.88 | 0.965 / 0.279 |
| time overview | 32 | 4653.5 | 9122.5 | 5.02 / 66.13 | 3.13 / 10.35 | 1.128 / 0.377 |

Process totals: {"play": {"cpu_seconds": 968.5, "rss_mib_start": 510, "rss_mib_peak": 1883}, "rust": {"cpu_seconds": 496.4, "rss_mib_start": 42, "rss_mib_peak": 597}}

## Round 2 (2026-10-17): list queries, jobs/AI models, uploads

Benchmark of the changed endpoints after the rewrite (same setup as above, Rust restarted with the new build, `bench.py --only …`):

| Endpoint | c | Play rps | Rust rps before | Rust rps now | Rust p50/p99 ms now |
| --- | ---: | ---: | ---: | ---: | ---: |
| users, 302 rows | 1 | 129.2 | 89.6 | 187.8 | 5.3 / 6.09 |
| users, 302 rows | 32 | 1199.2 | 431.1 | 997.5 | 26.9 / 76.91 |
| readable annotations page | 1 | 174.9 | 119.1 | 173.7 | 5.72 / 6.57 |
| readable annotations page | 32 | 1168.8 | 671.2 | 1006.4 | 25.83 / 93.06 |
| current user | 1 | 851.3 | 665.5 | 1903.6 | 0.5 / 0.78 |
| current user | 32 | 3875.0 | 4425.9 | 6779.1 | 4.06 / 11.83 |

(/tmp/wk-diff/bench-3.json was overwritten by a full rerun whose second half overlapped a cargo build; the "Final benchmark" table above is from the earlier run, the rows here from the targeted rerun.)

- Users list (`users.rs`): `USER_LIST` aggregates teams/requester-managed/experiences/paying identity once per organization (CTEs, hash joins); `USER_DOCUMENT` keeps per-row laterals for single users. Shared JSON select via `user_json!()`/`concat!`. psql: 14.3 ms (generic) / ~25 ms (custom + planning) → 4.2 ms; the cached statement switches to its generic plan after 5 executions (`pg_prepared_statements`: 7 generic, 5 custom of 12).
- Annotation lists (`annotation/lists.rs`): optional filters spelled into the statement text per combination (`optional_filters`, `state_filter`); generic plan 46.8 → 3.4 ms. In auto mode PostgreSQL chose custom plans 12/12 times (custom cost estimate 44k < generic 111k) and paid ~7 ms planning per request, so `compact_response` runs page + count in `BEGIN READ ONLY; SET LOCAL plan_cache_mode = force_generic_plan`.
- New corpora: `jobs_ai.json` (90 steps: worker protocol with Play's dev worker `secretWorkerKey`, job submissions incl. export/animation/align, status/cancel/retry/voxelytics attach, AI model upload-to-path, update, trainings, inferences with pretrained models, deletes) and `uploads.json` (29 steps: datastore reserve/chunk/finish/cancel with `test/dataset/test-dataset.zip`, unfinished uploads, upload-to-paths, delete). Stack: `features.jobsEnabled/voxelyticsEnabled = true`, dev worker row inserted on reset, separate Redis (:19594) for the Rust side's stores, `WK_UPLOAD_TO_PATHS_PREFIXES`. Harness: `service: datastore` steps, multipart bodies (`content_path`), `run_last` corpora (auth.json changes sample2's password; the 6-character seed password cannot be restored through the API's 8-character minimum), row-level `db_divergences`, ids embedded in DB strings mapped, chain messages compared when Rust sends them, `[*]` in ignore paths.
- Rust bugs found and fixed: `getUnfinishedDatasetUploadsForUser` read `organizationId` but the route/datastore send `organizationName` (every resumable upload's unfinished-uploads check failed with 400; scan of all Play routes found no other query-name/argument-name mismatch); TIFF/animation export file names used UTC instead of the JVM default zone (`chrono::Local` now); float job args (`instance_diameter_nm`, inference eval/seed thresholds) serialized as `800.0` where play-json writes `800` (`util::java_format::play_json_double`); `/datasets/disambiguate/{name}/toNew` not-found text.
- Declared: JSON validation bodies (worker status, animation, AI model reserve), failed store RPC text (Play embeds RPC URL + store body; Rust generic by design), Play's orphan pending dataset when an upload reservation has an unknown team, Scala `Set` order of `jobsSupportedByAvailableWorkers`/`supportedJobCommands`, unordered `/api/folders/tree`.
- Observation (parity): any member of the owning organization may rename/update an AI model (`AiModelDAO.updateAccessQ`), not only admins.
- Result on fresh clones: **424 steps, 415 match, 7 declared, 2 open (bad-token policy, same item twice); DB: 1 declared table** (/tmp/wk-diff/all-report-7.json). Per corpus: admin_crud 78/79, annotations_tasks 63/64, jobs_ai 90/90, read 120/123, uploads 29/29, auth 35/39 (non-matching ones are the declared/open items). Tests 608 passed, clippy/fmt clean.

### OIDC and WebAuthn (same day)

- `oidc_mock.py` (stdlib RSA/RS256, signatures checked against `cryptography`): discovery, JWKS, token endpoint validating client basic auth, grant type and redirect URI; the authorization `code` selects existing user, new user, access-token-only claims, foreign signing key, expired, missing email, non-JWT, provider error. Both backends configured with the same client (`features.openIdConnectEnabled`, `singleSignOn.openIdConnect.*` / `WK_OIDC_*`). `oidc.json`: 22 steps, 21 match, 1 declared (wrong HTTP method: Play 404 HTML, Rust 405 JSON).
- `webauthn_client.py` (stdlib P-256 ECDSA checked against `cryptography`, CBOR, "none" attestation, deterministic keys per name so both DBs store identical credentials); `replay.py` `"hook"` steps build request bodies from each side's own captured challenge. `webauthn.json`: 37 steps, 36 match, 1 declared, DB clean apart from the declared harness row. Needs `WK_DIFF_PUBLIC_URI=https://localhost:19590` (Play and Rust refuse passkeys on http); opt-in because Play's embedded datastore then reports `http.uri` as its URL and Play's datastore calls fail for the other corpora; `replay.py` skips corpora whose `requires_public_uri` does not match `/tmp/wk-diff/public_uri`.
- **Play bug found:** passkey login with an incrementing signature counter always fails (401) after storing the new counter: `oldSignCount` is read after webauthn4j's `verify` has updated the credential record (verified: sign count 0 logs in on both; 1/3/5 fail on Play, succeed on Rust; both store the same counter). Hardware security keys are affected, synced passkeys (always 0) are not. Declared; Rust keeps the correct behavior.
- Declared: Play's wrong-challenge error echoes the expected challenge (webauthn4j text). Parity: a multi-user without `_lastLoggedInIdentity` (only ever used tokens) gets 404 after a valid passkey on both.
- Coexistence: WebAuthn challenges are process-local in both (CUTOVER.md §2).
- Final results 2026-10-17 on fresh clones: **default pass 446 steps, 436 match, 8 declared, 2 open (bad-token policy); DB 1 declared table** (/tmp/wk-diff/all-report-8.json); **https pass webauthn.json 37 steps, 36 match, 1 declared** (/tmp/wk-diff/webauthn-report-6.json). All stack processes stopped.

## Round 3 (2026-10-25): fresh baseline, coverage 191 → 287 routes

Setup: worktree `diff-coverage` from `rust` 2fad899ff2 (rebased onto 85619f7e67 and re-run with identical results: /tmp/wk-diff/final-5.json, /tmp/wk-diff/webauthn-final-2.json), Play staged from it, `stack.py seed` (now with fixtures), every run on fresh clones (`reset`).

- **Coverage tool** `tools/app_differential/coverage.py` (stdlib): maps app steps to `conf/webknossos.latest.routes` (first match in file order, legacy versioned routes reported separately, store steps skipped); `--min N` for CI. Before: 191/287 (465 app steps). After: **287/287** (1068 app steps). Per controller before → after: WKRemoteDataStoreController 0 → 18/18, WKRemoteTracingStoreController 0 → 8/8, VoxelyticsController 1 → 9/9, AnnotationController 20 → 25/25, AnnotationIOController 2 → 3/3, AnnotationPrivateLinkController 5 → 7/7, TaskController 10 → 11/11, ProjectController 13 → 14/14, AuthenticationController 20 → 26/26, OrganizationController 10 → 17/17, DatasetController 17 → 37/37, PathDeletionController 0 → 2/2, CreditTransactionController 1 → 4/4, AnalyticsController 0 → 2/2, EmailVerificationController 0 → 2/2, UserTokenController 1 → 3/3, DataStoreController 1 → 3/3, TracingStoreController 1 → 2/2, MaintenanceController 6 → 7/7, Application 4 → 5/5, InitialDataController 0 → 1/1, JobController 13 → 15/15. Covered only by negative/no-op steps: `/auth/sso` (not configured), `/analytics/ingest` (disabled), `/triggers/initialData` (no-op), `segmentAnythingMask` (checks before the SAM call; no SAM server).
- **Baseline (stale since 2026-10-17):** 446 steps, 392 match, 47 mismatches. Causes: (1) harness: Play's initial data generates team/folder/user/project ids, so every reseed broke the hardcoded ids → `{seed…}` variables resolved from `wk_diff_seed`; Rust got the worktree HEAD as build commit (NML `writerGitCommit`) → Play's `/api/buildinfo`; monthly credit grant raced the first organization reads → `start` waits for both grants. (2) Rust bugs, fixed below. (3) declared: plain-member invites (403), Job token reuse.
- **Harness made strict:** a declaration no longer hides differing statuses/headers (`status_differs`, `headers`) or diffs outside its paths; declared steps are counted as declared (previously as matches when fully masked); declarations with nothing left to declare (step, table, row) are reported STALE. This surfaced the stale repeated-finish declaration (Play fixed `allowFinishSoft` in #10161), the content-type of Play's HTML/text error pages and the passkey counter declaration's status. Further harness features: seed fixtures (test/db voxelytics rows, credential, invite, email verification key), `side_variables`, `raw_b64`/`proto` bodies, `run_order`, SQL-valued row filters, `db_ignored_columns`, capture filters `[?k=v]`, masking of random upload-to-path suffixes, float rounding (1e-12), content-based ordering of fresh-id lists.
- **New corpora:** `stores.json` (168 steps), `voxelytics.json` (68), `annotation_flows.json` (86), `tasks_projects.json` (39), `onboarding.json` (96, `run_order` 50), `datasets_virtual.json` (85), `misc.json` (59).
- **Rust bugs fixed** (commits on `diff-coverage`): attachment order per layer (a83bfb5317); user list/experience texts (b66661eee6); store callbacks, user access and tracingstore update statuses/texts (2b0c85f49d); Scala version in `/buildinfo` + sync test (fe1f1fc1d8); voxelytics statistics doubles (20c480036a); annotation source / private link errors (d0f7864fcc); onboarding empty-Fox 404s (2650c09fe7); unique/FK violations 400 instead of 409 (fc6e35eff0); "Dataset with name" texts (2b7f3ae250); explored data source normalization (246361e216); maintenance not-allowed text (ce743fd736).
- **New declared divergences:** plain-member `sendInvites` 403; Job token reuse (DB rows); Play's raw SQL failure texts (constraint violations, layer name check); Play bug: upload without `createGroupForEachFile` → 500; NML XML parser messages; Play bug: unknown voxelytics event type → 500; Play bug: `POST /organizations` with an owner outside the super user's organization → 404 and an ownerless organization; Play's user cache keeps a deleted user's session authenticated; Play bug: empty 403 text in `addVirtualDataset`; `datasets.inboxSourceHash` (column ignored, documented deviation). Harness-only ignores: voxelytics task/run order (Scala `groupBy`, ties), explore report order (concurrent explorers in the Scala datastore), thumbnail JPEG bytes.
- **Play bug documented without a corpus step:** `storeWorkflowEvents` processes event groups in `groupBy(_.getClass)` hash order (varies per JVM), so a checksum for an artifact created by a `TASK_STATE_CHANGE` in the same request can be dropped; Rust processes in dependency order. The corpus sends such events in separate requests.
- **Results 2026-10-25 on fresh clones:** default pass **1049 steps, 989 match, 58 declared, 2 open (bad-token policy); DB 0 differing tables** (/tmp/wk-diff/final-4.json); https pass `webauthn.json` **37 steps, 35 match, 2 declared; DB 1 declared harness table** (/tmp/wk-diff/webauthn-final.json). Per corpus: admin_crud 77+2, annotation_flows 80+6, annotations_tasks 64, datasets_virtual 79+6, jobs_ai 84+6, misc 55+4, oidc 21+1, read 119+3+1 open, stores 157+11, tasks_projects 37+2, uploads 29, voxelytics 65+3, onboarding 88+8, auth 34+6+1 open (match + declared). Rust: `make check`, `make test`, `make test-db` green (1462 tests). Stack stopped.

## Findings / divergences

- Declared (corpus): Cache-Control `no-store` vs `no-cache`; Play's HTML pages for router-level errors (unknown route, unparsable path id) vs Rust JSON; Play's extra `{"chain": …}` debug message; buildinfo local store flags (deployment-specific); order of lists Play leaves unordered (no ORDER BY); sharing token randomness; Play's cached `lastActivity` in GET /api/user.
- **OPEN policy decision:** invalid/expired token on user-aware routes (e.g. GET /api/datasets): Play ignores it and answers anonymously (200); Rust fails closed (401). Risk: public dataset links opened with a stale token/cookie break under Rust. To decide with the user.
- ~~Declared Play bug: repeated finish~~ — fixed in Play by #10161 (both 200 since); declaration removed 2026-10-25.
- Declared: JSON validation failure body (Play JsError structure vs Rust messages), Play bug `incrementEachTasksInstances` → 404 for projects without tasks (Rust returns the project).
- Declared: Play's form errors are the Form object's toString (text/plain) and echo submitted values incl. the clear-text password; Rust returns JSON naming the failing fields. (Play-side issue worth fixing.)
- Security observation (parity, not a migration blocker): after `/auth/logout` and after a password change, the old session cookie keeps authenticating on BOTH Play and Rust; only `logoutEverywhere` invalidates it.
- Default-config differences Rust vs Play dev conf (relevant to deployment docs): `WK_EMAIL_VERIFICATION_ENABLED` default true (Play activated=false), sample organization off by default (deliberate).
- Unknown non-API route: Play also serves the SPA/assets (RequestHandler); C4 proxy must keep non-/api paths on Play or a static server.
- Remaining wording parity: most error texts outside the read corpus are still Rust wording; `msg.rs` is the place to converge. The mutation corpus will surface them.

## Next

1. User decision: invalid/expired credentials on user-aware routes (fail closed vs Play's anonymous fallback).
2. User decision: Play change to make the store RPC token configurable (blocker for stage 3+).
3. ~~Voxelytics workflows/logs corpus; datastore/tracingstore callback routes~~ (Round 3). Open: tie order of never-started voxelytics task runs (Play decides by physical row order) and the event-group order bug, see Round 3.
4. Check the compact dataset list's cached plan choice (planning ~14 ms) like the annotation lists.
5. Rust CI job exists (`.github/workflows/rust.yml`); it now also runs `coverage.py --min 287`. A Postgres service for the DB tests is still missing.
6. Run the read corpus against an anonymized production snapshot; benchmark on Linux.

## Evidence

- Listeners 2026-10-16: user's Postgres 5432 (dev DB `webknossos`, schema 185, untouched), Redis 6379 (untouched), FossilDB java 7155 (untouched). No Play running. `/tmp/webknossos-rust-postgres` cluster (55439) is not running.
