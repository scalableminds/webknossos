# DS1 ZIP vault bounded verification

## Status
DONE bounded vault verification (2026-10-12): 7 integration tests and 3 metadata unit tests pass. Parent reader/HTTP-route integration and whole-crate checks complete:436 passed, no failures/ignored; fmt/all-target clippy/inventories clean. This is not migration completion. Overall datastore migration remains incomplete.

## Done
- Read authoritative Scala ZipDataVault and existing Rust implementation. Coordinator entry was stale: HEAD already contains compiled Scala oracle tests/JSON and deterministic generator; restored ignored fixture archives with the existing generator.
- Independent Python zipfile archive generator and checked-in ordinary/ZIP64 archives; Python testzip verifies both.
- Tests cover local stored bytes, clamped/suffix ranges, Unicode, directory children/storage, missing/compressed entries, invalid range; actual HTTP bounded range requests, central-directory cache, current token, and failed-load retry.
- Malformed EOCD/central-directory/ZIP64 locator/extra-field coverage.
- Robustness fix: ZIP64 tag payload length now bounds extended metadata reads, avoiding interpreting following tags as sizes. Scala reads through to entire extras end; this deliberate fix is stricter on malformed archives.

## Next
- Central verification complete; log /tmp/webknossos-rust-ds-continuation-final-tests.log.
- Broader datastore differential/performance/config/cutover work remains with coordinator.

## Evidence
- Source: webknossos-datastore/app/com/scalableminds/webknossos/datastore/datavault/ZipDataVault.scala.
- `python3 datastore/tests/fixtures/zip/generate.py` (from backend-rust): verified ordinary and promoted ZIP64 archive using Python standard-library ZipFile.testzip.
- Focused runs used approved localhost permission. All owned tests pass after inspecting wrapped error chains; no unresolved focused failures.

## Focused integration milestone
- `cargo test --locked --test zip_vault`: **7 passed, zero failures/ignored** (escalated localhost permission, shared target). Includes replay of **1,172 existing compiled Scala cases**, sparse >4 GiB ZIP64 offsets/read limits, real Python archives and actual HTTP range/cache/current-token/failure-retry/warm-cache-denial tests.
- Preserved prior oracle test logic inside a nested module; new tests supplement it.
- `rustfmt --edition 2024` on owned Rust files completed. Parent whole-crate fmt/clippy still required.

- `cargo test --locked --lib datavault::zip::tests`: **3 passed**, covering all seven conditional ZIP64 sentinel-field combinations with preceding unknown tag, signed64 overflow, cross-tag truncation, and normalized duplicate-name last-entry semantics.

## Parent integration / reproducibility milestone
- Parent reports actual ZIP reader/HTTP-route verification passed (local/remote datasource data reads, authorization/cache/reload coverage); central final run in progress.
- Parent unignored all original tiny generated ZIP fixtures, making existing compiled Scala oracle tests reproducible from a fresh checkout without a fixture-generation prerequisite.

## Read-only Slack integration review
- Reviewed Rust `slack.rs`, HealthProblems/AppState wiring, upload observation middleware, binary-data timing hook and Slack tests against Scala `SlackClient`, `DSSlackNotificationService`, `RequestLogging`, UploadController and BinaryDataController.
- Reported rate-window first-send anchor mismatch to parent: Rust initialized at client construction whereas Scala resets on first notification (last timestamp zero). A first burst59s after construction and second61s permits60 messages in2s in Rust; Scala rejects second burst. Parent owns repair/verification.
- Upload success detection and scope, 120s finish/600s binary-data thresholds, post-authorization binary timing, alert titles/colors/status wording match authoritative behavior. Generic internal-error/failed-upload details and URI query removal are explicit privacy deviations.
- No reviewed source edits or builds; parent central verification remains authoritative.
