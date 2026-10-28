# Cutover from the Play application to the Rust backend

How to move WEBKNOSSOS application traffic (`/api/*`) from Play to `backend-rust` safely: what has been verified, who owns the database schema, what runs where during coexistence, and the stages with their entry criteria and rollback. The datastore (`backend-rust/datastore`) has its own differential, load phase, shared-state ownership and stages in datastore/DEPLOYMENT.md (status: checkpoints/datastore-cutover.md); the two cutovers are independent because the datastore keeps its registered URL and talks to whichever application answers `/api/datastores/*`. The tracingstore stays Scala.

Evidence and the running log of findings: [checkpoints/cutover.md](checkpoints/cutover.md). Differential/benchmark tooling: [tools/app_differential/README.md](tools/app_differential/README.md).

## 1. Verification status

**Differential tests against Play.** Fifteen corpora (read, admin CRUD, annotation/task lifecycle and annotation flows through real tracingstores, store callbacks, voxelytics, tasks from files, onboarding/organizations, virtual/composed datasets, uploads through real datastores, credits/analytics/emails/maintenance, authentication/sessions, jobs with the worker protocol and AI models, OIDC single sign-on against a mock provider, passkeys with a virtual authenticator) are replayed against Play and Rust on identical database clones; responses and the full resulting database state are compared. All mismatches found were either fixed in Rust or declared with a reason in the corpus. Current result: see the checkpoint (all steps match except declared divergences and one open policy decision, below). **Route coverage: 287 of 287 routes** (`tools/app_differential/coverage.py`, enforced in CI with `--min 287`); four of them only through negative or no-op steps (SSO not configured, analytics ingestion disabled, the initial-data trigger, segment-anything checks before the SAM server call).

**Declared divergences** (behavior intentionally not copied from Play):

