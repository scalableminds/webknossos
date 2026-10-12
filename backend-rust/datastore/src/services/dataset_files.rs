//! Local dataset file operations behind DataSourceController's maintenance routes:
//! Scala `LocalDatasetDeletionService.moveToTrash`, `DataSourceService.deleteLocalPathsFromDisk`,
//! `DSUsedStorageService.measureStorageForPaths` and `DataSourceMirrorService.writeMirror`.
//!
//! The file system functions block; async callers run them in `spawn_blocking`.
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::Serialize;

use crate::{
    datavault::DataVaultService,
    error::{DsError, DsResult, format_iso_instant},
    models::{
        DataLayerAttachments, LayerAttachment, LayerAttachmentType, MagLocator, StaticLayer, UPath,
        UsableDataSource,
    },
    services::BaseDirService,
};

/// Scala `DirectoryConstants.trashDir`.
pub const TRASH_DIR: &str = ".trash";
const MIRROR_DIR: &str = ".mirror";

/// Java `Exception.toString` style for an IO error.
fn io_exception(error: &std::io::Error) -> String {
    let class = match error.kind() {
        std::io::ErrorKind::NotFound => "java.nio.file.NoSuchFileException",
        std::io::ErrorKind::AlreadyExists => "java.nio.file.FileAlreadyExistsException",
        std::io::ErrorKind::PermissionDenied => "java.nio.file.AccessDeniedException",
        std::io::ErrorKind::DirectoryNotEmpty => "java.nio.file.DirectoryNotEmptyException",
        _ => "java.io.IOException",
    };
    format!("{class}: {error}")
}

fn exists(path: &Path) -> bool {
    // `Files.exists` follows links; broken links do not exist.
    path.exists()
}

/// Scala `moveToTrash`: `<root>/../.trash/<directoryName>`, deduplicated with ` (n)` suffixes.
pub fn move_to_trash(
    dataset_id: &str,
    path: &Path,
    directory_name: &str,
    reason: Option<&str>,
) -> DsResult<()> {
    if !exists(path) {
        tracing::info!(
            "Dataset deletion requested for dataset {dataset_id} at {}, but it does not exist. Skipping deletion on disk.",
            path.display()
        );
        return Ok(());
    }
    let normalized = crate::models::LocalPath::from_path(path).to_path_buf();
    let orga_dir = normalized
        .parent()
        .ok_or_else(|| DsError::failure("java.lang.NullPointerException"))?;
    let trash_path = orga_dir.join(TRASH_DIR);
    let target = trash_path.join(directory_name);
    if !trash_path.is_dir() {
        std::fs::create_dir_all(&trash_path).map_err(|e| DsError::failure(io_exception(&e)))?;
    }
    tracing::info!(
        "Deleting dataset {dataset_id} by moving it from {} to {} {}",
        path.display(),
        target.display(),
        reason.map_or("...".to_owned(), |r| format!("because {r}"))
    );
    for retry in 0..=15 {
        let candidate = if retry == 0 {
            target.clone()
        } else {
            target.with_file_name(format!("{directory_name} ({retry})"))
        };
        // `Files.move` without REPLACE_EXISTING; rename(2) would replace an empty directory.
        if candidate.symlink_metadata().is_ok() {
            continue;
        }
        return match std::fs::rename(path, &candidate) {
            Ok(()) => {
                tracing::info!(
                    "Successfully moved dataset from {} to {}.",
                    path.display(),
                    target.display()
                );
                Ok(())
            }
            Err(e) => Err(DsError::failure(format!(
                "Deleting dataset failed: {}",
                io_exception(&e)
            ))),
        };
    }
    Err(DsError::failure(
        "Deleting dataset failed: too many retries.",
    ))
}

/// Scala `PathUtils.deleteDirectoryRecursively` (Commons IO `deleteDirectory`): a missing path is
/// fine, a symbolic link is removed without following it, a regular file is refused.
pub fn delete_directory_recursively(path: &Path) -> DsResult<()> {
    let fail = |message: String| {
        DsError::failure(format!(
            "Failed to delete directory {}: {message}",
            path.display()
        ))
    };
    if !exists(path) {
        return Ok(());
    }
    let metadata = path.symlink_metadata().map_err(|e| fail(e.to_string()))?;
    if metadata.file_type().is_symlink() {
        return std::fs::remove_file(path).map_err(|e| fail(e.to_string()));
    }
    if !metadata.is_dir() {
        return Err(fail(format!(
            "Parameter 'directory' is not a directory: {}",
            path.display()
        )));
    }
    std::fs::remove_dir_all(path).map_err(|e| fail(e.to_string()))
}

