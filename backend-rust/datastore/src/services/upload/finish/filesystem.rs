//! Filesystem helpers: listing, common roots, unzipping, copying, moving and sizing directories.
use std::{
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU32, Ordering},
};

use crate::error::{DsError, DsResult};

pub(super) fn io_failure(e: impl std::fmt::Display) -> DsError {
    DsError::failure(e.to_string())
}

/// Commons IO `copyDirectory` with a missing source (`requireDirectoryExists`).
pub(super) fn missing_directory(dir: &Path) -> DsError {
    let message = format!("Directory '{}' does not exist.", dir.display());
    DsError {
        exception: Some(format!("java.io.FileNotFoundException: {message}")),
        ..DsError::failure(message)
    }
}

/// Commons IO `sizeOfDirectoryAsBigInteger` with a missing directory: the `FileNotFoundException`
/// arrives wrapped in an `UncheckedIOException`; Scala's `tryo` keeps both texts.
pub(super) fn missing_directory_unchecked(dir: &Path) -> DsError {
    let cause = format!(
        "java.io.FileNotFoundException: Directory '{}' does not exist.",
        dir.display()
    );
    DsError {
        exception: Some(format!("java.io.UncheckedIOException: {cause}")),
        ..DsError::failure(cause)
    }
}

/// Files below `dir` up to `max_depth` (Java `Files.walk(dir, maxDepth, FOLLOW_LINKS)` minus the
/// root, regular files only), sorted for determinism.
pub(super) fn list_files_recursive(dir: &Path, max_depth: usize) -> DsResult<Vec<PathBuf>> {
    fn walk(dir: &Path, depth: usize, max: usize, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
        if depth > max {
            return Ok(());
        }
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .collect();
        entries.sort();
        for path in entries {
            if path.is_file() {
                out.push(path);
            } else if path.is_dir() {
                walk(&path, depth + 1, max, out)?;
            }
        }
        Ok(())
    }
    if !dir.exists() {
        return Err(DsError::failure(format!(
            "No such directory. Directory: {}",
            dir.display()
        )));
    }
    let mut out = Vec::new();
    walk(dir, 1, max_depth, &mut out).map_err(io_failure)?;
    Ok(out)
}

/// Direct sub-directories (following links), sorted.
pub(super) fn list_directories(dir: &Path) -> DsResult<Vec<PathBuf>> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|_| DsError::failure(format!("No such directory. Directory: {}", dir.display())))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    Ok(dirs)
}

