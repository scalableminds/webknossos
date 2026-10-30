# Datastore dataset upload reservation + unfinished list (R2c)

Owner: `src/remote_datastore_dataset_upload.rs`, `tests/remote_datastore_dataset_upload.rs`, this file. Minimal visibility changes in `src/dataset_upload_paths.rs` (below). Router already merged in lib.rs by parent.

## Status
- DONE, agent-verified (2026-10-10). Two routes:
  - POST `/datastores/{name}/reserveDatasetUpload?key=&token=` (body DatasetUploadInfo) → 200 `{"newDatasetId", "directoryName"}` (DatasetUploadAdditionalInfo).
  - GET `/datastores/{name}/getUnfinishedDatasetUploadsForUser?key=&token=&organizationId=` → 200 `[UnfinishedUpload]`.
- Next: parent central verification + inventory regeneration. R2d reportDatasetUpload can reuse `LinkedLayer` + `resolve_linked_layers` (still private) from dataset_upload_paths.

## Contract (Scala WKRemoteDataStoreController)
- Key auth via `ValidatedDataStore` (403 `{granted:false,msg}`); `Query` precedes it (missing token/organizationId → 400 "Invalid query parameters.").
- Token: `userForToken ~> FORBIDDEN` → 403 Msg.User.Token.invalid (reuses `user_for_callback_token`, status remapped 400→403).
- reserve order: token → org `organizations_` lookup (404 Msg.Organization.notFound(id)) → assertUsedStorageNotExceeded on the **requested** org with `used + totalFileSizeInBytes <= includedStorage` (NULL = unlimited; 403 Msg.Dataset.Upload.storageExceeded) → org == user org (403 Msg.notAllowed) → assertValidDatasetName (400) → datastore `onlyAllowedOrganization` (400 datastoreRestricted) → each layerToLink: readable else 404, then admin-of-dataset-org / team manager in dataset org / dataset manager / public else 400; both carry Msg.Dataset.Upload.invalidLinkedLayers (`?~>` keeps ParamFailure status) → requireUniqueName → 400 Msg.Dataset.Name.taken → createAndSetUpDataset (any failure → 400 Msg.Dataset.Upload.createFailed, incl. folder without write access / unknown folder) → addInitialTeams (shared `add_initial_teams`; 400 invalidTeams / forbidden).
- Created dataset: `_dataStore` = calling store, org = user org, folder = folderId or root, `_uploader` = user, isUsable false, isVirtual = `isVirtual` default true, status "Not yet fully uploaded.", creationType Upload, no layers, voxel size NULL, directoryName `generate_directory_name(name, id)`, metadata `[]`, private.
- createDataset's scanRealpathsIfVirtual / writeMirrorForVirtual are no-ops for unusable datasets → no datastore RPC.
- unfinished: token → org (404) → own org (403) → datasets_ with `_uploader = user`, `_organization = user org`, NOT isUsable, status notYetUploaded, created ≥ now − 14 days; per dataset `dataset_allowedTeams` ids. JSON: `uploadId: "<filled-in by datastore>"`, `dataSourceId {name: directoryName, team: org}`, `datasetName`, `folderId`, `created` (epoch millis), `allowedTeams`; `filePaths` (None) omitted as Play does. Query failure → 400 couldNotLoadUnfinishedUploads.
- Analytics: Scala tracks nothing in these two routes (trackNewDataset happens in reportDatasetUpload, R2d). No hook needed.

## Deviations (deliberate)
- Transactional reserve: dataset insert + folder/uploader + initial teams commit atomically (Scala: separate statements; an initial-team failure would leave the dataset behind).
- Unfinished list ordered by `created, _id` and team ids sorted (Scala: unspecified order).
- Body leniency: `voxelSizeUnit` accepted as any string, `needsConversion`/voxel size unused (datastore-only). Key before body (crate-wide R1 decision).
- Token user lookup follows `user_for_service_token` revocation checks (see R2a).
- DB errors inside createAndSetUpDataset stay 500 instead of being wrapped as 400 createFailed.

## Visibility changes (src/dataset_upload_paths.rs)
- `struct LinkedLayer` and its three fields → `pub(crate)`.
- `async fn add_initial_teams` → `pub(crate)`.

## Evidence
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-b WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --locked --offline --test remote_datastore_dataset_upload -- --include-ignored` → 2/2 pass (reserve: key/store/query/token/body/org 404/storage on requested org incl. boundary/wrong org/name/restricted store/link 404+400+public+team manager/unique name/folder createFailed/initial-team rollback/success row+teams/isVirtual=false via restricted store; unfinished: key/query/token/org 404/wrong org/empty/filters uploader+usable+age+status+deleted/JSON shape+order).
- `--test dataset_upload_paths` → 2/2 pass after visibility change.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-b) → clean. `rustfmt --edition 2024 --check` on touched files → clean.
