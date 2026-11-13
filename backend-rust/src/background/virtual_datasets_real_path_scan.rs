//! Virtual-dataset real-path scan: Scala `VirtualDatasetsRealPathScanService`
//! (`app/models/dataset/VirtualDatasetsRealPathScanService.scala`, an `IntervalScheduler` with
//! interval 1 h, the default initial delay of 10 s and no config switch).
//!
//! Every tick loads all virtual datasets (`DatasetDAO.findAll` under the global access context, so
//! the non-deleted `datasets_` view, filtered by `isVirtual`), groups them by `_dataStore` and, per
//! datastore:
//! - builds the `DataSourceWithRootPathInfo` of every usable dataset with its stored (not resolved)
//!   paths (`usableDataSourceFor(useRealPaths = false)`); unusable datasets and datasets whose data
//!   source cannot be built are skipped;
//! - keeps only data sources with at least one local explicit mag/attachment path
//!   (`WKRemoteDataStoreClient.scanRealPathsForVirtual`);
//! - sends them in one `POST {datastore}/data/triggers/scanRealPathsForVirtual?token=..`, or
//!   nothing if none is left.
//!
//! The datastore answers asynchronously via `PUT /api/datastores/:name/datasources/realpaths`
//! (`remote::datastore`). The per-dataset variant on create/update/report is
//! `dataset::lifecycle::scan_realpaths_if_virtual`; both share the request building.
//!
//! Cross-instance serialization follows `organization::storage::run_scan` (the other job with
//! datastore RPCs): a tick holds one transaction with
//! `pg_try_advisory_xact_lock(advisory_lock_key("virtual-datasets-real-path-scan"))` for the
//! whole run and is skipped while another instance holds it. Each RPC is bounded by the service
//! client's request timeout, so the lock is held at most (datastores x timeout). Play takes no lock;
//! a parallel Play scan only means the datastore scans the same paths twice.
//!
//! Deviation: Scala visits the datastores with `Fox.serialCombined`, so the first failing
//! datastore (unknown/deleted datastore, unreachable, error status) aborts the tick and the
//! remaining datastores (in unspecified map order) are not scanned until the next hour. Here a
//! failing datastore is logged and the others are still scanned, in datastore name order.

use std::{collections::BTreeMap, collections::HashMap, time::Duration};

use sqlx::PgPool;

use crate::{
    background::scheduler::{
        Job, JobError, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    config::{ConfigError, Env},
    dataset::lifecycle::{
        DatasetRecord, find_all_virtual_records, real_path_scan_info, scan_real_paths_for_virtual,
    },
    error::ApiError,
    stores::client::ServiceClients,
};

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "virtual-datasets-real-path-scan";
/// Scala `VirtualDatasetsRealPathScanService.tickerInterval`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// Scala `IntervalScheduler.tickerInitialDelay` default.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(10);

/// `WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_*` settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VirtualDatasetsRealPathScanConfig {
    pub schedule: JobSchedule,
}

impl Default for VirtualDatasetsRealPathScanConfig {
    /// Scala defaults: enabled, every hour, first run after 10 seconds.
    fn default() -> Self {
        Self {
            schedule: JobSchedule {
                enabled: true,
                interval: DEFAULT_INTERVAL,
                initial_delay: DEFAULT_INITIAL_DELAY,
            },
        }
    }
}

/// Parses settings from environment values (called by config.rs).
///
/// - `WK_VIRTUAL_DATASETS_REAL_PATH_SCAN_ENABLED` (default `true`; Scala has no switch).
///
/// Interval (1 h) and initial delay (10 s) are fixed, as in `VirtualDatasetsRealPathScanService`.
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<VirtualDatasetsRealPathScanConfig, ConfigError> {
    let env = Env::new(values);
    let defaults = VirtualDatasetsRealPathScanConfig::default();
    Ok(VirtualDatasetsRealPathScanConfig {
        schedule: defaults
            .schedule
            .with_enabled_from_env(env, "WK_VIRTUAL_DATASETS_REAL_PATH_SCAN")?,
    })
}

