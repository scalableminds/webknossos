# Datastore registry checkpoint

Owner: auth_routes_stage2 delegated agent. Owns NEW `src/data_stores.rs`, `tests/data_stores.rs`, this checkpoint; also credential files tracked in credentials.md. Parent owns lib/config/Cargo/docs/inventory and centralized cargo.

## Contracts / completed
- Inspected DataStoreController, DataStore model/DAO/service, SQLDAO read permissions, schema and worker public response helper.
- New `data_stores::router(jobs_enabled:bool)->Router<AppState>` implements actual GET `/datastores`, POST `/datastores`, DELETE `/datastores/{name}`.
- GET anonymous => [] because DataStoreDAO inherits anonymous read FALSE. Authenticated visible stores are unrestricted + onlyAllowedOrganization matching caller identity; superusers do not bypass this predicate. Explicit invalid user tokens rejected with established OptionalAuthUser semantics.
- Reuses `datasets::public_datastore_json_on_connection` to return only name/publicUrl as url/allowsUpload/jobsSupportedByAvailableWorkers/jobsEnabled with shared worker-command validation/jobs flag. Keys/internal URL/config flags never in public response.
- POST requires superuser; both mutation routes recheck and hold shared locks on live multiuser/user/organization in consistent order to stabilize privilege through commit; exact DTO requires name/url/publicUrl/key, accepts optional isScratch/allowsUpload/allowsUploadToPaths with defaults false/true/true. Other fields ignored as Scala Json macros. Bound transactional duplicate check + INSERT + public response rendering before commit; live scoped duplicate returns Scala nameTaken message; schema constraints still apply including unique PK for deleted entries.
- DELETE superuser only, idempotent soft-delete, leaves referenced datasets/workers/credentials intact and missing names return empty 200.

## Tests / verification
Five PG integration tests written for anonymous and organization read visibility, secret-free public rendering, jobs enabled/disabled/worker commands, superuser create/default flags/input validation/duplicates, idempotent delete and retained dependencies. No cargo run by this agent; parent verifies centrally. Parent verification requested. List locks visible datastore rows FOR SHARE and renders on the same transaction connection; create renders inserted store before commit, preventing a concurrent soft-delete from producing 404 after committed creation. Dataset agent supplied shared connection helper. No new dependencies.

## Latest verification evidence
Parent centralized PostgreSQL run: all five datastore registry integration tests passed.
