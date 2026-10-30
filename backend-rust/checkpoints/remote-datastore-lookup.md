# Datastore lookup/deletion callbacks (R3)

Owner: `src/remote_datastore_lookup.rs`, `tests/remote_datastore_lookup.rs`, this checkpoint.
Narrow shared edit explicitly authorized by parent: `src/dataset_lifecycle.rs` deletion-helper extraction. Parent owns lib/config/Cargo/docs/inventory.

## Status
- DONE, agent-verified in current Codex resumed session. Parent wired `remote_datastore_lookup::router()`; central full suite and inventory remain parent's task.
- Four routes: POST `/datastores/{name}/deleteDataset` (JSON ObjectId string); GET `/datastores/{name}/findDatasetId` (`datasetDirectoryName`, `organizationId`); GET `/datastores/{name}/findDatasetLocalRootPath` (`datasetId`); GET `/datastores/{name}/jobExportProperties` (`jobId`). All use `?key=` live datastore service-key authentication; no user token required.
- Scope excludes R2 upload/report routes and AI model changes. Initial upload assignment superseded after discovering those routes already implemented by stopped prior agents.

## Implemented contracts
- Reuses `remote_datastore::ValidatedDataStore` and its exact 403 `{granted:false,msg:...}` envelope. Query binding runs before key validation; deletion body runs after it (same deliberate key-before-body behavior as R1).
- ID lookup uses directoryName + live organization, creation ordering, live datasets; not display name. Scala global-access semantics: does not restrict caller store or onlyAllowedOrganization. Missing organization ->404 organization message; missing dataset ->400 dataset-name message. All SQL values bound.
- Local-root lookup requires dataset's datastore equal caller ->403 notAllowed; missing/deleted dataset ->400 dataset-id message. Returns the original stored rootPath only when parseable/local, otherwise JSON empty string; never falls back to rootRealPath. Query ObjectIds normalize uppercase and reject URI prefixes.
- Job properties use global live job/owner/organization lookups, validate shared Job parsing, require latestRunId then string export_file_name. Response contains exactly jobId/runId/organizationId/exportFileName, no job args/credentials. Missing live dependencies ->404 generic; missing run/file ->400 exact messages. Caller datastore need not own job.
- `dataset_lifecycle::delete_from_db(pool,id)` performs shared DB deletion under transaction/row lock. Public dataset DELETE invokes the same private on-connection helper inside its existing transaction, preserving conversion-job cancellation atomicity and disk/RPC behavior.
- Callback deletion is idempotent for missing/already deleted datasets. Deletes layers/mags/attachments/teams/transforms/axes/storage rows; physically deletes dataset when no annotations exist. Even deleted annotations retain the dataset as isUsable=false/status `Deleted by user.` (isDeleted remains false, matching Scala). No disk deletion, RPC, or conversion cancellation from callback.
- Storage cleanup retains the existing lifecycle implementation's unconditional removal of the deleted dataset's storage rows. Scala storage refresh is gated by datastore reportUsedStorageEnabled; no measurement RPC is needed after all layer paths disappear.

## Evidence
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-a WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --locked --offline --test remote_datastore_lookup -- --include-ignored`: **3/3 pass** (session95396, 0.65s).
- Same Cargo/DB env, `cargo test --locked --offline --test dataset_lifecycle -- --include-ignored`: **3/3 pass** after helper extraction (session95488).
- `cargo clippy --locked --offline --lib --test remote_datastore_lookup --test dataset_lifecycle -- -D warnings` with same Cargo env: passes (session28356).
- `rustfmt --edition 2024 --check src/remote_datastore_lookup.rs tests/remote_datastore_lookup.rs src/dataset_lifecycle.rs`: passes.
- Tests create uniquely named databases before applying schema185; never bootstrap the administrative URL database. Sandbox escalation used for local PostgreSQL TCP. First test setup failed due duplicate mock datastore URLs; corrected fixtures, all handlers then passed. Those panic-created isolated DBs may remain for later coordinator cleanup.

## Focused coverage
- Correct/missing/wrong key, unknown/deleted store; global ID lookup across stores/organization restrictions; directory/display-name distinction, query escaping/injection binding, organization/deleted-dataset errors.
- Local absolute/relative/file URI/remote/invalid/null roots; original path preservation; no realpath fallback; datastore mismatch; uppercase and prefix rejection.
- Deletion malformed ObjectId bodies, simultaneous duplicate deletes, no conversion cancellation, full dependent/storage cleanup, deleted-annotation retention, missing-id no-op, and forced final DELETE failure that rolls back all prior child/storage deletions with sanitized error.
- Job export exact response, global store access, missing run/file, nonstring filename, invalid command, deleted job/owner/organization, key authentication and query ID contracts.
