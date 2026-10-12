# Misc controllers (agent A2)

## Status
- Status: M1 DONE (2026-10-09). Remaining batches start with M2.
- Done (M1, 7 routes, all verified): GET /buildinfo, GET /features, GET /checkCertificate, POST /helpEmail (`src/application_info.rs`, `tests/application_info.rs`); POST /analytics/ingest, POST /analytics/:eventType (`src/analytics.rs`, `tests/analytics.rs`); POST /triggers/initialData (`src/initial_data.rs`, `tests/initial_data.rs`). Wired in `src/lib.rs`. Clippy clean; full suite 171 passed with `--include-ignored`; MIGRATION_STATUS.md regenerated.
- In-flight: none.
- Next step: M2 Time + Report (time_tracking.rs, reports.rs exist, unwired). NOTE: by the end of M1 some other agent had already wired `time_tracking::router()`/`reports::router()` in lib.rs and added tests/time_tracking.rs + tests/reports.rs (both passing) — check before redoing.

### M1 env vars (all optional)
- `WK_ANALYTICS_URI` (default `https://events-relay.webknossos.org/events` = application.conf; empty disables forwarding), `WK_ANALYTICS_KEY`, `WK_ANALYTICS_SESSION_PAUSE_SECONDS` (1800), `WK_ANALYTICS_SAVE_TO_DATABASE_ENABLED` (false), `WK_ANALYTICS_VERBOSE_LOGGING_ENABLED` (false), `WK_ANALYTICS_WELL_KNOWN_URIS` (comma list of `uri|key`).
- `WK_FEATURES_JSON` (object merged over application.conf `features`; dedicated flag vars win), `WK_BUILD_COMMIT_HASH`, `WK_BUILD_COMMIT_DATE`, `CI_BUILD_NUM`, `CI_TAG`.
- `WK_CERTIFICATE_PUBLIC_KEY` (fallback `CERTIFICATE_PUBLIC_KEY`; Play bakes it in at build time), `CERTIFICATE`.
- `WK_SUPPORT_EMAIL`, `WK_SAMPLE_ORGANIZATION_ENABLED` (false!), `WK_SAMPLE_USER_EMAIL/EMAIL2/PASSWORD/TOKEN/IS_SUPER_USER`, `WK_LOCAL_DATASTORE_ENABLED` / `WK_LOCAL_TRACINGSTORE_ENABLED` (false!) with `WK_{DATASTORE,TRACINGSTORE}_{NAME,KEY,PUBLIC_URI}`.

### M1 known gaps / deliberate deviations
- Sample organization and local store modules default OFF (application.conf dev defaults are ON): the unauthenticated trigger would otherwise create a superuser with a well-known token/password on any empty DB. buildinfo reports `localDataStoreEnabled: false` accordingly.
- Mail: plain-text body, no Reply-To; delivery via log-only `MailSender` default (no SMTP transport).
- Analytics: 24h `webknossos_heartbeat` ticker and server-side events from other controllers not ported (`analytics::track` is reusable). Ingest with an empty event list -> 400 with own message (Play: 400 "SQL Failure: ..."). JSON validation errors use the crate-wide "Invalid JSON request body." text.
- checkCertificate: ES256/ES384 only (no ES512/P-521 in ring); not cached for 1h (stateless recompute).
- InitialData: sample inserts are one transaction (+advisory lock); org-directory RPC after commit; `inboxSourceHash` NULL (Scala case-class hashCode not reproducible); DB errors map to the crate's 409/500 instead of Play's 400.
- helpEmail: auth is checked before body validation (Play parses the body first: invalid body + no auth -> 400 in Play, 401 here).

## Scope (37 routes)
Application: GET /buildinfo, GET /features, GET /checkCertificate, POST /helpEmail
Analytics: POST /analytics/ingest, POST /analytics/:eventType
InitialData: POST /triggers/initialData
CreditTransaction: GET /maintenance/revokeExpiredCredits, POST /creditTransactions/addCredits, PATCH /creditTransactions/:id, GET /creditTransactions
Time: GET /users/:id/loggedTime, GET /time/user/:id/spans, GET /time/user/:id/summedByAnnotation, GET /time/overview
Report: GET /teams/:id/availableTasksReport, GET /teams/:id/projectProgressReport
Publication: GET /publications, GET /publications/:id
Organization: POST /organizations, DELETE /organizations/:id, GET /operatorData, POST /pricing/upgradeRequest, GET /pricing/status, POST /pricing/updatePlan, GET /pricing/planUpdates, GET /termsOfService, POST /termsOfService/accept, GET /termsOfService/acceptanceNeeded
Project: POST /projects/:id/transferActiveTasks
User: PATCH /users/:id

## Contract notes
- Play Fox failures default to 400 unless `~> STATUS`; DAO Empty -> 404. `Ok` = 200 empty body.
- Message texts come from util/.../Msg.scala (use literal texts).
- Json.format (JsonAutoFormat) omits None fields; Json.obj with Option writes null.
