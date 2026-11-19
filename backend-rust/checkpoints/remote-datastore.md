# Remote datastore callbacks checkpoint (batch R1, Claude sub-agent)

Owns `src/remote_datastore.rs`, `tests/remote_datastore.rs`, this file. Small additions elsewhere: `src/dataset_source.rs` (`UnusableDataSource`, `AnyDataSource`, `parse_any_data_source`, `AnyDataSource::inbox_source_hash`), `src/lib.rs` (`pub mod remote_datastore;` + `.merge(remote_datastore::router())`).

## Status
- Status: DONE (R1). 6 WKRemoteDataStoreController routes implemented and verified.
- Done:
  - PATCH `/datastores/{name}/status` (statusUpdate: only `url` is persisted, as in Scala; body `{ok,url}`).
  - PUT `/datastores/{name}/datasource` (updateOne → updateDataSources with root paths None, no deactivation).
  - PUT `/datastores/{name}/datasources?organizationId=` (updateAll → updateDataSources + deactivateUnreported).
  - PUT `/datastores/{name}/datasources/realpaths` (updateRealPaths).
  - GET / PUT `/datastores/{name}/datasources/{datasetId}` (getDataSource via `datasets::data_source_for_rpc(real paths)`; updateDataSource skips virtual datasets, keeps root paths, no thumbnail/RPC side effects, `_dataStore` set to the URL name like Scala).
  - Shared `ValidatedDataStore` extractor + `validate_access` + `forbidden_response` (exact Play 403 `{granted:false,msg:"Data store could not be found or accessed."}`), reusable by R2/R3. `DataStoreRecord {name,is_scratch,only_allowed_organization}`; key never selected/logged.
  - Polymorphic DataSource reads (Unusable first, then Usable, as Play's `dataSourceFormat`); unusable layers/scale are persisted like Scala's `allLayers`/`voxelSizeOpt`.
  - Full report semantics: grouped by organization (sorted), non-existing org ignored, `onlyAllowedOrganization` mismatch ignored (those datasets then get deactivated, as Scala), virtual found → counted existing/untouched, same store → skip if hash+rootPath+rootRealPath unchanged else thumbnails cleared (+thumbnailCacheVersion) and `updateDataSource`, different store → replaced only if original store is scratch and reporter not, or status is unreported; missing original store → 404 Msg.notFound (Scala Fox.Empty); new → DiskScan creation via `dataset_create::insert_dataset` (+hash only if usable, rootPath/rootRealPath). Deactivation: mags+layers deleted, status/isUsable/voxel/hash reset exactly like DatasetDAO.deactivateUnreported (status filter only on UPDATE).
  - Tests: `tests/remote_datastore.rs` 2 PG + mock-datastore HTTP tests (key/status/GET/PUT per dataset/realpaths; full report update/create/skip/replace/keep/deactivate/org filter/restricted store/single report/atomic rollback). Unit test in remote_datastore.rs (reads + hash stability).
  - Verification 2026-10-09: focused 2/2 pass; clippy `--all-targets -D warnings` clean; rustfmt check clean on touched files; full suite `--no-fail-fast -- --include-ignored` → 267 passed, 0 failed (exit 0). Log: scratchpad r1-full.log. MIGRATION_STATUS.md / route inventory NOT regenerated (coordinator owns it).
- In-flight: none.
- Next step: coordinator regenerates the route inventory; then R2/R3 (below).

## Decisions / deviations (documented, deliberate)
- **inboxSourceHash**: Scala stores the case-class `DataSource.hashCode` (not reproducible). Rust stores `AnyDataSource::inbox_source_hash()` = first 4 bytes (BE i32) of SHA-1 over the canonical (BTreeMap-sorted, serde_json has no preserve_order) JSON of the parsed source. Skip logic works for Rust↔Rust reports; after switching from Scala every dataset is rewritten exactly once (thumbnails cleared + one DS cache invalidation each). Other Rust writers (updatePartial, compose, upload paths) still store NULL → one rewrite on the next report, same as before. Unusable sources created by a report get NULL hash (Scala too) → rewritten once on the next report.
- **Atomicity**: each report request is one transaction (all dataset updates/creations + deactivation). Scala commits per dataset and stops at the first error (keeping earlier progress, never deactivating). Rust rolls back everything on error. The work runs in a `tokio::spawn`ed task so the 30 s request timeout or a disconnect cannot cancel a large report half-way (it commits anyway; next report is cheap). Datastore cache invalidations (`DELETE /data/datasets/{id}`, notifyDatastoreOnUpdate) run after commit; all are attempted and the first failure is returned.
- **Key before body**: `ValidatedDataStore` runs after Path/Query extractors but before the JSON body, so wrong key + malformed body is 403 (Play: 400). Body limit on these routes is Play's `maxMemoryBuffer` 250 MiB (route-level `DefaultBodyLimit`), applied only after authentication.
- realpaths: one transaction for the whole list; per path `UPDATE … WHERE path=$ AND (realPath IS DISTINCT FROM $ OR hasLocalData <> $)` (equivalent to the DAO's changed-only filtering). UPaths normalized with `normalize_upath`; invalid → 400.
- DB errors use the shared mapping (e.g. unique violation 409 instead of Play's 400 SQL failure). Duplicate directory name against a soft-deleted row fails the whole report (Scala: fails at that dataset).
- GET usable-without-voxel-size → 400 "Dataset is marked as usable but has no voxel size." (Scala message).

## Notes for R2 (upload reserve/report, 7 routes)
- Use `remote_datastore::ValidatedDataStore` (put `Query` with `token` before it; Play binds all query params first; `reserveDatasetUpload`/`getUnfinished…`/`reportDatasetUpload` need `token` → bearer user via `userForToken`, failure 403). Extend `DataStoreRecord` (e.g. `only_allowed_organization` already there; add `url` if needed).
- reserveDatasetUpload ≈ `dataset_create::set_up_dataset` with UnusableDataSource(notYetUploaded) + storage quota check + layersToLink validation + addInitialTeams; isVirtual default true.
- reportDatasetUpload: `addLayersToLinkToDataSource`, `DatasetDAO.updateDataSource` (use `write_data_source` in remote_datastore.rs — currently private, make pub(crate)), then storage refresh/scan/mirror or convert_to_wkw job (job_submission helpers). trackNewDataset analytics excluded.
- reportMag/AttachmentUpload: pending row checks + finishUpload + invalidate cache + `dataset_storage::refresh_for_dataset`. Reserve mag/attachment: `dataset_lifecycle::{MagUploadRequest,AttachmentUploadRequest}` + upload_paths pending handling helpers.
## Notes for R3
- deleteDataset (body = JSON ObjectId string) → DatasetService.deleteDatasetFromDB (see dataset_lifecycle delete helpers). findDatasetId (organization 404 Msg.Organization.notFound, then findOneByNameAndOrganization ORDER BY created, 400 "Dataset with name “x” could not be found or accessed."). findDatasetLocalRootPath (dataset store must equal caller → 403 Msg.notAllowed; returns JSON string, "" if not local; use `dataset_source::upath_is_local`). jobExportProperties (job/owner/org lookups; Msg.Job.notRun / noExportFileName).
