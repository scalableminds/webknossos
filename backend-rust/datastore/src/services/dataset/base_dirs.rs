//! BaseDirService: configured preference, filter flags and local organization directories.
use crate::{
    config::BaseDirectory,
    error::{DsError, DsResult},
    models::UPath,
};
use std::path::{Path, PathBuf};
#[derive(Clone)]
pub struct BaseDirService {
    entries: Vec<BaseDirectory>,
}
impl BaseDirService {
    pub fn new(entries: Vec<BaseDirectory>) -> Self {
        Self { entries }
    }
    pub fn get_one_for_org(
        &self,
        org: &str,
        upload: bool,
        local: bool,
        s3: bool,
    ) -> DsResult<UPath> {
        if org.is_empty() || matches!(org, "." | "..") || org.contains(['/', '\\']) {
            return Err(DsError::failure("Invalid organization directory name."));
        }
        let eligible = |d: &&BaseDirectory| {
            (!upload || d.allows_upload)
                && (!local || !d.is_remote)
                && (!s3 || UPath::parse(&d.path).is_ok_and(|p| p.scheme() == Some("s3")))
        };
        if let Some(d) = self
            .entries
            .iter()
            .filter(eligible)
            .find(|d| d.organization_id.as_deref() == Some(org))
        {
            return UPath::parse(&d.path);
        }
        if let Some(d) = self
            .entries
            .iter()
            .filter(eligible)
            .find(|d| d.organization_id.is_none())
        {
            return Ok(UPath::parse(&d.path)?.join(org));
        }
        Err(DsError::failure(format!(
            "No matching base directory configured for organization {org}."
        )))
    }
    pub fn get_one_local_for_org(
        &self,
        org: &str,
        upload: bool,
        create: bool,
        writable: bool,
    ) -> DsResult<PathBuf> {
        let path = self
            .get_one_for_org(org, upload, true, false)?
            .to_local_path()?;
        if create && !path.exists() {
            std::fs::create_dir_all(&path).map_err(|e| {
                DsError::from_exception(e).wrap(
                    "Could not create organization directory on disk on the data store server.",
                )
            })?;
        }
        if writable {
            check_writable(&path)?;
        }
        Ok(path)
    }
    pub fn local_dirs(&self, org: Option<&str>, scan: bool) -> Vec<(PathBuf, Option<String>)> {
        self.entries
            .iter()
            .filter(|d| !d.is_remote && (!scan || d.do_scan))
            .filter(|d| org.is_none_or(|o| d.organization_id.as_deref() == Some(o)))
            .filter_map(|d| {
                UPath::parse(&d.path)
                    .ok()?
                    .to_local_path()
                    .ok()
                    .map(|p| (p, d.organization_id.clone()))
            })
            .collect()
    }
}
fn check_writable(path: &Path) -> DsResult<()> {
    let failure = if !path.exists() {
        Some("Datastore cannot write to organization data directory, it does not exist.")
    } else if !path.is_dir() {
        Some(
            "Datastore cannot write to organization data directory, it exists but is no directory.",
        )
    } else {
        #[cfg(unix)]
        let writable = rustix::fs::access(path, rustix::fs::Access::WRITE_OK).is_ok();
        #[cfg(not(unix))]
        let writable = std::fs::metadata(path).is_ok_and(|m| !m.permissions().readonly());
        if writable {
            None
        } else {
            Some("Datastore cannot write to organization data directory. No write access.")
        }
    };
    match failure {
        Some(message) => Err(DsError::failure(message)),
        None => Ok(()),
    }
}
