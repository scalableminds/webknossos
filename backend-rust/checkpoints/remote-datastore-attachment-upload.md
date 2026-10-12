# Datastore attachment upload callbacks (R2b)

Owner: `src/remote_datastore_attachment_upload.rs`, `tests/remote_datastore_attachment_upload.rs`, this file. No other files edited (reuses R2a `pub(crate)` helpers and `dataset_lifecycle::{AttachmentType, AttachmentDataformat}`, `dataset_source::normalize_upath`). Router already merged in lib.rs by parent.

## Status
- DONE, agent-verified (2026-10-10). Two routes:
  - POST `/datastores/{name}/reserveAttachmentUpload?key=&token=` (body AttachmentUploadInfo) → 200 `{"dataSourceId":{"name":directoryName,"team":organization}}`.
  - POST `/datastores/{name}/reportAttachmentUpload?key=` (body ReportAttachmentUploadParameters) → 200 empty.
- Next: parent central verification + inventory regeneration.

## Contract (Scala WKRemoteDataStoreController)
- Body: LayerAttachment `{name, path (UPath, required, validated), dataFormat enum, credentialId?}`; attachmentType enum; reserve also `resumableUploadInfo`, `overwritePending` (required); report `attachmentSizeBytes` (required). Invalid → 400 "Invalid JSON request body.".
- reserve order: key (403) → token query (400) → token user (400 Msg.User.Token.invalid) → dataset read access (404 Msg.notFound) → isVirtual (400 reserveAttachmentUploadNotVirtual) → getDataSourceAndLayerFor failure contract (shared `require_usable_layer`) → existence on **non-pending** attachments via getByTypeAndNameAlwaysReturnSingletons: singleton types (segmentIndex/cumsum/segmentStatistics) any name → attachmentSingletonAlreadyFilled, else same type+name → attachmentNameTaken → `_dataStore == store.name` (400 different-datastore text) → handleExistingPendingAttachment (row with uploadIsPending or uploadToPathIsPending for type+name: no overwrite → 400 "Conflict with existing pending attachment. Pass overwritePending to overwrite."; overwrite → delete row; **no** datastore path deletion, unlike mags) → insertWithUploadPending with path `./<pending upload>` (Scala `UPath.fromString("<pending upload>").toString`), dataFormat from body, credentialId NULL.
- Quirk preserved: pending singletons don't fill the slot, so differently named pending singletons can coexist.
- report order: key → dataset exists globally (404 Msg.Dataset.notFound(id)) → pending row (uploadIsPending only) else 400 attachmentNotPending → finishUpload (flags false, path = normalized UPath; dataFormat/credentialId unchanged) → shared `after_upload_reported` (clientFor 400 DataStore.notFound, DELETE `/data/datasets/{id}`, used-storage refresh). Reporting store need not own the dataset.

## Deviations (deliberate)
- Transactional reserve: dataset row lock (`FOR UPDATE`), re-check of non-pending existence, pending delete/check and insert in one transaction (Scala: separate statements).
- report: pending check + finishUpload is one guarded `UPDATE … AND uploadIsPending` on the primary key (same row Scala finds/updates). DB update commits before the RPC/storage refresh; RPC failure → mapped error with attachment already finished (as Scala).
- Inherited from R2a: key checked before body (wrong key + bad body → 403), token user lookup uses crate revocation checks.

## Evidence
- `CARGO_HOME=/tmp/webknossos-rust-cargo CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-a WK_RUST_TEST_DATABASE_URL=postgres://wk_rust_test@127.0.0.1:55439/postgres cargo test --locked --offline --test remote_datastore_attachment_upload -- --include-ignored` → 2/2 pass (reserve: key/store/token/access/body variants/virtual/usable/voxel/layer/name-taken/singleton-filled before datastore check/datastore/success/same-name-other-type/pending conflict/overwrite incl. upload-to-path row without RPC or delete queue/pending singletons; report: key/body/404/not-pending variants/success via other store with invalidate+measureUsedStorage and usedStorage row/repeat/RPC-failure-after-commit).
- `cargo test --lib remote_datastore_attachment_upload` → 1/1 (placeholder UPath rendering, singleton table).
- `cargo clippy --locked --offline --all-targets -- -D warnings` (verify-a) → clean. `rustfmt --edition 2024 --check` on both files → clean.
