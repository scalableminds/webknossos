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
use std::{collections::HashMap, time::Duration};

use chrono::Utc;
use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgConnection, PgPool};

use crate::{
    error::{ApiError, ApiResult},
    scheduler::{
        Job, JobError, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    service_clients::{ServiceClients, ServiceError},
};

const MAX_PATHS_PER_REQUEST: usize = 200;

#[derive(Clone, sqlx::FromRow)]
struct MagRow {
    dataset_id: String,
    layer_name: String,
    mag_x: i32,
    mag_y: i32,
    mag_z: i32,
    path: Option<String>,
    real_path: Option<String>,
    directory_name: String,
}

#[derive(Clone, sqlx::FromRow)]
struct AttachmentRow {
    dataset_id: String,
    layer_name: String,
    name: String,
    path: String,
    typ: String,
    directory_name: String,
}

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

/// One datastore with `reportUsedStorageEnabled` (`DataStoreDAO.findAllWithStorageReporting`).
#[derive(Clone, Debug, sqlx::FromRow)]
struct StoreRow {
    name: String,
    url: String,
}

/// `DatasetMagStorageReport` / `DataLayerAttachmentStorageReport` lists of one measurement.
#[derive(Default)]
struct StorageReports {
    mags: Vec<(MagRow, String, i64)>,
    attachments: Vec<(AttachmentRow, String, i64)>,
}
fn mag_literal(mag: [i32; 3], allow_scalar: bool) -> String {
    if allow_scalar && mag[0] == mag[1] && mag[1] == mag[2] {
        mag[0].to_string()
    } else {
        format!("{}-{}-{}", mag[0], mag[1], mag[2])
    }
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
        format!("{layer}/{}", mag_literal(vector, true)),
        format!("{layer}/{}", mag_literal(vector, false)),
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

/// `DatasetMagDAO.findAllStorageRelevantMags` (optionally for one dataset).
async fn storage_relevant_mags(
    pool: &PgPool,
    organization: &str,
    store_name: &str,
    dataset_id: Option<&str>,
) -> Result<Vec<MagRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT mag._dataset AS dataset_id, mag.dataLayerName AS layer_name, (mag.mag).x::int AS mag_x,
             (mag.mag).y::int AS mag_y, (mag.mag).z::int AS mag_z, mag.path, mag.realPath AS real_path,
             ds.directoryName AS directory_name
           FROM webknossos.dataset_mags AS mag JOIN webknossos.datasets AS ds ON mag._dataset = ds._id
           WHERE ds._organization = $1 AND ds._dataStore = $2 AND ($3::text IS NULL OR mag._dataset = $3)
             AND (mag.path IS NOT NULL OR mag.realPath IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM webknossos.dataset_mags AS mag2 JOIN webknossos.datasets AS ds2 ON mag2._dataset = ds2._id
               WHERE COALESCE(mag2.realPath, mag2.path) = COALESCE(mag.realPath, mag.path)
                 AND (ds2.created < ds.created OR (ds2.created = ds.created AND ds2._id < ds._id)))"#,
    )
    .bind(organization)
    .bind(store_name)
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// `DatasetLayerAttachmentDAO.findAllStorageRelevantAttachments` (optionally for one dataset).
async fn storage_relevant_attachments(
    pool: &PgPool,
    organization: &str,
    store_name: &str,
    dataset_id: Option<&str>,
) -> Result<Vec<AttachmentRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT att._dataset AS dataset_id, att.layerName AS layer_name, att.name, att.path, att.type::text AS typ,
             ds.directoryName AS directory_name
           FROM webknossos.dataset_layer_attachments AS att JOIN webknossos.datasets AS ds ON att._dataset = ds._id
           WHERE ds._organization = $1 AND ds._dataStore = $2 AND ($3::text IS NULL OR att._dataset = $3)
             AND NOT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments AS att2 JOIN webknossos.datasets AS ds2 ON att2._dataset = ds2._id
               WHERE COALESCE(att2.realPath, att2.path) = COALESCE(att.realPath, att.path)
                 AND (ds2.created < ds.created OR (ds2.created = ds.created AND ds2._id < ds._id)))"#,
    )
    .bind(organization)
    .bind(store_name)
    .bind(dataset_id)
    .fetch_all(pool)
    .await
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
    dataset_id: Option<&str>,
) -> ApiResult<StorageReports> {
    let mags = storage_relevant_mags(pool, organization, &store.name, dataset_id).await?;
    let attachments =
        storage_relevant_attachments(pool, organization, &store.name, dataset_id).await?;
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
        sqlx::query(
            r#"INSERT INTO webknossos.organization_usedStorage_mags (_dataset, layerName, mag, path, _organization, usedStorageBytes, lastUpdated)
               VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, $6, $7, $8, NOW())
               ON CONFLICT (_dataset, layerName, mag) DO UPDATE SET path = EXCLUDED.path, _organization = EXCLUDED._organization,
                 usedStorageBytes = EXCLUDED.usedStorageBytes, lastUpdated = EXCLUDED.lastUpdated"#,
        )
        .bind(&mag.dataset_id)
        .bind(&mag.layer_name)
        .bind(f64::from(mag.mag_x))
        .bind(f64::from(mag.mag_y))
        .bind(f64::from(mag.mag_z))
        .bind(path)
        .bind(organization)
        .bind(bytes)
        .execute(&mut *connection)
        .await?;
    }
    for (attachment, path, bytes) in &reports.attachments {
        sqlx::query(
            r#"INSERT INTO webknossos.organization_usedStorage_attachments (_dataset, layerName, name, path, type, _organization, usedStorageBytes, lastUpdated)
               VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6, $7, NOW())
               ON CONFLICT (_dataset, layerName, name, type) DO UPDATE SET path = EXCLUDED.path, _organization = EXCLUDED._organization,
                 usedStorageBytes = EXCLUDED.usedStorageBytes, lastUpdated = EXCLUDED.lastUpdated"#,
        )
        .bind(&attachment.dataset_id)
        .bind(&attachment.layer_name)
        .bind(&attachment.name)
        .bind(path)
        .bind(&attachment.typ)
        .bind(organization)
        .bind(bytes)
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

