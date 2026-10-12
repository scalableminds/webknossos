# Datastore dataset upload report (R2d)

Owner: `src/remote_datastore_dataset_report.rs`, `tests/remote_datastore_dataset_report.rs`, this file. Router (`router()`) already merged in lib.rs by parent. Minimal visibility changes elsewhere (below).

## Status
- DONE, agent-verified (2026-10-10). One route, both needsConversion branches fully ported (no faked side effects; Slack/Mailchimp gap below).
- Next: parent central verification + inventory regeneration.

## Contract (Scala WKRemoteDataStoreController.reportDatasetUpload)
- POST `/datastores/{name}/reportDatasetUpload?key=&token=&datasetId=` (body ReportDatasetUploadParameters) → 200 empty.
- Order: `Query` (missing token/invalid datasetId → 400 "Invalid query parameters.") → key auth `ValidatedDataStore` (403 `{granted:false,msg}`) → body (crate-wide key-before-body) → `userForToken ~> FORBIDDEN` (403 Msg.User.Token.invalid) → DatasetDAO.findOne global (404 Msg.Dataset.notFound(id)) → trackNewDataset (fire-and-forget) → if dataSourceOpt: LayerToLinkService.addLayersToLinkToDataSource under the user's access (any link failure → 400 "Could not resolve layers to link."; linked layers first, then uploaded; duplicate names → 400 Msg.Dataset.Layer.duplicateNames) → DatasetDAO.updateDataSource(id, dataset._dataStore, hash, source, isUsable=true) → findOne again (404) → branch.
- needsConversion = false: `dataset_storage::refresh_for_dataset` → `dataset_lifecycle::scan_realpaths_if_virtual` → `write_mirror_for_virtual` (both no-ops unless virtual + usable; mirrorPath stored).
- needsConversion = true: voxelSize required (400 Msg.Dataset.Upload.needsConversionMissingVoxelSize) → clientFor(dataset) global (missing store → 400 Msg.DataStore.notFound) → GET `/data/getOrganizationBaseDirectory?organizationId=<dataset org>&requireLocal=true&requireAllowsUpload=true` (UPath string) → submitConvertToWkwJob on the updated row: organization lookup (400 Msg.Organization.notFound) → `job_submission::submit_job` (jobs enabled from `MiscState.config().jobs_enabled`, worker of `dataset._dataStore` supports convert_to_wkw; convert_to_wkw is not storage-gated) wrapped `?~>` "Could not start image conversion/import job." (chain rendered) → RunJobEvent analytics. commandArgs: organization_id, organization_base_directory, organization_display_name, dataset_name, dataset_id, dataset_directory_name, voxel_size_factor (`Vec3Double.toUriLiteral`, Java Double.toString per component via `thumbnails::java_double_string`), voxel_size_unit.
- Body: `needsConversion`, `datasetSizeBytes`, `layersToLink` required; `dataSourceOpt` parsed as UsableDataSource (`dataset_source::parse_data_source`), `voxelSize` as VoxelSize (bare factor = nanometer, or {factor, unit}); malformed → 400 invalid body.

## Deviations / gaps (deliberate)
- trackNewDataset: UploadDatasetEvent analytics is ported (`upload_dataset`, properties dataset_id/dataset_name/dataset_size_bytes/datastore_uri(publicUrl)/dataset_organization_id; skipped when the store row is missing). **Slack "Dataset added (upload without conversion)" notification and Mailchimp HasUploadedOwnDataset tag are not ported** (crate has no Slack/Mailchimp clients; logged only), same as job_workers / onboarding.
- updateDataSource row + layers run in one transaction (Scala: separate statements). `inboxSourceHash` is the crate's deterministic canonical-JSON hash, not Scala's case-class hashCode (see remote-datastore.md).
- Errors after the data source update leave it committed (matches Scala, no transaction across the chain). RPC failures use the crate's ServiceError mapping.
- Key before body (crate-wide R1 decision): wrong key + malformed body → 403 (Play 400).
- Token user lookup follows `user_for_service_token` revocation checks (see R2a).

## Visibility changes
- `src/job_submission.rs`: `async fn submit_job` → `pub(crate)`.
- `src/remote_datastore.rs`: `async fn write_data_source` → `pub(crate)` (DatasetDAO.updateDataSource).
- `src/dataset_upload_paths.rs`: `async fn resolve_linked_layers` → `pub(crate)` (LayerToLinkService.resolveLayerToLink).

## Evidence
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-b WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --locked --offline --test remote_datastore_dataset_report -- --include-ignored` → 2/2 pass.
  - without conversion: wrong key 403, missing token 400, bad token 403, unknown dataset 404, malformed dataSource / missing fields 400, link to other-org dataset + unknown layer → 400 resolve failed, duplicate names 400 (dataset untouched, no RPC), upload_dataset analytics stored even on later failure, success → usable, status "", hash, voxel unit, layers [linked(renamed), segmentation], linked mag path, RPCs measureUsedStorage → scanRealPathsForVirtual → writeMirrors (mirrorPath stored, usedStorage rows), no-dataSource report leaves dataset unchanged, no job.
  - with conversion: missing voxel size 400 (no RPC), jobs disabled / no worker → 400 submitFailed + chain cause after base-dir RPC (exact query incl. requireLocal/requireAllowsUpload/token), worker present → PENDING convert_to_wkw job with exact commandArgs (Java double factor "11.24,11.24,28.0", unit), run_job analytics, no storage/scan/mirror RPCs; dataSource + bare-factor voxel size also stored with conversion.
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-b) → clean. `rustfmt --edition 2024 --check` on all touched files → clean.