pub(super) fn names(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(n) => Some(n.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// Scala `PathUtils.commonPrefix` (component-wise; absolute if the first path is).
pub(super) fn common_prefix(paths: &[PathBuf]) -> PathBuf {
    let Some(first) = paths.first() else {
        return PathBuf::new();
    };
    let absolute = first.is_absolute();
    let mut prefix = names(first);
    for path in &paths[1..] {
        let other = names(path);
        let common = prefix
            .iter()
            .zip(&other)
            .take_while(|(a, b)| a == b)
            .count();
        prefix.truncate(common);
    }
    let mut out = if absolute {
        PathBuf::from("/")
    } else {
        PathBuf::new()
    };
    out.extend(prefix);
    out
}

/// Scala `PathUtils.findCommonRootDirectory`.
pub(super) fn find_common_root_directory(
    paths: &[PathBuf],
    boundary_dir_names: &[String],
) -> PathBuf {
    let prefix = common_prefix(paths);
    let elements = names(&prefix);
    let truncated = match elements
        .iter()
        .rposition(|e| boundary_dir_names.contains(e))
    {
        None => prefix,
        Some(0) => PathBuf::new(),
        Some(i) => {
            let mut out = if prefix.is_absolute() {
                PathBuf::from("/")
            } else {
                PathBuf::new()
            };
            out.extend(&elements[..i]);
            out
        }
    };
    // Strip the lone file's own name (commonPrefix of a single path is the path itself).
    if let [single] = paths
        && let Some(file_name) = single.file_name()
        && truncated.file_name() == Some(file_name)
    {
        return if names(&truncated).len() == 1 {
            PathBuf::new()
        } else {
            truncated
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_default()
        };
    }
    truncated
}

fn is_hidden_entry(name: &str) -> bool {
    Path::new(name)
        .file_name()
        .is_some_and(|n| n.to_string_lossy().starts_with('.'))
        || name.starts_with("__MACOSX")
}

/// Lexical normalization; `None` if the path climbs above its start.
fn normalize_relative(path: &Path) -> Option<PathBuf> {
    let mut out = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(n) => out.push(n.to_owned()),
            Component::ParentDir => {
                out.pop()?;
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out.iter().collect())
}

/// Scala `ZipIO.unzipToDirectory(…, includeHiddenFiles = false, whitelist, truncateCommonPrefix =
/// true, boundaryDirNames)`, rejecting absolute and escaping entries (zip slip).
pub(super) fn unzip_to_directory(
    zip_path: &Path,
    target: &Path,
    hidden_whitelist: &[&str],
    boundary_dir_names: &[String],
) -> DsResult<Vec<PathBuf>> {
    let file = std::fs::File::open(zip_path).map_err(io_failure)?;
    let mut archive = zip::ZipArchive::new(file).map_err(io_failure)?;
    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(io_failure)?;
        let name = entry.name().map_err(io_failure)?.into_owned();
        if entry.is_dir() {
            continue;
        }
        let file_name = Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if is_hidden_entry(&name) && !hidden_whitelist.contains(&file_name.as_str()) {
            continue;
        }
        entries.push((i, name));
    }
    let paths: Vec<PathBuf> = entries.iter().map(|(_, n)| PathBuf::from(n)).collect();
    let root = find_common_root_directory(&paths, boundary_dir_names);
    let mut written = Vec::new();
    for (index, name) in entries {
        let raw = Path::new(&name);
        if raw.is_absolute() {
            return Err(DsError::failure(format!(
                "Zip entry has an absolute path and was rejected as a potential zip slip attack: {name}"
            )));
        }
        let relative = raw.strip_prefix(&root).unwrap_or(raw);
        let Some(relative) = normalize_relative(relative) else {
            return Err(DsError::failure(format!(
                "Zip entry path escapes the target directory and was rejected as a potential zip slip attack: {name}"
            )));
        };
        let path = target.join(&relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(io_failure)?;
        }
        let mut entry = archive.by_index(index).map_err(io_failure)?;
        let mut out = std::fs::File::create(&path).map_err(io_failure)?;
        std::io::copy(&mut entry, &mut out).map_err(io_failure)?;
        written.push(relative);
    }
    Ok(written)
}

/// Commons IO `copyDirectory`.
pub(super) fn copy_directory(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let destination = target.join(entry.file_name());
        if path.is_dir() {
            copy_directory(&path, &destination)?;
        } else {
            std::fs::copy(&path, &destination)?;
        }
    }
    Ok(())
}

/// Commons IO `moveDirectory`: refuses existing targets, renames, else copies and deletes.
pub(super) fn move_directory(source: &Path, target: &Path) -> DsResult<()> {
    if target.exists() {
        return Err(DsError::failure(format!(
            "File element in parameter 'destDir' already exists: '{}'",
            target.display()
        )));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(io_failure)?;
    }
    if std::fs::rename(source, target).is_ok() {
        return Ok(());
    }
    copy_directory(source, target).map_err(io_failure)?;
    std::fs::remove_dir_all(source).map_err(io_failure)
}

/// Scala `PathUtils.moveDirectoryViaTemp` (moving a directory into a sub-directory of itself).
pub(super) fn move_directory_via_temp(source: &Path, target: &Path) -> DsResult<()> {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let temp = source.with_file_name(format!(
        ".{:010}",
        std::process::id() as u64 * 1000 + u64::from(COUNTER.fetch_add(1, Ordering::Relaxed))
    ));
    move_directory(source, &temp)?;
    move_directory(&temp, target)
}

/// Commons IO `sizeOfDirectory` (symbolic links are not followed).
pub(super) fn size_of_directory(path: &Path) -> std::io::Result<u64> {
    let mut total = 0;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.path().symlink_metadata()?;
        if metadata.is_dir() {
            total += size_of_directory(&entry.path())?;
        } else if metadata.is_file() {
            total += metadata.len();
        }
    }
    Ok(total)
}
