# WEBKNOSSOS application backend in Rust

An incremental port of the Play application backend, built in its own directory. It uses Axum/Tokio for HTTP and SQLx for PostgreSQL. The existing Scala service remains necessary for routes listed as pending in [MIGRATION_STATUS.md](MIGRATION_STATUS.md). This is **not yet a replacement for the complete WEBKNOSSOS backend or frontend session server**.

## Run

Install Rust 1.88 or newer and use a database initialized and maintained by the existing WEBKNOSSOS tooling at schema version **185**. Prefer a development database or a copy while evaluating the migration.

From this directory:

```sh
export DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/webknossos'
export WK_PUBLIC_URL='http://localhost:9000'
cargo run --locked
```

The service binds to `127.0.0.1:9001`. Set `WK_BIND=0.0.0.0:9001` when running behind a proxy/container. Configuration comes from environment variables; [`.env.example`](.env.example) lists all settings. No `.env` is loaded automatically. Startup validates configuration, opens a bounded pool, and verifies the schema version. It never creates tables or runs migrations. **Do not apply `../schema/schema.sql` to an existing database: it drops the schema.**

```sh
curl http://localhost:9001/health/live
curl http://localhost:9001/health/ready
curl -H "X-Auth-Token: $WK_TOKEN" http://localhost:9001/api/v16/teams
```

## Running the full local stack

The Rust application backend and datastore run as separate processes next to the Scala tracingstore, FossilDB and Redis. PostgreSQL and Redis must be running (see `../DEV_INSTALL.md`). Adjust the example credentials and secrets to your setup. Use one terminal per component:

1. **Application backend** (from `backend-rust/`, serves on `127.0.0.1:9001`):
   ```sh
   DATABASE_URL='postgres://postgres:postgresD@localhost:5432/webknossos' \
   WK_JOBS_ENABLED=true \
   WK_COOKIE_SIGNER_SECRET=something-secure \
   LOG_FORMAT=pretty \
   cargo run --locked
   ```
2. **Standalone datastore** (port 9090). `WK_DS_KEY` must match the key registered in the DB below:
   ```sh
   WK_DS_KEY="something-secur3" cargo run --manifest-path=datastore/Cargo.toml --locked
   ```
3. **Scala tracingstore** (from the repo root, port 9050):
   ```sh
   sbt -J-Xmx8G "project webknossosTracingstore" "run 9050 -Dconfig.resource=standalone-tracingstore.conf"
   ```
4. **FossilDB** (from the repo root; also make sure Redis is running, e.g. `brew services start redis`):
   ```sh
   yarn start-fossildb
   ```

### Point the database at the standalone stores

Register the standalone datastore and tracingstore (names and keys must match the respective configs) and move existing datasets to the new datastore, e.g. via `psql`:

```sql
-- 1. Datastore
INSERT INTO webknossos.dataStores (name, url, publicUrl, key, allowsUpload, allowsUploadToPaths, isScratch, reportUsedStorageEnabled)
VALUES ('standalone-9090', 'http://localhost:9090', 'http://localhost:9090', 'something-secur3', true, true, false, false)
ON CONFLICT (name) DO UPDATE SET
  url = 'http://localhost:9090',
  publicUrl = 'http://localhost:9090',
  key = 'something-secur3';

-- 2. Move existing datasets to the new datastore (adjust the WHERE clause)
UPDATE webknossos.datasets
SET _dataStore = 'standalone-9090'
WHERE _dataStore = 'localhost';

-- 3. Tracingstore
INSERT INTO webknossos.tracingStores (name, url, publicUrl, key)
VALUES ('standalone-9050', 'http://localhost:9050', 'http://localhost:9050', 'something-secur3')
ON CONFLICT (name) DO UPDATE SET
  url = 'http://localhost:9050',
  publicUrl = 'http://localhost:9050',
  key = 'something-secur3';
```

