//! DataSourceService inbox scans and real-path reports; file work runs on the blocking pool.
use super::{BaseDirService, DataSourceService};
use crate::{
    config::WatchFileSystemConfig,
    error::{DsError, DsResult},
    models::{DataSourcePathInfo, DataSourceWithRootPathInfo, RealPathInfo, UPath},
    wk_client::WkClient,
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct DataSourceScanner {
    bases: BaseDirService,
    sources: DataSourceService,
    client: WkClient,
}
pub struct ScanSnapshot {
    pub sources: Vec<DataSourceWithRootPathInfo>,
    pub real_paths: Vec<DataSourcePathInfo>,
    pub failures: Vec<DsError>,
}
impl DataSourceScanner {
    pub fn new(bases: BaseDirService, sources: DataSourceService, client: WkClient) -> Self {
        Self {
            bases,
            sources,
            client,
        }
    }

    pub fn scan_snapshot(&self, org: Option<&str>, verbose: bool) -> DsResult<ScanSnapshot> {
        let dirs = self
            .organization_dirs(org)
            .map_err(|e| e.wrap("Could not determine base directories to scan from config."))?;
        if verbose {
            tracing::info!(organizations = dirs.len(), "Scanning base directories");
        }
        let mut seen = HashSet::new();
        let mut sources = Vec::new();
        for (path, organization) in dirs {
            let datasets = match list_directories(&path) {
                Ok(dirs) => dirs,
                Err(e) => {
                    tracing::error!(organization,error=%e,"Failed to list organization directories");
                    continue;
                }
            };
            if datasets.is_empty() && verbose && org.is_none() {
                tracing::warn!(organization, "Empty organization dataset directory");
            }
            for dir in datasets {
                let source = self.sources.data_source_from_dir(&dir, &organization, true);
                if !seen.insert(source.id().clone()) {
                    if verbose {
                        tracing::warn!(source=%source.id(),"Conflicting datasource id; keeping first configured directory");
                    }
                    continue;
                }
                let real = std::fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
                sources.push(DataSourceWithRootPathInfo {
                    data_source: source,
                    root_path: Some(dir.to_string_lossy().into_owned()),
                    root_real_path: Some(real.to_string_lossy().into_owned()),
                });
            }
        }
        let (real_paths, failures) = scan_real_paths(&sources);
        Ok(ScanSnapshot {
            sources,
            real_paths,
            failures,
        })
    }

    fn organization_dirs(&self, selected: Option<&str>) -> DsResult<Vec<(PathBuf, String)>> {
        let configured = self.bases.local_dirs(None, true);
        let mut dirs: Vec<_> = configured
            .iter()
            .filter_map(|(p, o)| {
                o.as_ref()
                    .filter(|o| selected.is_none_or(|s| o.as_str() == s))
                    .map(|o| (p.clone(), o.clone()))
            })
            .collect();
        for (base, org) in configured {
            if org.is_none() {
                for dir in list_directories(&base)? {
                    let org = dir
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned();
                    if selected.is_none_or(|s| org == s) {
                        dirs.push((dir, org));
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        dirs.retain(|d| seen.insert(d.clone()));
        Ok(dirs)
    }

    pub async fn scan_base_directories(&self, org: Option<&str>, verbose: bool) -> DsResult<()> {
        let before = Instant::now();
        let scanner = self.clone();
        let organization = org.map(str::to_owned);
        let snapshot = tokio::task::spawn_blocking(move || {
            scanner.scan_snapshot(organization.as_deref(), verbose)
        })
        .await
        .map_err(DsError::from_exception)??;
        self.client
            .report_data_sources(&snapshot.sources, org)
            .await?;
        self.client.report_real_paths(&snapshot.real_paths).await?;
        log_path_failures(&snapshot.failures, verbose);
        tracing::info!(sources=snapshot.sources.len(),active=snapshot.sources.iter().filter(|s|s.data_source.is_usable()).count(),
            real_path_sources=snapshot.real_paths.len(),failures=snapshot.failures.len(),elapsed=?before.elapsed(),
            "Finished scanning base directories");
        Ok(())
    }

    pub async fn scan_real_paths_for_virtual(
        &self,
        sources: Vec<DataSourceWithRootPathInfo>,
    ) -> DsResult<()> {
        let (paths, failures) = tokio::task::spawn_blocking(move || scan_real_paths(&sources))
            .await
            .map_err(DsError::from_exception)?;
        self.client.report_real_paths(&paths).await?;
        log_path_failures(&failures, true);
        Ok(())
    }

    pub fn spawn_watcher(
        &self,
        config: &WatchFileSystemConfig,
    ) -> DsResult<Option<tokio::task::JoinHandle<()>>> {
        if !config.enabled {
            return Ok(None);
        }
        if config.interval < Duration::from_millis(100) {
            return Err(DsError::failure(format!(
                "IntervalScheduler was initialized with interval {:?}. Only intervals larger than the inner ticker interval 100ms are supported.",
                config.interval
            )));
        }
        Ok(Some(tokio::spawn(
            self.clone()
                .watcher_loop(config.initial_delay, config.interval),
        )))
    }

    /// Completion-based scheduling: at most one watcher scan; failures retry next interval.
    pub async fn watcher_loop(self, initial_delay: Duration, interval: Duration) {
        tokio::time::sleep(initial_delay).await;
        let mut completed = 0;
        loop {
            match self.scan_base_directories(None, completed == 0).await {
                Ok(()) => completed = (completed + 1) % 10,
                Err(e) => tracing::error!(error=%e,"Error while scanning base directories"),
            }
            tokio::time::sleep(interval).await;
        }
    }
}

fn list_directories(path: &Path) -> DsResult<Vec<PathBuf>> {
    let entries = std::fs::read_dir(path).map_err(DsError::from_exception)?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(DsError::from_exception)?;
        if !entry.file_name().to_string_lossy().starts_with('.') && entry.path().is_dir() {
            out.push(entry.path());
        }
    }
    Ok(out)
}

pub fn scan_real_paths(
    sources: &[DataSourceWithRootPathInfo],
) -> (Vec<DataSourcePathInfo>, Vec<DsError>) {
    let mut infos = Vec::new();
    let mut failures = Vec::new();
    for source in sources {
        let Some(usable) = source.data_source.to_usable() else {
            continue;
        };
        let root = source
            .root_real_path
            .as_deref()
            .or(source.root_path.as_deref())
            .map(|s| UPath::from_local_path(Path::new(s)).to_absolute());
        let mut info = DataSourcePathInfo {
            data_source_id: usable.id.clone(),
            mag_path_infos: Vec::new(),
            attachment_path_infos: Vec::new(),
        };
        for layer in &usable.data_layers {
            for mag in &layer.mags {
                if let Some(path) = &mag.path {
                    match path_info(path, root.as_ref(), false) {
                        Ok(p) => info.mag_path_infos.push(p),
                        Err(e) => failures.push(e),
                    }
                }
            }
            for attachment in layer.all_attachments() {
                match path_info(&attachment.path, root.as_ref(), true) {
                    Ok(p) => info.attachment_path_infos.push(p),
                    Err(e) => failures.push(e),
                }
            }
        }
        if !info.is_empty() {
            infos.push(info);
        }
    }
    (infos, failures)
}
fn path_info(path: &UPath, root: Option<&UPath>, attachment: bool) -> DsResult<RealPathInfo> {
    if path.is_remote() {
        return Ok(RealPathInfo {
            path: path.clone(),
            real_path: path.clone(),
            has_local_data: false,
        });
    }
    if attachment && !path.is_absolute() {
        return Err(DsError::failure(
            "Attachment path as stored in db must be absolute",
        ));
    }
    let real_path = path.to_real()?;
    let has_local_data = root.is_some_and(|root| real_path.starts_with(root));
    Ok(RealPathInfo {
        path: path.clone(),
        real_path,
        has_local_data,
    })
}
fn log_path_failures(failures: &[DsError], verbose: bool) {
    if verbose {
        for failure in failures {
            tracing::warn!(error=%failure,"RealPath scan failure");
        }
    }
}
