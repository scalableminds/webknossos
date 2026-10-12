# Datastore mag upload callbacks (R2a)

Owner: `src/remote_datastore_mag_upload.rs`, `tests/remote_datastore_mag_upload.rs`, this file. No other files edited. Router already merged in lib.rs by parent.

## Status
- DONE, agent-verified (2026-10-10). Two routes:
  - POST `/datastores/{name}/reserveMagUpload?key=&token=` (body MagUploadInfo) → 200 `{"dataSourceId":{"name":directoryName,"team":organization}}`.
  - POST `/datastores/{name}/reportMagUpload?key=` (body ReportMagUploadParameters) → 200 empty.
- Next: parent central verification + inventory regeneration. Attachment routes (R2b) should reuse the shared helpers below.

## Contract (Scala WKRemoteDataStoreController)
- Key auth via `remote_datastore::ValidatedDataStore` (403 `{granted:false,msg}`); `Query<TokenQuery>` precedes it (missing token → 400 "Invalid query parameters.", as Play binds query first).
- reserve order: userForToken (any unusable token → 400 Msg.User.Token.invalid; uses `auth::user_for_service_token`) → DatasetDAO.findOne with user read access (`dataset_access::can_read`; no access/missing/deleted → 404 Msg.notFound) → isVirtual (400 reserveMagUploadNotVirtual) → getDataSourceAndLayerFor (usable w/o voxel size → 404 DataSource.notFound; unusable → 400 notUsable; missing layer → 400 Layer.notFound) → maxDim conflict vs. **non-pending** mags (400 `New mag (x, y, z) conflicts with existing mag of the layer.`) → `_dataStore == store.name` untrimmed (400 different-datastore text) → handleExistingPendingMag → insertWithUploadPending (path NULL, uploadIsPending, axisOrder/channelIndex).
- Pending handling (shared semantics with uploadToPaths): any row with uploadIsPending or uploadToPathIsPending; without overwrite → 400 magAlreadyPending; with overwrite → upload-to-path rows' `COALESCE(realPath,path)` deleted at the dataset's datastore via `dataset_paths::delete_paths` (managed S3 paths queued), then pending rows deleted.
- report order: dataset exists (global access, 404 Msg.Dataset.notFound(id)) → pending upload row (only `uploadIsPending`) else 400 magNotPending → mag.path set else 400 magPathNotSet → finishUpload (flags false, path = normalized UPath) → clientFor (store missing → 400 DataStore.notFound) → DELETE `/data/datasets/{id}` → `dataset_storage::refresh_for_dataset`. Reporting store need not own the dataset (Scala does not check).

## Deviations (deliberate)
- Transactional reserve: delete-pending + insert run in one transaction under a dataset row lock (`FOR UPDATE`), with a re-check of pending rows when not overwriting (Scala: separate statements). The deletePaths RPC runs before the transaction (as Scala, before the DB delete).
- report: pending check and finishUpload are a single guarded `UPDATE … AND uploadIsPending` (atomic; same results). The DB update is committed before the RPC/storage refresh; an RPC failure returns the mapped service error with the mag already finished (matches Scala, which has no transaction).
- getDataSourceAndLayerFor is reduced to its failure contract (voxel size / usable / layer exists); malformed stored layer rows are not re-parsed. MagLocator `credentials` (legacy) is not validated (unused).
- Key before body (crate-wide R1 decision): wrong key + malformed body → 403 (Play 400).
- Token user lookup follows the crate's `user_for_service_token` revocation checks (deactivated / logged-out-everywhere users rejected → 400 token invalid; Scala would 404 for a deleted user).

## Shared pub(crate) helpers (for R2b attachments)
`TokenQuery`, `user_for_callback_token`, `ResumableUploadInfo`, `UploadTarget` (+ `additional_info()`), `load_virtual_upload_target(pool,user,id,not_virtual_msg)`, `require_usable_layer`, `require_same_datastore(target,store,msg)`, `after_upload_reported(pool,clients,dataset_id)` (cache invalidation + used-storage refresh), `MagLocator`.

## Evidence
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-b WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --locked --offline --test remote_datastore_mag_upload -- --include-ignored` → 2/2 pass (reserve: key/store/token/access/body/virtual/usable/voxel/layer/maxDim/datastore/success/pending/overwrite incl. upload-to-path deletePaths RPC + queue; report: key/body/404/not-pending variants/path-required/success via other store with invalidate+measureUsedStorage RPCs and usedStorage rows/repeat/RPC-failure-after-commit).
- `cargo test --lib remote_datastore_mag_upload` → 1/1 (MagLocator reads).
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-b) → clean. `rustfmt --edition 2024 --check` on both files → clean.
