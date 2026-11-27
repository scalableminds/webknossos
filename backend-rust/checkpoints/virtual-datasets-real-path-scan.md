# Virtual-dataset realpath scan (G10) checkpoint

Status: DONE (2026-11-03). Wired in `src/main.rs` (spawn + shutdown) and `Config.virtual_datasets_real_path_scan`.

## Scala truth
- `app/models/dataset/VirtualDatasetsRealPathScanService.scala` (IntervalScheduler: interval 1 h, default initial
  delay 10 s, always on, no `application.conf` keys). Tick: `datasetDAO.findAll` (global access, `datasets_` view,
  so non-deleted) -> `filter(_.isVirtual).groupBy(_._dataStore)` -> `Fox.serialCombined` over the datastores.
- Per datastore: `usableDataSourceFor(d, useRealPaths = false)` for every dataset (unusable / failing ones skipped
  via `serialSequence(..).flatten`), `DataSourceWithRootPathInfo(ds, rootPath, rootRealPath)`, `clientFor(first)`,
  then `WKRemoteDataStoreClient.scanRealPathsForVirtual` (`WKRemoteDataStoreClient.scala:196`): keep data sources with
  at least one local explicit mag/attachment path; if any, `POST {url}/data/triggers/scanRealPathsForVirtual?token=`
  with the JSON array (default RPC timeout). The datastore answers via `PUT /api/datastores/:name/datasources/realpaths`.

## Implementation
- `src/dataset/lifecycle.rs`: `scan_realpaths_if_virtual` split into `real_path_scan_info` (usable+virtual check,
  `data_source_for_rpc(.., false)`), the pure `real_path_scan_info_for` (local-path filter + root info JSON) and
  `scan_real_paths_for_virtual(clients, store_url, infos)` (no request for an empty list). Per-dataset behaviour
  unchanged. `dataset_lifecycle_dao::find_all_virtual_records`: `datasets_ WHERE isVirtual` LEFT JOIN `dataStores_`,
  `store_name = trim(_dataStore)` so datasets of a deleted datastore still form a group (with `store_url = NULL`).
- `src/background/virtual_datasets_real_path_scan.rs`: config, `group_by_data_store` (BTreeMap, name order),
  `run_scan(pool, clients)`, `scheduler`, `spawn`. One transaction holds
  `pg_try_advisory_xact_lock(advisory_lock_key("virtual-datasets-real-path-scan"))` (= -3001348398396176784) for the
  whole run, like `organization::storage::run_scan`; RPCs are bounded by the service client timeout (30 s default).
  Outcome: `Sent N virtual data sources for realpath scanning to M datastores (F failed).`

## Config
| key | default | rule |
|---|---|---|
| WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_ENABLED | true (Scala has no switch) | bool |

Interval (1 h) and initial delay (10 s) are fixed, as Play hard-codes them.

## Deviations
- A failing datastore (unknown/soft-deleted datastore, unreachable, non-2xx) is logged and the remaining datastores
  are still scanned. Scala's `Fox.serialCombined` aborts the tick at the first failure, so later datastores (in
  unspecified HashMap order) waited for the next hour.
- Datastores are visited in name order (Scala: unspecified map order).
- Per-dataset data source failures are logged at warn (Scala drops them silently).
- Cross-instance advisory lock is new; Play takes none (a parallel Play scan only repeats the datastore's scan).

## Tests
- Unit (`background_virtual_datasets_real_path_scan_tests.rs`): defaults, env parsing/errors, pinned unique lock key,
  grouping, local-path filter, `DataSourceWithRootPathInfo` JSON.
- Integration (`tests/virtual_datasets_real_path_scan.rs`): five mock datastores (OK, 500, soft-deleted, OK,
  remote-only); asserts the exact requests, exclusions (remote-only, unusable, deleted, non-virtual), continuation
  after the failures, and `SkippedLocked` while another connection holds the lock.
