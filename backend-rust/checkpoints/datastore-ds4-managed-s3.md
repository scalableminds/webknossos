# DS4 managed-S3 uploads — Codex 2026-10-12

Status: DONE. Dataset, magnification and attachment finish flows now transfer
staged files to the configured managed-S3 target instead of returning 501.
Only matching global S3 access-key credentials enable managed writes; absent
credentials fail before any storage request. Local staging remains required,
and worker-conversion datasets stay local even when S3 is configured.

## Implementation and contract

- `datavault/s3_upload.rs`: streamed signed PutObject, multipart create/parts/
  complete/abort, exact payload SHA-256, length and content type, escaped ETags,
  bounded retry policy (10 attempts), regional retry/cache and transient failures.
  Files/parts use 128 KiB buffers; SHA-256 is computed in a preliminary range read
  and the range is reopened for each attempt. Multipart starts above 8 MiB;
  part size grows to respect 10,000 parts and the 5 GiB per-part maximum without
  allocating whole parts. Empty files work. Completion validates success XML and
  rejects embedded HTTP-200 errors. Failed/cancelled multipart uploads are aborted
  (cancellation cleanup is asynchronous and cannot survive process termination).
- `DataVaultService.upload_directory_to_s3`: walks actual files without following
  symlinks, preserves nested/hidden/empty files, encodes each relative filename
  including spaces/percent/unicode, transfers at most 30 files concurrently and
  aggregates failures. Shared HTTP clients are reused; each directory transfer
  has one S3 vault with regional/protocol state.
- `upload_finish.rs`: dataset transfer follows validation/reference filtering,
  reports adapted remote mag/attachment paths only after transfer success, then
  removes unpacked dataset staging. Failures retain staged data and do not report
  successful upload. Mag/attachment uploads retain Scala's generated directory
  names and staged-copy behavior. Raw backup/Redis cleanup order stays unchanged.

## Evidence

The actual AWS SDK **2.53.2** pinned in `project/Dependencies.scala` generated
four fixed-time PUT/part/complete/abort signing goldens, including nonempty bytes,
XML, encoded keys, `+/&=` query values, endpoint ports and session tokens.
`tools/GenerateS3UploadSigningFixtures.java` and the fixture README reproduce them;
Java is not used at runtime. Rust signatures and payload hashes match exactly.

Seven focused storage tests cover exact streamed payloads, empty files, regional
and transient retries, multipart reconstruction/order/ETag escaping, errors
inside HTTP 200, missing fields, failure/cancellation abort and managed credential
prefixes/filename/symlink boundaries. Five actual authenticated router tests cover
remote dataset/mag/attachment receipts, conversion staying local, denial before
storage effects, missing credentials and retaining failed staged data. Existing
local upload/read-vault regressions also pass.

Whole datastore: **406 passed, 0 failed, 0 ignored across 46 harnesses**;
`/tmp/webknossos-rust-ds-managed-s3-tests.log`. fmt, all-target clippy `-D warnings`
and both inventories clean. Route registrations remain 132/132. No live S3 writes
or production deployment were performed; all storage calls used local fixtures.

## Remaining work

Legacy/version overrides, regional short-S3 URI rewrite, zip vaults and DS6
replay/performance/config/cutover. Differences requiring DS6 evaluation: SDK-like
retry categories use deterministic bounded backoff, uploads hash then reread each
range, transfer protocol/region state lives per directory rather than Scala's
long-lived transfer-manager cache, and cancellation abort is best effort.
Scala's `Some(<normalized name>)` attachment directory oddity is preserved;
whitespace in that target prefix still violates the existing Java-URI contract.

Restart checks use `CARGO_HOME=/tmp/webknossos-rust-cargo`,
`CARGO_TARGET_DIR=/tmp/webknossos-rust-ds-verify`,
`WK_DS2_ORACLE_DIR=/tmp/wk-ds2-oracle-wkw` with the complete locked/offline suite.