/// Scala `deleteLocalPathsFromDisk`: local paths inside a configured local base directory are
/// deleted (all are attempted); the first failure is returned. Zip entries and remote paths are
/// skipped.
pub fn delete_local_paths_from_disk(base_dirs: &BaseDirService, paths: &[UPath]) -> DsResult<()> {
    let bases: Vec<PathBuf> = base_dirs
        .local_dirs(None, false)
        .into_iter()
        .map(|(p, _)| p)
        .collect();
    let mut first_failure = None;
    for path in paths.iter().filter(|p| p.is_local()) {
        let Ok(local) = path.to_local_path() else {
            continue;
        };
        let absolute = std::path::absolute(&local).unwrap_or(local);
        if !bases.iter().any(|base| absolute.starts_with(base)) {
            continue;
        }
        if let Err(e) = delete_directory_recursively(&absolute)
            && first_failure.is_none()
        {
            first_failure = Some(e);
        }
    }
    first_failure.map_or(Ok(()), Err)
}

/// Scala `PathStorageReport`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStorageReport {
    pub path: String,
    pub used_storage_bytes: u64,
}

/// Scala `measureStorageForPaths`: absolute local paths and managed-S3 paths are measured; paths
/// whose measurement fails are logged and left out. Unparsable paths fail the whole request.
pub async fn measure_storage_for_paths(
    vaults: &DataVaultService,
    paths: &[String],
    user_token: Option<&str>,
) -> DsResult<Vec<PathStorageReport>> {
    let mut pairs = Vec::with_capacity(paths.len());
    for path in paths {
        pairs.push((path, UPath::parse(path)?));
    }
    let pairs: Vec<_> = pairs
        .into_iter()
        .filter(|(_, upath)| {
            (upath.is_local() && upath.is_absolute()) || vaults.path_is_in_managed_s3(upath)
        })
        .collect();
    let mut vault_paths = Vec::with_capacity(pairs.len());
    for (_, upath) in &pairs {
        vault_paths.push(vaults.vault_path_for(upath).await?);
    }
    let mut reports = Vec::new();
    let mut failed = Vec::new();
    for ((original, _), vault_path) in pairs.iter().zip(vault_paths) {
        match vault_path.used_storage_bytes(user_token).await {
            Ok(bytes) => reports.push(PathStorageReport {
                path: (*original).clone(),
                used_storage_bytes: bytes,
            }),
            Err(_) => failed.push((*original).clone()),
        }
    }
    if !failed.is_empty() {
        tracing::error!(
            "Failed to measure storage for {} paths: {}{}",
            failed.len(),
            failed
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
            if failed.len() > 5 { "..." } else { "." }
        );
    }
    Ok(reports)
}

mod mirror_messages {
    pub const DELETE_STALE_TEMP: &str = "Could not delete stale temporary on-disk dataset mirror.";
    pub const DELETE_EXISTING: &str = "Could not clean up existing on-disk dataset mirror.";
    pub const CREATE_TEMP_DIR: &str =
        "Could not create temporary directory for on-disk dataset mirror.";
    pub const CREATE_LAYER_DIR: &str =
        "Could not create layer directory for on-disk dataset mirror.";
    pub const WRITE_MAGS: &str = "Could not write mags.";
    pub const WRITE_ATTACHMENTS: &str = "Could not write attachments.";
    pub const WRITE_LAYERS: &str = "Could not write layer structure in on-disk dataset mirror.";
    pub const WRITE_PROPERTIES: &str =
        "Could not write datasource-properties.json file for on-disk dataset mirror.";
    pub const WRITE_README: &str = "Could not write readme.txt file for on-disk dataset mirror.";
    pub const MOVE_TEMP: &str = "Could not finalize temporary on-disk dataset mirror.";
    pub const CREATE_PARENT: &str = "Could not create dataset mirror directory.";
    pub const PARENT_NOT_WRITABLE: &str = "Dataset mirror directory is not writable.";
}
use mirror_messages as mm;

fn io(e: std::io::Error) -> DsError {
    DsError::from_exception(io_exception(&e))
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn symlink(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "symbolic links are not supported on this platform",
    ))
}

fn is_writable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        rustix::fs::access(path, rustix::fs::Access::WRITE_OK).is_ok()
    }
    #[cfg(not(unix))]
    {
        std::fs::metadata(path).is_ok_and(|m| !m.permissions().readonly())
    }
}

