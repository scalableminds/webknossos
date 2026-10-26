//! Used storage measurement (Scala `UsedStorageService`).
//!
//! - [`refresh_for_dataset`]: `refreshStorageReportForDataset`, called after dataset uploads and
//!   updates.
//! - [`run_scan`] / [`spawn`]: the periodic organization scan (`UsedStorageService.tick`, an
//!   `IntervalScheduler` with `webKnossos.fetchUsedStorage.*`), configured by
//!   [`UsedStorageConfig`] (`WK_USED_STORAGE_*`).
//!
//! Both share the path resolution, the batched `measureUsedStorage` datastore RPC and the
//! `organization_usedStorage_*` upserts. Cross-instance serialization of the scan follows
//! `housekeeping.rs`: every run holds `pg_try_advisory_xact_lock(advisory_lock_key(JOB_NAME))` in
//! one transaction for its whole duration and is skipped if another instance holds it. The Scala
//! backend takes no lock; a parallel Scala scan only measures the same organizations again.
mod dao;

use crate::util::id::ObjectId;
use std::{collections::HashMap, time::Duration};

use chrono::Utc;
use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgConnection, PgPool};

use crate::{
    background::scheduler::{
        Job, JobError, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    config::{ConfigError, Env},
    error::{ApiError, ApiResult},
    stores::client::{ServiceClients, ServiceError},
};
use dao::{AttachmentRow, MagRow, StoreRow};
use webknossos_common::geometry::Vec3Int;

const MAX_PATHS_PER_REQUEST: usize = 200;

enum Artifact<'a> {
    Mag(&'a MagRow),
    Attachment(&'a AttachmentRow),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathReport {
    path: String,
    used_storage_bytes: i64,
}

#[derive(Deserialize)]
struct PathReports {
    reports: Vec<PathReport>,
}

/// `DatasetMagStorageReport` / `DataLayerAttachmentStorageReport` lists of one measurement.
#[derive(Default)]
struct StorageReports {
    mags: Vec<(MagRow, String, i64)>,
    attachments: Vec<(AttachmentRow, String, i64)>,
}
/// java.nio Path.normalize for '/'-separated relative paths.
fn normalize(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            ".." if absolute => {}
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

/// UPath: no scheme (or a file scheme) is local; local paths without a
/// leading slash are relative.
pub(crate) fn is_local_path(path: &str) -> bool {
    match path.split_once("://") {
        None => true,
        Some((scheme, _)) => scheme.contains("file"),
    }
}

fn mag_paths(mag: &MagRow) -> Vec<String> {
    if let Some(path) = mag.real_path.as_ref().or(mag.path.as_ref()) {
        return vec![path.clone()];
    }
    let layer = normalize(&format!("{}/{}", mag.directory_name, mag.layer_name));
    let vector = [mag.mag_x, mag.mag_y, mag.mag_z];
    let mut paths = vec![
        format!("{layer}/{}", Vec3Int::from(vector).to_mag_literal(true)),
        format!("{layer}/{}", Vec3Int::from(vector).to_mag_literal(false)),
    ];
    paths.dedup();
    paths
}

fn attachment_path(attachment: &AttachmentRow) -> String {
    let path = &attachment.path;
    if !path.contains("://") && !path.starts_with('/') {
        normalize(&format!("{}/{}", attachment.directory_name, path))
    } else {
        path.clone()
    }
}

/// `UsedStorageService.getNewestStorageReports`: resolve the storage relevant paths of the
/// organization (or one dataset) at one datastore and measure them in batches of 200 via
/// `POST {store}/data/datasets/measureUsedStorage/{organization}`. Reports for unknown paths are
/// dropped with a warning; a negative size is rejected (it would violate the table CHECK).
async fn newest_storage_reports(
    pool: &PgPool,
    clients: &ServiceClients,
    organization: &str,
    store: &StoreRow,
    dataset_id: Option<&ObjectId>,
) -> ApiResult<StorageReports> {
    let mags =
        dao::find_all_storage_relevant_mags(pool, organization, &store.name, dataset_id).await?;
    let attachments =
        dao::find_all_storage_relevant_attachments(pool, organization, &store.name, dataset_id)
            .await?;
    let mut lookup: HashMap<String, Artifact> = HashMap::new();
    let mut paths = Vec::new();
    for mag in &mags {
        for path in mag_paths(mag) {
            paths.push(path.clone());
            lookup.insert(path, Artifact::Mag(mag));
        }
    }
    for attachment in &attachments {
        let path = attachment_path(attachment);
        paths.push(path.clone());
        lookup.insert(path, Artifact::Attachment(attachment));
    }
    let mut reports = StorageReports::default();
    for batch in paths.chunks(MAX_PATHS_PER_REQUEST) {
        let response = clients
            .request(
                Method::POST,
                &store.url,
                &["data", "datasets", "measureUsedStorage", organization],
                &[],
                Some(&json!({ "paths": batch })),
            )
            .await?;
        let parsed: PathReports = serde_json::from_slice(&response.bytes)
            .map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
        for report in parsed.reports {
            if report.used_storage_bytes < 0 {
                return Err(ApiError::from(ServiceError::InvalidJson));
            }
            match lookup.get(&report.path) {
                Some(Artifact::Mag(mag)) => {
                    reports
                        .mags
                        .push(((*mag).clone(), report.path, report.used_storage_bytes));
                }
                Some(Artifact::Attachment(attachment)) => reports.attachments.push((
                    (*attachment).clone(),
                    report.path,
                    report.used_storage_bytes,
                )),
                None => tracing::warn!("Storage report for an unknown artifact path was ignored"),
            }
        }
    }
    Ok(reports)
}

/// `OrganizationDAO.upsertUsedStorage`, inside the caller's transaction.
async fn upsert_used_storage(
    connection: &mut PgConnection,
    organization: &str,
    reports: &StorageReports,
) -> Result<(), sqlx::Error> {
    for (mag, path, bytes) in &reports.mags {
        dao::upsert_used_storage_mag(connection, organization, mag, path, *bytes).await?;
    }
    for (attachment, path, bytes) in &reports.attachments {
        dao::upsert_used_storage_attachment(connection, organization, attachment, path, *bytes)
            .await?;
    }
    Ok(())
}

/// Re-measure this dataset's storage at its datastore (if reporting is
/// enabled there) and replace its usedStorage rows in one transaction.
pub(crate) async fn refresh_for_dataset(
    pool: &PgPool,
    clients: &ServiceClients,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    let dataset = dao::find_organization_and_store_name(pool, dataset_id).await?;
    let Some((organization, store_name)) = dataset else {
        return Ok(());
    };
    let store = dao::find_store_for_reporting(pool, &store_name).await?;
    let (name, url, enabled) =
        store.ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
    if !enabled {
        return Ok(());
    }
    let store = StoreRow { name, url };
    let reports =
        newest_storage_reports(pool, clients, &organization, &store, Some(dataset_id)).await?;
    let mut transaction = pool.begin().await?;
    dao::delete_used_storage_mags_for_dataset(&mut transaction, dataset_id).await?;
    dao::delete_used_storage_attachments_for_dataset(&mut transaction, dataset_id).await?;
    upsert_used_storage(&mut transaction, &organization, &reports).await?;
    transaction.commit().await?;
    Ok(())
}

/// `UsedStorageService.refreshStorageReports`: measure the organization at every reporting
/// datastore first (any failure aborts before a write), then atomically replace all of its
/// usedStorage rows and set `lastStorageScanTime` to now.
async fn refresh_for_organization(
    pool: &PgPool,
    clients: &ServiceClients,
    organization: &str,
    stores: &[StoreRow],
) -> ApiResult<()> {
    let mut reports = StorageReports::default();
    for store in stores {
        let store_reports =
            newest_storage_reports(pool, clients, organization, store, None).await?;
        reports.mags.extend(store_reports.mags);
        reports.attachments.extend(store_reports.attachments);
    }
    let mut transaction = pool.begin().await?;
    dao::delete_used_storage_mags_for_organization(&mut transaction, organization).await?;
    dao::delete_used_storage_attachments_for_organization(&mut transaction, organization).await?;
    upsert_used_storage(&mut transaction, organization, &reports).await?;
    dao::update_last_storage_scan_time(&mut transaction, organization, Utc::now()).await?;
    transaction.commit().await?;
    Ok(())
}

/// One tick of the organization scan (Scala `UsedStorageService.tick`): under the job's advisory
/// lock (skip if another instance holds it), select at most `scans_per_tick` organizations whose
/// last scan is older than `rescan_interval`, oldest first (`OrganizationDAO.findNotRecentlyScanned`),
/// and refresh them one after another at all datastores with `reportUsedStorageEnabled`. A failing
/// organization is logged and keeps its old rows and scan time; the tick continues. After each
/// successful organization the run pauses `pause_after_each_organization`.
pub async fn run_scan(
    pool: &PgPool,
    clients: &ServiceClients,
    config: &UsedStorageConfig,
) -> Result<JobOutcome, JobError> {
    let mut lock = pool.begin().await?;
    if !try_advisory_xact_lock(&mut lock, advisory_lock_key(JOB_NAME)).await? {
        lock.rollback().await?;
        return Ok(JobOutcome::SkippedLocked);
    }
    let rescan = chrono::Duration::from_std(config.rescan_interval)?;
    let organizations =
        dao::find_not_recently_scanned(pool, Utc::now() - rescan, i64::from(config.scans_per_tick))
            .await?;
    let stores = dao::find_all_with_storage_reporting(pool).await?;
    tracing::info!(
        organizations = ?organizations,
        data_stores = ?stores.iter().map(|store| store.name.as_str()).collect::<Vec<_>>(),
        "Scanning used storage for {} organizations in {} datastores...",
        organizations.len(),
        stores.len()
    );
    let mut failed = 0;
    for organization in &organizations {
        match refresh_for_organization(pool, clients, organization, &stores).await {
            Ok(()) => tokio::time::sleep(config.pause_after_each_organization).await,
            Err(error) => {
                failed += 1;
                tracing::error!(
                    organization = %organization,
                    %error,
                    "Error during storage scan for organization with id {organization}: {error}"
                );
            }
        }
    }
    lock.commit().await?;
    Ok(JobOutcome::Completed(format!(
        "Scanned used storage for {} organizations ({failed} failed) in {} datastores.",
        organizations.len(),
        stores.len()
    )))
}

/// Scheduler with the scan job registered (also when disabled, so that is logged).
pub fn scheduler(pool: PgPool, clients: ServiceClients, config: &UsedStorageConfig) -> Scheduler {
    let mut scheduler = Scheduler::new();
    let job_config = config.clone();
    scheduler.add(Job::new(JOB_NAME, config.schedule, move || {
        let pool = pool.clone();
        let clients = clients.clone();
        let config = job_config.clone();
        async move { run_scan(&pool, &clients, &config).await }
    }));
    scheduler
}

/// Starts the periodic organization scan on the current runtime. Call
/// [`SchedulerHandle::shutdown`] before closing the pool.
pub fn spawn(pool: PgPool, clients: ServiceClients, config: &UsedStorageConfig) -> SchedulerHandle {
    scheduler(pool, clients, config).spawn()
}

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "used-storage-scan";
/// Scala `webKnossos.fetchUsedStorage.tickerInterval`.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(10 * 60);
/// Scala `UsedStorageService.tickerInitialDelay`.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(60);
/// Scala `webKnossos.fetchUsedStorage.rescanInterval`.
pub const DEFAULT_RESCAN_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// Scala `webKnossos.fetchUsedStorage.scansPerTick`.
pub const DEFAULT_SCANS_PER_TICK: u32 = 10;
/// Scala `UsedStorageService.pauseAfterEachOrganization` (hard-coded there).
pub const DEFAULT_PAUSE_AFTER_EACH_ORGANIZATION: Duration = Duration::from_secs(5);

/// `WK_USED_STORAGE_*` settings of the periodic organization scan (Scala
/// `webKnossos.fetchUsedStorage.*`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsedStorageConfig {
    pub schedule: JobSchedule,
    /// Organizations whose last scan is more recent than this are not scanned.
    pub rescan_interval: Duration,
    /// At most this many organizations per tick, oldest scan first.
    pub scans_per_tick: u32,
    pub pause_after_each_organization: Duration,
}

impl Default for UsedStorageConfig {
    /// Scala defaults: enabled, every 10 minutes after a 1 minute initial delay, rescan after
    /// 24 hours, 10 organizations per tick, 5 seconds pause after each organization.
    fn default() -> Self {
        Self {
            schedule: JobSchedule {
                enabled: true,
                interval: DEFAULT_INTERVAL,
                initial_delay: DEFAULT_INITIAL_DELAY,
            },
            rescan_interval: DEFAULT_RESCAN_INTERVAL,
            scans_per_tick: DEFAULT_SCANS_PER_TICK,
            pause_after_each_organization: DEFAULT_PAUSE_AFTER_EACH_ORGANIZATION,
        }
    }
}

/// Parses used-storage scan settings from environment values (called by config.rs).
///
/// - `WK_USED_STORAGE_ENABLED` (default `true`; Scala has no switch, the ticker always runs and
///   only scans datastores with `reportUsedStorageEnabled`).
/// - `WK_USED_STORAGE_TICKER_INTERVAL_SECONDS` (> 0, default 600).
/// - `WK_USED_STORAGE_INITIAL_DELAY_SECONDS` (>= 0, default 60).
/// - `WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS` (>= 0, default 86400).
/// - `WK_USED_STORAGE_SCANS_PER_TICK` (>= 0, default 10).
/// - `WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS` (>= 0, default 5).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<UsedStorageConfig, ConfigError> {
    let env = Env::new(values);
    let seconds = |name: &str, allow_zero: bool, default: Duration| {
        env.seconds(name, allow_zero)
            .map(|value| value.unwrap_or(default))
    };
    let scans_per_tick = match env.unsigned("WK_USED_STORAGE_SCANS_PER_TICK")? {
        None => DEFAULT_SCANS_PER_TICK,
        Some(scans) if scans <= i32::MAX as u64 => scans as u32,
        Some(_) => {
            return Err(ConfigError(
                "WK_USED_STORAGE_SCANS_PER_TICK exceeds the supported range".into(),
            ));
        }
    };
    Ok(UsedStorageConfig {
        schedule: JobSchedule {
            enabled: env.bool_or("WK_USED_STORAGE_ENABLED", true)?,
            interval: seconds(
                "WK_USED_STORAGE_TICKER_INTERVAL_SECONDS",
                false,
                DEFAULT_INTERVAL,
            )?,
            initial_delay: seconds(
                "WK_USED_STORAGE_INITIAL_DELAY_SECONDS",
                true,
                DEFAULT_INITIAL_DELAY,
            )?,
        },
        rescan_interval: seconds(
            "WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS",
            true,
            DEFAULT_RESCAN_INTERVAL,
        )?,
        scans_per_tick,
        pause_after_each_organization: seconds(
            "WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS",
            true,
            DEFAULT_PAUSE_AFTER_EACH_ORGANIZATION,
        )?,
    })
}

#[cfg(test)]
mod tests;
