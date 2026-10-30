# Used-storage scan (gap G7) checkpoint

Status (2026-10-11): DONE. The only remaining step is the parent's main.rs wiring (below). Owner: used-storage-scan sub-agent (target /tmp/webknossos-rust-verify-c).
Owned: src/dataset_storage.rs, tests/used_storage_scan.rs (new), .env.example (appended), this file.
Not touched: lib.rs, config.rs, main.rs, Cargo.*, scheduler.rs. The scaffold signatures `UsedStorageConfig` + `config_from_values(&HashMap)` are kept.

## Scala truth
`app/models/storage/UsedStorageService.scala` is an `IntervalScheduler`. Its tickerInterval comes from `webKnossos.fetchUsedStorage.tickerInterval` (10 min) and its initial delay is 1 min. Each tick does the following:
- It selects organizations with `OrganizationDAO.findNotRecentlyScanned(rescanInterval=24h, scansPerTick=10)`, which runs `SELECT .. FROM organizations_ WHERE lastStorageScanTime < now-rescan ORDER BY lastStorageScanTime LIMIT n`.
- It selects datastores with `DataStoreDAO.findAllWithStorageReporting`, which reads `dataStores_ WHERE reportUsedStorageEnabled`.
- It handles the organizations serially. For each one it measures every store first (`getNewestStorageReports`, which sends `POST {store}/data/datasets/measureUsedStorage/{org}` in batches of 200 paths). It then runs `deleteUsedStorage(org)` and `upsertUsedStorage`, sets `lastStorageScanTime = now`, and sleeps for 5 s.
- When an organization fails, the error is logged as `Error during storage scan for organization with id X: ...` and the tick continues with the next organization.

## Implementation (src/dataset_storage.rs)
- Shared helpers with no duplicated SQL:
  - `storage_relevant_mags` / `storage_relevant_attachments`: the Scala `findAllStorageRelevant*`, with an optional dataset filter `($3::text IS NULL OR _dataset = $3)`.
  - `newest_storage_reports`: path resolution, the batched RPC, the unknown-path warning, and rejection of negative sizes.
  - `upsert_used_storage`: the Scala upsert SQL.
- `refresh_for_dataset` (existing behaviour unchanged) now uses these helpers. Rows now carry `_dataset`.
- `refresh_for_organization`: measures all reporting stores first. Then, in ONE transaction, it deletes the organization's mag and attachment rows, upserts the new ones, and sets `lastStorageScanTime = Utc::now()`.
- `pub async fn run_scan(&PgPool, &ServiceClients, &UsedStorageConfig) -> Result<JobOutcome, JobError>`:
  - It takes `pg_try_advisory_xact_lock(advisory_lock_key("used-storage-scan"))` (= 6145974474599947089, pinned). The test asserts this key differs from all housekeeping keys and from the credit-ticker key.
  - The lock transaction is held for the whole run, so a run uses 2 pool connections. If another instance holds the lock, the run returns `SkippedLocked`.
  - It selects the due organizations the same way Scala does (bound app-clock `now - rescan`, `LIMIT scans_per_tick`).
  - It selects the reporting stores ordered by name.
  - It logs `Scanning used storage for N organizations in M datastores...` together with the ids and names.
  - For each organization it calls refresh, then pauses on success or logs an error on failure, and continues.
  - The outcome is `Completed("Scanned used storage for N organizations (F failed) in M datastores.")`.
- `pub fn scheduler(pool, clients, &cfg) -> Scheduler` and `pub fn spawn(pool: PgPool, clients: ServiceClients, &UsedStorageConfig) -> SchedulerHandle`. If the job is disabled, the handle is empty.
- Kept Scala quirks:
  - If no store has reporting enabled, due organizations still get their rows cleared and their scan time set.
  - A store with no relevant paths receives no request.
  - Deleted datasets still count, because the `datasets` table is used rather than the view, exactly as in the Scala SQL.
  - Deleted organizations and deleted stores are skipped through the views.

## Config (`WK_USED_STORAGE_*`, .env.example appended)
| key | default | rule |
|---|---|---|
| WK_USED_STORAGE_ENABLED | true (Scala has no switch) | bool |
| WK_USED_STORAGE_TICKER_INTERVAL_SECONDS | 600 | > 0, <= i32::MAX |
| WK_USED_STORAGE_INITIAL_DELAY_SECONDS | 60 | >= 0 |
| WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS | 86400 | >= 0 |
| WK_USED_STORAGE_SCANS_PER_TICK | 10 | >= 0, <= i32::MAX |
| WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS | 5 (hard-coded in Scala) | >= 0 |
Invalid values are reported as config errors, and each message starts with the key.

## Deviations
- The delete, the upsert and the scan-time update are atomic. In Scala they are 3 separate transactions, so a failing upsert there left the rows deleted while the scan time stayed old. In Rust nothing changes and the organization is retried next tick (crate decision D6).
- An organization measured with a negative size counts as failed. In Scala the CHECK violation would fail the upsert after the delete had already run.
- `lastUpdated` is written as SQL `NOW()`, which is the existing per-dataset behaviour. Scala writes the app-clock `Instant.now`.
- A cross-instance advisory lock is new. Scala takes no lock.
- Stores are visited in name order. Scala uses unspecified row order.
- The 5 s pause is a Tokio sleep. In Scala it was a blocking `Thread.sleep`.
- Shutdown lets an in-flight run finish, bounded by the caller's deadline. A full tick can take more than 50 s because of the pauses.

## main.rs wiring (parent-owned, NOT yet applied)
After the credit_ticker spawn:
```rust
    let used_storage_scan = webknossos_backend::dataset_storage::spawn(
        pool.clone(),
        webknossos_backend::service_clients::ServiceClients::new(config.service_client.clone())?,
        &config.used_storage,
    );
```
Before `pool.close().await`, next to the other shutdowns:
```rust
    if tokio::time::timeout(config.shutdown_timeout, used_storage_scan.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Used storage scan did not stop before the shutdown deadline");
    }
```
(`ServiceError` implements std Error, so `?` works in `run()`.) README/main-app-gaps: G7 can be marked done after wiring.

## Evidence (CARGO_TARGET_DIR=/tmp/webknossos-rust-verify-c)
- `cargo test --lib -- dataset_storage`: 6 passed. These cover Scala defaults, overrides, invalid values, the pinned and unique lock key, the disabled job producing no spawn, and the java.nio path resolution.
- `cargo test --test used_storage_scan -- --include-ignored`: 6 passed (3 repeated runs, all stable):
  - Due organizations are scanned oldest first with LIMIT 2, and the exact mag and attachment rows (path resolution, realPath, cross-org dedup, unknown report ignored) are checked. Stale rows are replaced. Non-reporting and deleted stores, organizations that are not due, and deleted organizations are skipped. The next tick picks up the remaining organization, and a third tick finds nothing due.
  - A store failing for one organization, or returning a negative size, leaves that organization's rows and scan time untouched, and the next organization is still scanned.
  - Batches of 200 and 1 paths.
  - Without reporting stores the rows are cleared, as in Scala.
  - Lock held elsewhere: 3 contenders are skipped, and after release 3 parallel runs scan exactly once.
  - The spawned scheduler runs the scan and shuts down.
- Regression (ignored-inclusive): dataset_lifecycle 3, remote_datastore_mag_upload 2, dataset_report 2, attachment_upload 2, dataset_upload 2, dataset_remote 2, remote_datastore_lookup 5, job_submission 3. All pass.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: exit 0. `rustfmt --edition 2024 --check` passes on both owned .rs files.