/// Scala `DataSourceMirrorService.writeMirror`: for virtual datasets whose explicit paths are
/// all plain local paths, `<orgaDir>/.mirror/<directoryName>` gets a symlink layer structure, a
/// `datasource-properties.json` and a readme. Returns the mirror directory, or `None` if the
/// dataset has remote or zip-entry paths.
pub fn write_mirror(
    base_dirs: &BaseDirService,
    source: &UsableDataSource,
    dataset_id: &str,
) -> DsResult<Option<String>> {
    let all_plain_local = source
        .all_explicit_paths()
        .iter()
        .all(|p| matches!(p, UPath::Local(_)));
    if !all_plain_local {
        return Ok(None);
    }
    let orga_dir =
        base_dirs.get_one_local_for_org(&source.id.organization_id, false, true, true)?;
    let mirror_dir = orga_dir.join(MIRROR_DIR).join(&source.id.directory_name);
    let mut temp_name = mirror_dir.file_name().unwrap_or_default().to_os_string();
    temp_name.push(".new");
    let temp_dir = mirror_dir.with_file_name(temp_name);
    tracing::info!(
        "Writing dataset mirror for {dataset_id} at {}...",
        mirror_dir.display()
    );
    ensure_mirror_parent(&mirror_dir)?;
    if exists(&temp_dir) {
        delete_directory_recursively(&temp_dir).map_err(|e| e.wrap(mm::DELETE_STALE_TEMP))?;
    }
    std::fs::create_dir(&temp_dir).map_err(|e| io(e).wrap(mm::CREATE_TEMP_DIR))?;
    let layers = source
        .data_layers
        .iter()
        .map(|layer| write_mirror_layer(layer, &temp_dir))
        .collect::<DsResult<Vec<_>>>()
        .map_err(|e| e.wrap(mm::WRITE_LAYERS))?;
    let mirror_source = UsableDataSource {
        data_layers: layers,
        ..source.clone()
    };
    write_mirror_properties(&mirror_source, &temp_dir).map_err(|e| e.wrap(mm::WRITE_PROPERTIES))?;
    write_readme(&temp_dir, dataset_id, SystemTime::now()).map_err(|e| e.wrap(mm::WRITE_README))?;
    if exists(&mirror_dir) {
        delete_directory_recursively(&mirror_dir).map_err(|e| e.wrap(mm::DELETE_EXISTING))?;
    }
    std::fs::rename(&temp_dir, &mirror_dir).map_err(|e| io(e).wrap(mm::MOVE_TEMP))?;
    Ok(Some(mirror_dir.display().to_string()))
}

fn ensure_mirror_parent(mirror_dir: &Path) -> DsResult<()> {
    let parent = mirror_dir
        .parent()
        .ok_or_else(|| DsError::failure(mm::CREATE_PARENT))?;
    if exists(parent) {
        if is_writable(parent) {
            Ok(())
        } else {
            Err(DsError::failure(mm::PARENT_NOT_WRITABLE))
        }
    } else {
        std::fs::create_dir(parent).map_err(|e| io(e).wrap(mm::CREATE_PARENT))
    }
}

fn write_mirror_layer(layer: &StaticLayer, mirror_dir: &Path) -> DsResult<StaticLayer> {
    let layer_dir = mirror_dir.join(&layer.name);
    std::fs::create_dir(&layer_dir).map_err(|e| io(e).wrap(mm::CREATE_LAYER_DIR))?;
    let mags = layer
        .mags
        .iter()
        .map(|mag| write_mirror_mag(mag, &layer_dir))
        .collect::<DsResult<Vec<_>>>()
        .map_err(|e| e.wrap(mm::WRITE_MAGS))?;
    let attachments = layer
        .attachments
        .as_ref()
        .map(|a| write_mirror_attachments(a, &layer_dir))
        .transpose()
        .map_err(|e| e.wrap(mm::WRITE_ATTACHMENTS))?;
    let with_mags = StaticLayer {
        mags,
        ..layer.clone()
    };
    Ok(match attachments {
        Some(attachments) => with_mags.with_attachments(attachments),
        None => with_mags,
    })
}

fn write_mirror_mag(mag: &MagLocator, layer_dir: &Path) -> DsResult<MagLocator> {
    let explicit = mag.path.as_ref().ok_or_else(|| {
        DsError::failure(
            "Mag does not have explicit path. This should never happen for virtual datasets",
        )
    })?;
    let link = layer_dir.join(mag.mag.to_mag_literal(true));
    symlink(&explicit.to_local_path()?, &link).map_err(io)?;
    Ok(MagLocator {
        path: Some(UPath::from_local_path(&link)),
        ..mag.clone()
    })
}