/// Re-measure this dataset's storage at its datastore (if reporting is
/// enabled there) and replace its usedStorage rows in one transaction.
pub(crate) async fn refresh_for_dataset(
    pool: &PgPool,
    clients: &ServiceClients,
    dataset_id: &str,
) -> ApiResult<()> {
    let dataset: Option<(String, String)> =
        sqlx::query_as("SELECT _organization, _dataStore FROM webknossos.datasets WHERE _id=$1")
            .bind(dataset_id)
            .fetch_optional(pool)
            .await?;
    let Some((organization, store_name)) = dataset else {
        return Ok(());
    };
    let store: Option<(String, String, bool)> = sqlx::query_as(
        "SELECT name, url, reportUsedStorageEnabled FROM webknossos.dataStores_ WHERE name=trim($1)",
    )
    .bind(&store_name)
    .fetch_optional(pool)
    .await?;
    let (name, url, enabled) =
        store.ok_or_else(|| ApiError::bad_request("Data store could not be found or accessed."))?;
    if !enabled {
        return Ok(());
    }
    let store = StoreRow { name, url };
    let reports =
        newest_storage_reports(pool, clients, &organization, &store, Some(dataset_id)).await?;
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM webknossos.organization_usedStorage_mags WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM webknossos.organization_usedStorage_attachments WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(&mut *transaction)
        .await?;
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
    sqlx::query("DELETE FROM webknossos.organization_usedStorage_mags WHERE _organization = $1")
        .bind(organization)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "DELETE FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1",
    )
    .bind(organization)
    .execute(&mut *transaction)
    .await?;
    upsert_used_storage(&mut transaction, organization, &reports).await?;
    sqlx::query("UPDATE webknossos.organizations SET lastStorageScanTime = $1 WHERE _id = $2")
        .bind(Utc::now())
        .bind(organization)
        .execute(&mut *transaction)
        .await?;
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
    let organizations: Vec<String> = sqlx::query_scalar(
        "SELECT _id FROM webknossos.organizations_ WHERE lastStorageScanTime < $1 \
         ORDER BY lastStorageScanTime LIMIT $2",
    )
    .bind(Utc::now() - rescan)
    .bind(i64::from(config.scans_per_tick))
    .fetch_all(pool)
    .await?;
    let stores: Vec<StoreRow> = sqlx::query_as(
        "SELECT name, url FROM webknossos.dataStores_ WHERE reportUsedStorageEnabled ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
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
/// Largest accepted duration / count (same bound as housekeeping and the credit ticker).
const MAX_VALUE: u64 = i32::MAX as u64;

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
pub fn config_from_values(values: &HashMap<String, String>) -> Result<UsedStorageConfig, String> {
    let number = |name: &str, allow_zero: bool| -> Result<Option<u64>, String> {
        let Some(value) = values.get(name) else {
            return Ok(None);
        };
        let number: u64 = value
            .parse()
            .map_err(|_| format!("{name} must be an unsigned integer"))?;
        if number == 0 && !allow_zero {
            return Err(format!("{name} must be greater than zero"));
        }
        if number > MAX_VALUE {
            return Err(format!("{name} exceeds the supported range"));
        }
        Ok(Some(number))
    };
    let seconds = |name: &str, allow_zero: bool, default: Duration| {
        number(name, allow_zero).map(|value| value.map_or(default, Duration::from_secs))
    };
    let enabled = values
        .get("WK_USED_STORAGE_ENABLED")
        .map(|value| {
            value
                .parse()
                .map_err(|_| "WK_USED_STORAGE_ENABLED must be true or false".to_owned())
        })
        .transpose()?
        .unwrap_or(true);
    Ok(UsedStorageConfig {
        schedule: JobSchedule {
            enabled,
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
        scans_per_tick: number("WK_USED_STORAGE_SCANS_PER_TICK", true)?
            .map_or(DEFAULT_SCANS_PER_TICK, |value| value as u32),
        pause_after_each_organization: seconds(
            "WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS",
            true,
            DEFAULT_PAUSE_AFTER_EACH_ORGANIZATION,
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_resolve_like_java_nio() {
        assert_eq!(normalize("ds/./a/../mesh.hdf5"), "ds/mesh.hdf5");
        assert_eq!(normalize("ds/../../x"), "../x");
        assert!(is_local_path("/srv/a") && is_local_path("file:///srv/a"));
        assert!(!is_local_path("s3://bucket/a"));
        let mag = MagRow {
            dataset_id: "0123456789abcdef01234567".into(),
            layer_name: "color".into(),
            mag_x: 2,
            mag_y: 2,
            mag_z: 2,
            path: None,
            real_path: None,
            directory_name: "ds".into(),
        };
        assert_eq!(mag_paths(&mag), ["ds/color/2", "ds/color/2-2-2"]);
    }

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect()
    }

    #[test]
    fn config_defaults_match_scala() {
        let config = config_from_values(&HashMap::new()).unwrap();
        assert_eq!(config, UsedStorageConfig::default());
        assert!(config.schedule.enabled);
        assert_eq!(config.schedule.interval, Duration::from_secs(600));
        assert_eq!(config.schedule.initial_delay, Duration::from_secs(60));
        assert_eq!(config.rescan_interval, Duration::from_secs(86_400));
        assert_eq!(config.scans_per_tick, 10);
        assert_eq!(config.pause_after_each_organization, Duration::from_secs(5));
    }

    #[test]
    fn config_overrides() {
        let config = config_from_values(&values(&[
            ("WK_USED_STORAGE_ENABLED", "false"),
            ("WK_USED_STORAGE_TICKER_INTERVAL_SECONDS", "30"),
            ("WK_USED_STORAGE_INITIAL_DELAY_SECONDS", "0"),
            ("WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS", "3600"),
            ("WK_USED_STORAGE_SCANS_PER_TICK", "0"),
            ("WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS", "0"),
        ]))
        .unwrap();
        assert_eq!(
            config,
            UsedStorageConfig {
                schedule: JobSchedule {
                    enabled: false,
                    interval: Duration::from_secs(30),
                    initial_delay: Duration::ZERO,
                },
                rescan_interval: Duration::from_secs(3600),
                scans_per_tick: 0,
                pause_after_each_organization: Duration::ZERO,
            }
        );
    }

    #[test]
    fn config_rejects_invalid_values() {
        for (key, value) in [
            ("WK_USED_STORAGE_ENABLED", "yes"),
            ("WK_USED_STORAGE_TICKER_INTERVAL_SECONDS", "0"),
            ("WK_USED_STORAGE_TICKER_INTERVAL_SECONDS", "2147483648"),
            ("WK_USED_STORAGE_INITIAL_DELAY_SECONDS", "-1"),
            ("WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS", "1d"),
            ("WK_USED_STORAGE_SCANS_PER_TICK", "-5"),
            ("WK_USED_STORAGE_SCANS_PER_TICK", "2147483648"),
            ("WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS", "x"),
        ] {
            let error = config_from_values(&values(&[(key, value)])).unwrap_err();
            assert!(error.starts_with(key), "{error}");
        }
    }

    #[test]
    fn lock_key_is_pinned_and_unique() {
        assert_eq!(advisory_lock_key(JOB_NAME), 6_145_974_474_599_947_089);
        let mut keys: Vec<i64> = crate::housekeeping::HousekeepingJob::ALL
            .iter()
            .map(|job| job.advisory_lock_key())
            .collect();
        keys.push(advisory_lock_key(crate::credit_ticker::JOB_NAME));
        assert!(!keys.contains(&advisory_lock_key(JOB_NAME)));
    }

    #[tokio::test]
    async fn disabled_scan_spawns_no_job() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://unused@127.0.0.1:1/unused")
            .unwrap();
        let clients =
            ServiceClients::new(crate::service_clients::ServiceClientConfig::default()).unwrap();
        let mut config = UsedStorageConfig::default();
        config.schedule.enabled = false;
        let handle = spawn(pool, clients, &config);
        assert!(handle.job_names().is_empty());
        handle.shutdown().await;
    }
}