| Area | Play | Rust | Why |
| --- | --- | --- | --- |
| `Cache-Control` | `no-cache` (none on 401) | `no-store` | API responses must not be stored; no validators exist either way |
| Router-level errors (unknown route, unparsable path id or query parameter, missing query parameter, wrong method) | HTML error page; 404 also for a wrong method | JSON `{"messages":[…]}`; 405 for a wrong method | API clients only; same status otherwise |
| Invalid JSON/form body | `JsError` structure / `Form.toString` (echoes submitted values incl. passwords) | JSON message naming fields | same status; Play leaks input back |
| `{"chain": …}` debug message | appended on failed Fox chains | omitted | debug-only |
| `incrementEachTasksInstances` on a project without tasks | 404 (bug: empty aggregate) | 200 with the project | bug fix |
| Order of lists Play leaves unordered (no `ORDER BY`) or builds from Scala `Set`s | physical row / hash order | Rust's order | not a contract |
| Failed store RPC (e.g. AI model voxel size) | message embeds the internal RPC URL, a per-process counter and the store's response body | generic "Service returned an unsuccessful status." with the store's status | Rust never forwards upstream bytes or URLs; the user loses the store's reason (e.g. "Could not read model statistics.json"), a candidate for forwarding only the store's `messages[].error` texts |
| Passkey login with an authenticator that increments its signature counter (e.g. hardware security keys) | 401 after storing the new counter (bug: `oldSignCount` is read after webauthn4j's `verify` updated the record, so `old < new` never holds) | logs in | bug fix; authenticators reporting 0 (synced passkeys) behave the same on both |
| Passkey registration with a wrong challenge | 400 with webauthn4j's text, which includes the expected challenge | 400, generic message | no internals in responses |
| Passkey login with an assertion whose user-presence (UP) flag is unset | logs in (webauthn4j runs with `up=false`) | 401 | `webauthn-rs-core` always requires UP; browsers always set it |
| Passkey registration with a key `webauthn-rs-core` rejects (EC point not on the curve, RSA exponent other than 3 bytes) or an ED flag without extension bytes | stored (such keys can never authenticate) / accepted | 400 | vetted key validation; real authenticators use e = 65537 and send extensions only with ED |
| Upload reservation with an unknown initial team | 400, but the pending dataset row stays (created before the team check, no transaction) | 400, nothing created | bug fix |
| Constraint violations (duplicate mag/attachment, unknown layer, layer name check, user already in organization) | 400 with the raw `SQL Failure: … Detail: Key (…)=(…)` text | 400 with a generic text | no database internals in responses |
| `sendInvites` by a plain member | 400 with team roles; without team roles the invite is stored and mailed (200) | 403 | only admins and team managers invite (hardening 46552fe734) |
| Worker Job tokens | a new token per handed-out job | a token from the last hour is reused | workers poll every few seconds |
| `POST /organizations` (super user) with an owner from another organization | 404 after the organization was inserted (owner lookup uses the super user's access context); organization stays without users | 200, owner added, monthly credits granted | bug fix |
| Session of a user deleted with their organization | stays authenticated until Play's user cache expires (GET /api/user then 404) | 401 | no user cache |
| `POST /annotations/upload` without the `createGroupForEachFile` field | 500 (`Map.apply` throws) | treated as false | bug fix; the frontend always sends it |
| Voxelytics events with an unknown `type` | 500 (reads throw) | 400 JSON validation error | bug fix |
| Voxelytics events of several types in one request | processed in `groupBy(_.getClass)` hash order (per JVM); checksums/profiling for artifacts/chunks created in the same request may be dropped | processed in dependency order | bug fix (not in a corpus: Play's outcome varies per JVM) |
| NML syntax errors | Xerces' message and position | the Rust XML reader's message | same prefix and status |
| `addVirtualDataset` by a member without rights | 403 with an empty error text | 403 with the generic not-allowed text | bug fix |
| `datasets.inboxSourceHash` | Scala case-class `hashCode` | canonical-JSON hash or NULL | not reproducible; one rewrite per dataset on the next datastore report |

**Open policy decision.** An invalid, expired or revoked credential on a *user-aware* route (public dataset/annotation reads, publications, …): Play ignores it and answers as anonymous (200); Rust rejects the request (401). Under Rust, a stale token in `?token=` links or API clients breaks public reads. Decide before stage 2: keep fail-closed (document for API users) or adopt Play's semantics for user-aware routes only.

**Security observation (both, unchanged by the migration):** after `/auth/logout` or a password change the previous session cookie keeps authenticating; only `logoutEverywhere` revokes it.

## 2. Coexistence: Play and Rust on one database

During stages 1–4 both applications run against the **same** production database. Verified/required:

- **Same database session time zone.** The shared schema depends on it (`hand_out_monthly_free_credits` month boundaries; the zone-less `annotation_mutexes.expiry`). Play's JDBC sessions use the JVM zone, Rust resolves its zone the same way (`TZ`, `/etc/localtime`, override `WK_DB_TIME_ZONE`). Run both with the same zone, preferably UTC. (A mismatch made Rust re-grant monthly credits in the differential test.)
- **Same cookie signer secret** (`WK_COOKIE_SIGNER_SECRET` = Play's `silhouette.cookieAuthenticator.signerSecret`) so sessions work on both. Verified: cookies and API tokens issued by either backend authenticate on the other (`tools/app_differential/coexist.py`).
- **BLOCKER: shared store RPC token.** The datastore/tracingstore validate the token of an application-issued store call by calling back `validateUserAccess` on the application at their configured URI. Play's token (`RpcTokenHolder.webknossosToken`) is random per process and not configurable, Rust's is `WK_RPC_TOKEN` (random if unset). Whenever the backend that answers the callback is not the one that issued the call, the store answers 403 (reproduced: annotation creation through Rust while the tracingstore calls back Play). Required before stage 3: a small Play change reading the token from configuration (fallback random), and the same value in Play and `WK_RPC_TOKEN`.
- **Time tracking is process-local state** in both implementations (the user's current span is cached in memory). All time-tracking routes for one user must reach one process: `GET /api/annotations/*/info?timestamp=…`, `PATCH /api/annotations/:typ/:id/finish`, `PATCH /api/annotations/:typ/finish` (finish all), and the tracingstore's `POST /api/tracingstores/*/handleTracingUpdateReport`. Move these together and run one Rust instance (or user-sticky routing) until this state is moved to the database.
- **WebAuthn ceremonies are process-local state** in both implementations (the challenge between `…/start` and `…/finalize` is kept in memory, keyed by the `webauthn-registration`/`webauthn-session` cookie). Route all `/api/auth/webauthn/*` requests to one backend (and with several Rust instances, make them sticky by that cookie), or a finalize reaching the other process fails with "Timeout during … Please try again." (401).
- **Background jobs run in exactly one application.** Play runs its jobs unconditionally while it is up; start Rust with `WK_HOUSEKEEPING_ENABLED=false WK_CREDIT_TICKER_ENABLED=false WK_USED_STORAGE_ENABLED=false WK_WORKER_LIVENESS_ENABLED=false` until Play's API is switched off (stage 5). Rust's jobs take advisory locks, Play's do not.
- **Caches.** Play caches users for 3 minutes; role/team changes made through Rust can take up to 3 minutes to reach Play-served requests (already true between Play restarts). Compound annotation caches are per process and only recompute on miss.
- **Stores.** The datastore and tracingstore call back the application at their configured `webKnossos.uri`. Point it at the proxy, not at Play directly, so callbacks follow the routing stage.
- **Upload-to-paths prefix.** With `webKnossos.datasets.uploadToPaths.prefixes` empty, Play falls back to its co-located datastore's first local, organization-agnostic upload base directory (`datastore.baseDirectories`). Rust has no datastore configuration and falls back to `./binaryData`; set `WK_UPLOAD_TO_PATHS_PREFIXES` to the same directory, or AI model and dataset upload-to-paths reservations hand out different paths than Play.
- **Features Rust does not have yet** stay on Play until implemented: Mailchimp (G9), pricing-plan expiry reminders (G8), hourly virtual-dataset real-path scan (G10), initial data on startup (G11). See checkpoints/coordinator.md "Open work items". Play serves the frontend (SPA, `/assets`, `/images`, `/wasm`, sitemap) until a static server takes over.

## 3. Schema migration ownership

- **The Scala evolutions stay authoritative** (`schema/evolutions/NNN-*.sql`, `schema/schema.sql`, `tools/postgres/dbtool.js`). Rust never creates or alters tables; it refuses to start unless `releaseInformation.schemaVersion == db::SCHEMA_VERSION` (Play only warns).
- **Guard:** `tests/schema_version.rs` fails when `schema.sql` or the newest evolution moves past `SCHEMA_VERSION`. Whoever adds an evolution must review the Rust queries that touch the changed tables, run the Rust DB tests (they bootstrap the new `schema.sql`), bump `SCHEMA_VERSION`, and re-run the differential corpora for affected routes. Rust is not in CI yet; add a job running `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, and `cargo test -- --include-ignored` against a Postgres service (`WK_RUST_TEST_DATABASE_URL`) so this guard is enforced on every PR.
- **Deploying an evolution during coexistence:** the exact version check makes Rust stop accepting the database until a Rust build with the new version is deployed. Ship evolutions only together with a Rust release (apply evolution → deploy Play and Rust builds that both expect it), or keep the evolution backward compatible and deploy Rust first only if `SCHEMA_VERSION` handling is extended to a verified range. Never run Rust against a newer schema it was not tested with.
- **After the cutover** (Play API retired), ownership moves with the code: `schema/` and `dbtool.js` remain the tooling, the Rust backend becomes the only consumer and the evolution checklist above becomes the standard PR checklist.

## 4. Observability for the canary

- **Access log:** one INFO line per response (`tower_http=info`, default) with method, matched route template, `request_id` (also returned as `x-request-id`), status and latency in ms; 5xx also at ERROR. Raw URIs and query strings are never logged (legacy `?token=`). JSON by default (`LOG_FORMAT=pretty` for local use).
- **Metrics:** set `WK_METRICS_BIND` (e.g. `127.0.0.1:9101`, private network only) to serve Prometheus text at `/metrics`: `wk_http_requests_total` and `wk_http_request_duration_seconds` by method/route/status, `wk_db_pool_connections{state}`, `wk_db_pool_connections_max`, `wk_process_start_time_seconds`, `wk_build_info`. Play has no equivalent; compare Rust against Play using the proxy's access logs (status/latency per route).
- **Health:** `/health/live` (process), `/health/ready` (database reachable and schema version correct) for the load balancer; `/api/health` mirrors Play.

## 5. Performance

`tools/app_differential/bench.py` on identical data (`stack.py reset --volume`: 2,006 datasets, 302 users, 5,000 annotations), Apple M2 Pro, local PostgreSQL 15, 20 DB connections each, 8 s per level after warmup. Tables in checkpoints/cutover.md ("Final benchmark", "Round 2"). Summary: Rust matches or beats Play on throughput and latency for the measured routes at a fraction of the CPU per request. Closest to Play: the users list at 32 connections (998 vs 1,199 rps; 188 vs 129 rps at 1) and the readable-annotations page (1,006 vs 1,169 rps; equal at 1), both bound by PostgreSQL CPU. Not yet measured: Linux, memory behavior of the Linux allocator, throughput on production-size data.

**Production data, single requests** (2026-10-27). Setup: the production dump (schema 188, store URLs neutralized) and the GET routes of 5 representative users (super user, two admins, team manager, member). There were 348 requests, sequential on fresh connections, Play and Rust alternating, and each latency is the median of 5 runs after a warmup. Rust's median time is 0.73× Play's, and the totals are 6.2 s for Rust vs 8.7 s for Play. Rust is faster on 204 requests, within ±20 % on 111, and slower on 33. The slower ones are listed below; most of them differ by only 1–3 ms.

| Route | Play | Rust | Cause / status |
| --- | ---: | ---: | --- |
| `GET /api/folders/tree` | 9–23 ms | 49–52 ms | `tree()` (`src/folders/routes.rs`) runs three queries per folder (`has_access`, `find_parent`, `has_access`); Play runs one. Open: replace with one set-based query. |
| `GET /api/annotations/readable?isFinished=true&…&includeTotalCount=true` (admins) | 22–31 ms | 32–38 ms | Open, not analyzed. |
| `GET /api/user/annotations` (all, and `isFinished=true&…&includeTotalCount=true`) | 4.5–11 ms | 7–14 ms | Open, not analyzed. |
| `GET /api/users/:id/annotations`, `GET /api/users/:id/tasks` | 1.8–3.1 ms | 2.4–4.0 ms | Open, not analyzed. |
| `GET /api/annotations/:id/info?timestamp=0` | 5.5–5.9 ms | 7.5–10.6 ms | Open, not analyzed. |
| `GET /api/projects/:id/tasks` (with and without paging) | 4.3–4.9 ms | 7.1–8.4 ms | Open, not analyzed. |
| `GET /api/datasets/:id/usedStorageDetails` | 1.7–2.0 ms | 2.9–4.8 ms | Open, not analyzed. |
| `GET /api/datasets/:id/sharingToken` | 1.6–2.6 ms | 2.4–4.4 ms | Open, not analyzed (creates a token on first call). |
| `GET /api/jobs/:id`, `GET /api/tasks/:id`, `GET /api/datasetConfigurations/default/:id`, `GET /api/projects/:id/usersWithActiveTasks`, `GET /api/annotations/:typ/:id/sharedTeams`, `GET /api/projects` (member) | 1.5–2.6 ms | 1.9–3.9 ms | Under 1.5 ms each. |

Two fixes came out of this run:
- **Per-connection router conversion.** Axum serves a `Router` by deep-cloning it and converting every handler again for each new connection. The API is nested once per version (`/api`, `/api/v10`–`/api/v16`, about 2,300 endpoints), so each new connection paid about 9 ms before its first byte. The router is now converted once in `main.rs` (`into_make_service`). Time to first byte on a fresh connection dropped from 9.5 ms to 0.23 ms.
- **`/api/time/overview` took 400–750 ms (Play: 35–70 ms).** The span filter compared `a.typ::text = ANY(…)`. That cast hides the column statistics, so the planner estimated 4 rows instead of 34k and chose a nested loop. The filter now compares the enum columns directly: 1.2 s → 63 ms for the full query on the dump.

Fixed on the way (all verified by the differential corpora afterwards):
- Compact dataset list was 2-4x slower than Play: correlated per-row permission subplans, per-row layer/storage subqueries and `jsonb_build_object`. Now uncorrelated permission sets, set-based joins (lateral for small limits), JSON built in Rust.
- `EnvFilter` lock contention: every poll of a request entered/exited the request span under `EnvFilter`'s span lock; plain `RUST_LOG` directives now use the lock-free `Targets` filter (time overview: 1.6k → 6.2k rps at 32 connections).
- Token touch `UPDATE` on every authenticated request (row lock per token) → only for tokens with an idle timeout, like Silhouette.
- Users list: four lateral aggregates per user → computed once per organization and hash joined (query 14.3 → 4.2 ms on 302 users); single-user lookups (`GET /api/user`, 666 → 1,904 rps) use their own per-row statement without the list filters.
- Annotation lists: the catch-all `($n IS NULL OR …)` filters made the generic plan estimate ~6 instead of 5,000 rows (47 ms nested-loop plan); filters are now spelled out per combination (3.4 ms). PostgreSQL still re-planned every execution (7 ms planning) because the custom plans' estimated cost was below the generic plan's, so the list statements run in a read-only transaction with `SET LOCAL plan_cache_mode = force_generic_plan` (one extra round trip).
- Statement caching rule: keep statements cached (`persistent`), avoid optional-filter predicates in their text, and check `pg_prepared_statements.generic_plans/custom_plans` for statements with expensive planning; the compact dataset list (planning ~14 ms) has not been checked for this yet.

## 6. Stages

Routing is done by the reverse proxy in front of both applications (nginx, Caddy, Traefik): an explicit allowlist of `(method, path pattern)` → Rust, everything else → Play. Every stage is reverted by removing its allowlist entries; for the flows covered by the corpora, Rust writes the same rows Play writes (verified by the database diff), so no data migration is needed to roll back; extend the corpora before moving an uncovered write route.

| Stage | Traffic to Rust | Entry criteria | Exit criteria / watch |
| --- | --- | --- | --- |
| 0 Differential | none (harness) | corpora green on a snapshot of production data (anonymized copy) | no undeclared mismatches; policy decision taken |
| 1 Shadow | mirrored copies of side-effect-free GETs (responses discarded) | Rust deployed with background jobs off, same TZ/secret, metrics scraped | 5xx rate and p95 latency per route ≤ Play's over a week; no panics |
| 2 Canary reads | GET allowlist (datasets, folders, users, teams, projects, task types, organizations, publications, time reports, jobs/AI model lists) for internal users/organizations first, then everyone | stage 1 clean | error rate ≤ Play; user reports |
| 3 Low-risk writes | user/dataset configuration, folders, teams, scripts, task types, projects, maintenances, short links, dataset settings | stage 2 clean for ≥ 1 week | DB-level checks (row counts, audit) |
| 4 Core flows | annotations and tasks (all time-tracking routes together), auth/sessions (login, tokens, registration, invites, OIDC, WebAuthn), jobs/AI submissions, store callbacks (`/api/datastores/*`, `/api/tracingstores/*`) | stage 3 clean; single Rust instance or user-sticky routing | time tracking totals, task counts, credit balances unchanged in reconciliation |
| 5 Play API off | all `/api/*` | stage 4 clean for ≥ 2 weeks; missing background features (G8–G11) implemented | then enable Rust background jobs and stop Play's API (frontend served statically) |

**Not mirrorable in stage 1** (GETs with side effects): `GET /api/auth/token` (creates a token), `GET /api/datasets/:id/sharingToken` (creates one), `GET /api/annotations/*/info?timestamp=…` (time tracking), `GET /api/jobs/request` (reserves jobs for a worker), `GET /api/auth/oidc/*` (login flow). Most other GETs only touch `lastActivity`/`lastUsedTime`, which is harmless to duplicate.

**Rollback** at any stage: revert the proxy allowlist (seconds). Rust holds no state that Play needs, except process-local time-tracking spans, which only fragment a user's current span.