Use an existing WEBKNOSSOS authentication/API token from the target database. `Authorization: Bearer …`, `X-Auth-Token`, and the legacy `?token=…` transport are supported. Invalid, expired, idle-expired, revoked, or conflicting credentials fail closed; inactive/deleted identities and organizations are denied. Authenticated clients can fetch/create/revoke an API token, generate datastore tokens, log out, and revoke all account identities. Password login (`POST /auth/login`) issues Play/Silhouette-compatible signed cookies when `WK_COOKIE_SIGNER_SECRET` is set (use Play's signer secret to share sessions); a valid cookie takes priority over a bearer token. Registration, organization onboarding, invites, password reset/change, organization switching and email verification are available. Mail is written to the log only (`LogMailer`), not delivered. OIDC login/callback and Discourse SSO are available (`WK_OIDC_*`, `WK_SSO_KEY`); WebAuthn ceremonies are in progress. `Job` tokens are accepted as application credentials for worker operations, with the same expiry, idle timeout and revocation checks. `ResetPassword` tokens are rejected as application credentials.

## Implemented foundation and resources

- Bounded PostgreSQL pool, existing schema compatibility checks, typed ID/JSON/query/path validation, bound SQL, shared JSON error responses, and transaction-based multi-record mutations.
- Request IDs, token-safe structured HTTP logs, request/body limits, panic handling, cache prevention, liveness/readiness, and graceful SIGINT/SIGTERM shutdown with a deadline.
- Teams: list/create/delete with membership filtering, reference checks and dependent membership cleanup.
- Scripts: list/get/create/update/delete, compact owners, ownership transfer and task reference cleanup.
- Projects and task types: CRUD, validation, status, project lookup, pause/resume, pending-instance increments, task-type projects and active-task users.
- Tasks: read/filter/list, project pagination, experience domains, next-task preview, pending-instance updates and transactional deletion. Active-task transfer is available; task creation and assignment still require tracing integration.
- Datasets: shared access checks, compact/full serialization, metadata/source updates, sharing/team grants, configurations, discovery/import/composition, upload reservations/completion, deletion/path cleanup, thumbnails, storage details and Segment Anything forwarding. Remote work calls the existing datastore through a bounded HTTP client; the datastore engine is still Scala.
- Authentication lifecycle: API/datastore token issuance, revocation, single-token and account-wide logout, plus existing passkey listing/removal when HTTPS and the passkey feature are enabled. WebAuthn registration and login remain pending.
- Folders: root/tree/get/create/update/move/delete, closure-table hierarchy, inherited permissions, metadata, team grants, cycle and nonempty-folder checks.
- Users: current/get/list/update, roles/team memberships, experience fields, activation constraints, account email changes and user/keyboard preferences. Projects include active-task transfer.
- Organizations: reads, creation/onboarding/deletion, admin updates, pricing/plan updates, upgrade requests and terms acceptance. Credit grants, reservations/refunds, expiry revocation and public publications are implemented.
- Jobs and workers: list/read/status/cancel/retry/export, costs, worker reservation/status callbacks and Voxelytics events/reports/Loki access. All eight job submission routes and all AI model routes are implemented, including upload-to-path, training and inference submissions.
- Annotations: saved/compound access provider, original protobuf types, real tracingstore merge/get RPC, metadata/sharing, cancellation, collaboration mode and session-specific editing mutexes with configurable expiry. Compound results and temporary data sources have bounded lifetimes. Other lifecycle, IO and task creation routes remain pending; periodic physical cleanup of expired mutex rows is also pending.
- Main application service callbacks: datastore source reports/status, source reads/updates, dataset lookup/deletion and job export properties; tracingstore datasource/dataset/tracing lookups and protobuf annotation layer/description updates. The remaining datastore upload callbacks and tracingstore update-report/create-tracing callbacks are tracked in the route inventory.
- Application features/build information, certificate checks, initial data, analytics ingestion/forwarding, time reports, maintenance notices and short links.

API paths are preserved under `/api` and API versions 10–16. Dataset lists default to full responses on versions 10–15 (`compact=true` selects compact); latest/v16 always return compact lists. Versions 10–14 convert safe `largestSegmentId` bigint envelopes to plain numbers, retaining envelopes above JavaScript's safe-integer range. Unsupported routes return a JSON 404; unsupported methods return 405. This server does not forward requests to Play automatically. Use an explicit proxy allowlist if evaluating selected Rust routes alongside Play; do not route the entire frontend to it yet.

## Verification

```sh
make check
make test
```

Database tests are explicitly ignored by the ordinary test command. To run **all** tests, provide PostgreSQL 15 or newer and an administrative connection with `CREATEDB`:

```sh
export WK_RUST_TEST_DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/postgres'
make test-db
```

Each database test creates a new `wk_rust_test_<uuid>` database, applies the repository's full schema there, seeds isolated fixtures, and drops only that generated database. The URL's database is never initialized or modified. The tests cover authorization, cross-organization access, soft-deleted records, concurrent creation, reference cleanup, inherited folder permissions, and forced failures proving transaction rollback. A test panic can leave its generated database for debugging.

The Rust backend is independent of sbt and Yarn; no Scala/frontend source or build behavior is changed. Cargo.lock is included for reproducible dependency resolution.

## Architecture and compatibility boundaries

`src/main.rs` owns process lifecycle; `config.rs` validates settings; `db.rs` owns pool/schema checks; `auth.rs` resolves existing tokens and permissions. `lib.rs` assembles module routers. Each domain module implements its actual SQL, authorization and public representation rather than exposing a generic table CRUD interface. `extract.rs` and `error.rs` keep error responses consistent; `id.rs` produces BSON-compatible 24-character IDs. Input IDs normalize hexadecimal case; only URI path IDs permit Play’s human-readable prefixes, while JSON and query IDs remain strict. JSON timestamps remain milliseconds where Scala uses `Instant`.

Deliberate stricter behavior is covered by tests: live identities/teams are required; user/team/project/folder access is limited to the authenticated organization even in the presence of inconsistent foreign membership rows; folder deletion requires write access; folder moves reject cycles; short links must match the configured URL's parsed origin/path instead of a string prefix. User experience/role changes and Voxelytics workflow ownership enforce authorization checks that Play currently discards. Service-client redirects remain on the same origin to keep RPC credentials from reaching another host. Mutation conflicts can return 409 and should be retried after re-reading. Human-readable error wording is not fully matched to Scala's message catalog.

Token lookup replaces expired/revoked authentication tokens instead of returning unusable values. Issuance and logout serialize across account identities, and revocation cutoffs never move backwards. Dataset responses recursively strip credentials. Personal dataset configuration behavior follows Scala's saved-user configuration contract, while administrative mutations require the applicable read/edit permissions. Mailchimp and Slack side effects, some read-side analytics and periodic background workers remain pending. Outgoing mail is recorded without delivery until an SMTP transport is implemented; password-reset and invitation flows therefore require that remaining integration before real use.

The existing Scala schema evolution system remains authoritative. Its SQL constraints, enum types, views, triggers and soft-delete flags are shared; no alternate Rust-only application schema is introduced. The temporary test fixture schema bootstrap is intentionally isolated from runtime initialization.

See [Axum's routing and middleware documentation](https://docs.rs/axum/0.8.9/axum/) and [SQLx's PostgreSQL pool documentation](https://docs.rs/sqlx/0.8.6/sqlx/postgres/type.PgPoolOptions.html) for the underlying framework APIs. See [MIGRATION_STATUS.md](MIGRATION_STATUS.md) for every implemented and outstanding route and the order of subsequent work.

## Resuming delegated work

[checkpoints/coordinator.md](checkpoints/coordinator.md) records file ownership, integration status, and test commands. Each sub-agent updates its own checkpoint at milestones and periodically while working. These files and the current code are the recovery source after a usage reset; inspect them before reassigning files or relying on an earlier test result.