fn write_mirror_attachments(
    attachments: &DataLayerAttachments,
    layer_dir: &Path,
) -> DsResult<DataLayerAttachments> {
    use LayerAttachmentType as T;
    let one = |a: &LayerAttachment, kind| write_mirror_attachment(a, kind, layer_dir);
    let many = |list: &[LayerAttachment], kind| {
        list.iter()
            .map(|a| one(a, kind))
            .collect::<DsResult<Vec<_>>>()
    };
    Ok(DataLayerAttachments {
        meshes: many(&attachments.meshes, T::Mesh)?,
        agglomerates: many(&attachments.agglomerates, T::Agglomerate)?,
        segment_index: attachments
            .segment_index
            .as_ref()
            .map(|a| one(a, T::SegmentIndex))
            .transpose()?,
        connectomes: many(&attachments.connectomes, T::Connectome)?,
        cumsum: attachments
            .cumsum
            .as_ref()
            .map(|a| one(a, T::Cumsum))
            .transpose()?,
        segment_statistics: attachments
            .segment_statistics
            .as_ref()
            .map(|a| one(a, T::SegmentStatistics))
            .transpose()?,
    })
}

fn write_mirror_attachment(
    attachment: &LayerAttachment,
    kind: LayerAttachmentType,
    layer_dir: &Path,
) -> DsResult<LayerAttachment> {
    let type_dir = layer_dir.join(kind.default_directory_name());
    let link = type_dir.join(format!(
        "{}{}",
        attachment.name,
        attachment.data_format.suffix()
    ));
    std::fs::create_dir_all(&type_dir).map_err(io)?;
    symlink(&attachment.local_path()?, &link).map_err(io)?;
    Ok(LayerAttachment {
        path: UPath::from_local_path(&link),
        ..attachment.clone()
    })
}

fn write_readme(mirror_dir: &Path, dataset_id: &str, now: SystemTime) -> DsResult<()> {
    let content = format!(
        "This directory is a read-only mirror of a database-based (virtual) dataset in WEBKNOSSOS.

It was auto-generated and reflects the dataset’s layer structure. The mag and attachment paths
contain symbolic links pointing to the actual data files.

Manual changes made here will NOT propagate back to WEBKNOSSOS. To update the dataset, use
the WEBKNOSSOS UI or python interface instead.

Dataset ID: {dataset_id}
Last mirror update: {}
",
        format_iso_instant(now)
    );
    std::fs::write(mirror_dir.join("readme.txt"), content).map_err(io)
}

fn write_mirror_properties(source: &UsableDataSource, mirror_dir: &Path) -> DsResult<()> {
    let base = UPath::from_local_path(mirror_dir);
    let relativized = UsableDataSource {
        data_layers: source
            .data_layers
            .iter()
            .map(|l| l.relativize_paths(&base))
            .collect(),
        ..source.clone()
    };
    let path = mirror_dir.join(crate::models::FILENAME_DATASOURCE_PROPERTIES_JSON);
    std::fs::write(&path, relativized.to_mirror_properties_file_content())
        .map_err(|e| DsError::failure(format!("{} ({e})", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "wk-dataset-files-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn trash_moves_are_deduplicated() {
        let orga = temp();
        for _ in 0..3 {
            std::fs::create_dir_all(orga.join("ds/color")).unwrap();
            std::fs::write(orga.join("ds/color/x"), b"1").unwrap();
            move_to_trash("id", &orga.join("ds"), "ds", Some("test")).unwrap();
        }
        assert!(!orga.join("ds").exists());
        assert!(orga.join(".trash/ds/color/x").exists());
        assert!(orga.join(".trash/ds (1)/color/x").exists());
        assert!(orga.join(".trash/ds (2)/color/x").exists());
        // Missing datasets are skipped successfully.
        move_to_trash("id", &orga.join("missing"), "missing", None).unwrap();
    }

    #[test]
    fn recursive_delete_refuses_files_and_unlinks_symlinks() {
        let dir = temp();
        std::fs::create_dir_all(dir.join("target/sub")).unwrap();
        std::fs::write(dir.join("file"), b"x").unwrap();
        let error = delete_directory_recursively(&dir.join("file")).unwrap_err();
        assert!(error.message.starts_with("Failed to delete directory "));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("target"), dir.join("link")).unwrap();
            delete_directory_recursively(&dir.join("link")).unwrap();
            assert!(dir.join("target/sub").exists());
        }
        delete_directory_recursively(&dir.join("target")).unwrap();
        assert!(!dir.join("target").exists());
        delete_directory_recursively(&dir.join("missing")).unwrap();
    }
}