/// `datasets.filter(_.isVirtual).groupBy(_._dataStore)`, keyed by datastore name (sorted).
pub(crate) fn group_by_data_store(
    records: Vec<DatasetRecord>,
) -> BTreeMap<String, Vec<DatasetRecord>> {
    let mut groups: BTreeMap<String, Vec<DatasetRecord>> = BTreeMap::new();
    for record in records.into_iter().filter(|record| record.is_virtual) {
        groups
            .entry(record.store_name.clone().unwrap_or_default())
            .or_default()
            .push(record);
    }
    groups
}

/// One tick: advisory lock (skip if held elsewhere), load and group the virtual datasets, scan
/// every datastore (failures are logged and do not stop the others), commit.
pub async fn run_scan(pool: &PgPool, clients: &ServiceClients) -> Result<JobOutcome, JobError> {
    let mut lock = pool.begin().await?;
    if !try_advisory_xact_lock(&mut lock, advisory_lock_key(JOB_NAME)).await? {
        lock.rollback().await?;
        return Ok(JobOutcome::SkippedLocked);
    }
    tracing::info!("Scanning realpaths for all virtual datasets...");
    let groups = group_by_data_store(find_all_virtual_records(&mut *lock).await?);
    let mut sent = 0;
    let mut failed = 0;
    for (data_store, datasets) in &groups {
        match scan_data_store(pool, clients, datasets).await {
            Ok(count) => sent += count,
            Err(error) => {
                failed += 1;
                tracing::error!(
                    data_store = %data_store,
                    error = %error.message,
                    status = %error.status,
                    "Could not scan realpaths of virtual datasets on datastore {data_store}: {}",
                    error.message
                );
            }
        }
    }
    lock.commit().await?;
    Ok(JobOutcome::Completed(format!(
        "Sent {sent} virtual data sources for realpath scanning to {} datastores ({failed} failed).",
        groups.len()
    )))
}

/// `scanRealPathsForDatasetsOfDataStore`: returns the number of data sources sent.
async fn scan_data_store(
    pool: &PgPool,
    clients: &ServiceClients,
    datasets: &[DatasetRecord],
) -> Result<usize, ApiError> {
    let Some(first) = datasets.first() else {
        return Ok(0);
    };
    let mut infos = Vec::new();
    for dataset in datasets {
        // Scala `Fox.serialSequence(..).flatten`: a dataset whose data source fails is skipped.
        match real_path_scan_info(pool, dataset).await {
            Ok(Some(info)) => infos.push(info),
            Ok(None) => {}
            Err(error) => tracing::warn!(
                dataset = %dataset.id,
                error = %error.message,
                "Skipping dataset {} in the virtual dataset realpath scan: {}",
                dataset.id,
                error.message
            ),
        }
    }
    // `datasetService.clientFor(firstDataset)` fails for an unknown datastore even if nothing is
    // sent.
    let store_url = first.store_url()?;
    scan_real_paths_for_virtual(clients, store_url, &infos).await?;
    Ok(infos.len())
}

/// Scheduler with the scan job registered (also when disabled, so that is logged).
pub fn scheduler(
    pool: PgPool,
    clients: ServiceClients,
    config: &VirtualDatasetsRealPathScanConfig,
) -> Scheduler {
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new(JOB_NAME, config.schedule, move || {
        let pool = pool.clone();
        let clients = clients.clone();
        async move { run_scan(&pool, &clients).await }
    }));
    scheduler
}

/// Starts the scan on the current runtime. Call [`SchedulerHandle::shutdown`] before closing the
/// pool.
pub fn spawn(
    pool: PgPool,
    clients: ServiceClients,
    config: &VirtualDatasetsRealPathScanConfig,
) -> SchedulerHandle {
    scheduler(pool, clients, config).spawn()
}

#[cfg(test)]
mod background_virtual_datasets_real_path_scan_tests;
