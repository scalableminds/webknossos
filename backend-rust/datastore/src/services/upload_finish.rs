//! Scala `UploadService.finish*Upload`: checks, unzip/move, post-processing and the final move to
//! the organization directory, then the report to WEBKNOSSOS.
//! Managed-S3 targets copy staged files before publishing adapted remote paths.
use std::{
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU32, Ordering},
};

use serde_json::{Value, json};

use crate::{
    access::TokenContext,
    error::{DsError, DsResult},
    models::{
        DataSource, FILENAME_DATASOURCE_PROPERTIES_JSON, LayerAttachment, LayerAttachmentType,
        MagLocator, UPath, UsableDataSource, VoxelSize, enums::LayerCategory,
    },
    services::{
        DataSourceService,
        dataset_files::{delete_directory_recursively, move_to_trash},
        upload::{UNPACKED_DIR, UPLOADING_DIR, UploadDomain, UploadService, upload_full_name},
    },
    wk_client::WkClient,
};

const FILENAME_HEADER_WKW: &str = "header.wkw";
const FILENAME_DOT_ZARRAY: &str = ".zarray";
const FILENAME_DOT_ZATTRS: &str = ".zattrs";
const FILENAME_ZARR_JSON: &str = "zarr.json";
const FILENAME_INFO: &str = "info";
const FILENAME_ATTRIBUTES_JSON: &str = "attributes.json";
const ZIP_EXTENSIONS: [&str; 2] = [".zip", ".ozx"];
const NO_FILES: &str = "Tried to finish upload with no files. Note that files starting with dot are not read. This may be a retry of a failed finish request, see previous errors.";
const ROOT_DETECTION_FAILED: &str = "Could not determine the dataset root directory in the uploaded files. Please check the folder structure of your upload and try again.";

fn io_failure(e: impl std::fmt::Display) -> DsError {
    DsError::failure(e.to_string())
}

/// Files below `dir` up to `max_depth` (Java `Files.walk(dir, maxDepth, FOLLOW_LINKS)` minus the
/// root, regular files only), sorted for determinism.
pub fn list_files_recursive(dir: &Path, max_depth: usize) -> DsResult<Vec<PathBuf>> {
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
pub fn list_directories(dir: &Path) -> DsResult<Vec<PathBuf>> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|_| DsError::failure(format!("No such directory. Directory: {}", dir.display())))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    Ok(dirs)
}

fn names(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(n) => Some(n.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// Scala `PathUtils.commonPrefix` (component-wise; absolute if the first path is).
pub fn common_prefix(paths: &[PathBuf]) -> PathBuf {
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
pub fn find_common_root_directory(paths: &[PathBuf], boundary_dir_names: &[String]) -> PathBuf {
    let prefix = common_prefix(paths);
    let elements = names(&prefix);
    let truncated = match elements
        .iter()
        .rposition(|e| boundary_dir_names.contains(e))
    {
        None => prefix.clone(),
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
pub fn unzip_to_directory(
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
pub fn copy_directory(source: &Path, target: &Path) -> std::io::Result<()> {
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
pub fn move_directory(source: &Path, target: &Path) -> DsResult<()> {
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
fn move_directory_via_temp(source: &Path, target: &Path) -> DsResult<()> {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let temp = source.with_file_name(format!(
        ".{:010}",
        std::process::id() as u64 * 1000 + u64::from(COUNTER.fetch_add(1, Ordering::Relaxed))
    ));
    move_directory(source, &temp)?;
    move_directory(&temp, target)
}

/// Commons IO `sizeOfDirectory` (symbolic links are not followed).
pub fn size_of_directory(path: &Path) -> std::io::Result<u64> {
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

/// Scala `UploadedDataSourceType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadedDataSourceType {
    Explored,
    Zarr,
    ZarrMultilayer,
    Zarr3,
    Zarr3Multilayer,
    NeuroglancerPrecomputed,
    NeuroglancerMultilayer,
    N5Multilayer,
    N5Multiscales,
    N5Array,
    Wkw,
}

fn contains_matching_file(dir: &Path, names: &[&str], max_depth: usize) -> bool {
    list_files_recursive(dir, max_depth).is_ok_and(|files| {
        files.iter().any(|f| {
            f.file_name()
                .is_some_and(|n| names.contains(&n.to_string_lossy().as_ref()))
        })
    })
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Structural check of Scala `N5Metadata` reads.
fn is_n5_metadata(json: &Value) -> bool {
    json.get("multiscales")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().all(|item| {
                item.get("datasets")
                    .and_then(Value::as_array)
                    .is_some_and(|ds| {
                        ds.iter().all(|d| {
                            d.get("path").is_some_and(Value::is_string)
                                && d.get("transform").is_some_and(|t| {
                                    t.get("axes").is_some_and(Value::is_array)
                                        && t.get("scale").is_some_and(Value::is_array)
                                })
                        })
                    })
            })
        })
}

/// Structural check of Scala `N5Header` reads.
fn is_n5_header(json: &Value) -> bool {
    json.get("dimensions").is_some_and(Value::is_array)
        && json.get("blockSize").is_some_and(Value::is_array)
        && json.get("dataType").is_some_and(Value::is_string)
}

fn attributes_file(dir: &Path) -> Option<PathBuf> {
    let path = dir.join(FILENAME_ATTRIBUTES_JSON);
    path.is_file().then_some(path)
}

fn looks_like_n5_multiscales_layer(dir: &Path) -> bool {
    attributes_file(dir)
        .and_then(|f| read_json(&f))
        .is_some_and(|j| is_n5_metadata(&j))
}

fn looks_like_n5_multilayer(dir: &Path) -> bool {
    attributes_file(dir).is_some()
        && list_directories(dir)
            .is_ok_and(|dirs| dirs.iter().all(|d| looks_like_n5_multiscales_layer(d)))
}

fn looks_like_n5_array(dir: &Path) -> bool {
    if attributes_file(dir).is_none() {
        return false;
    }
    let Some(dataset) = list_directories(dir)
        .ok()
        .and_then(|d| d.into_iter().next())
    else {
        return false;
    };
    let Ok(scales) = list_directories(&dataset) else {
        return false;
    };
    scales.len() == 1
        && attributes_file(&scales[0])
            .and_then(|f| read_json(&f))
            .is_some_and(|j| is_n5_header(&j))
}

/// Scala `guessTypeOfUploadedDataSource`.
pub fn guess_type(dir: &Path) -> UploadedDataSourceType {
    use UploadedDataSourceType as T;
    let zarr = [FILENAME_DOT_ZARRAY, FILENAME_DOT_ZATTRS];
    if contains_matching_file(dir, &[FILENAME_DATASOURCE_PROPERTIES_JSON], 1) {
        T::Explored
    } else if contains_matching_file(dir, &zarr, 2) {
        T::Zarr
    } else if contains_matching_file(dir, &zarr, 3) {
        T::ZarrMultilayer
    } else if contains_matching_file(dir, &[FILENAME_ZARR_JSON], 2) {
        T::Zarr3
    } else if contains_matching_file(dir, &[FILENAME_ZARR_JSON], 3) {
        T::Zarr3Multilayer
    } else if contains_matching_file(dir, &[FILENAME_INFO], 1) {
        T::NeuroglancerPrecomputed
    } else if contains_matching_file(dir, &[FILENAME_INFO], 2) {
        T::NeuroglancerMultilayer
    } else if looks_like_n5_multilayer(dir) {
        T::N5Multilayer
    } else if looks_like_n5_multiscales_layer(dir) {
        T::N5Multiscales
    } else if looks_like_n5_array(dir) {
        T::N5Array
    } else {
        T::Wkw
    }
}

/// Scala `addLayerAndMagDirIfMissing` (WKW): data uploaded as a mag or layer directory is moved
/// into `color/1` or `color`.
pub fn add_layer_and_mag_dir_if_missing(dir: &Path, header_file: &str) -> DsResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    let depths: Vec<usize> = list_files_recursive(dir, 3)?
        .into_iter()
        .filter(|p| p.file_name().is_some_and(|n| n == header_file))
        .filter_map(|p| p.strip_prefix(dir).ok().map(|r| names(r).len() - 1))
        .collect();
    let has = |d: usize| depths.contains(&d);
    if has(0) && !has(1) && !has(2) {
        let target = dir.join("color").join("1");
        tracing::info!("Looks like mag dir. Moving to {}", target.display());
        move_directory_via_temp(dir, &target)
    } else if has(1) && !has(2) {
        let target = dir.join("color");
        tracing::info!("Looks like layer dir. Moving to {}", target.display());
        move_directory_via_temp(dir, &target)
    } else {
        Ok(())
    }
}

/// Scala `unpackOrMoveUploaded`.
pub fn unpack_or_move_uploaded(
    upload_dir: &Path,
    unpack_to: &Path,
    dataset_id: &str,
    domain: UploadDomain,
) -> DsResult<()> {
    if let Some(parent) = unpack_to.parent() {
        std::fs::create_dir_all(parent).map_err(|_| {
            DsError::failure("Could not create directory: Access denied")
                .wrap("dataset.import.fileAccessDenied")
        })?;
    }
    let mut shallow: Vec<PathBuf> = std::fs::read_dir(upload_dir)
        .map_err(|_| {
            DsError::failure(format!(
                "No such directory. Directory: {}",
                upload_dir.display()
            ))
        })?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    shallow.sort();
    let boundaries = [
        LayerCategory::Color.as_str().to_owned(),
        LayerCategory::Segmentation.as_str().to_owned(),
    ];
    let single_zip = shallow.len() == 1
        && ZIP_EXTENSIONS
            .iter()
            .any(|e| shallow[0].to_string_lossy().to_lowercase().ends_with(e));
    if single_zip {
        tracing::info!(
            "finishUpload for {dataset_id}: Unzipping {domain} to {}...",
            unpack_to.display()
        );
        unzip_to_directory(&shallow[0], unpack_to, &[".zarray", ".zattrs"], &boundaries)?;
        if !unpack_to.exists() {
            return Err(DsError::failure(NO_FILES));
        }
        return Ok(());
    }
    let deep = list_files_recursive(upload_dir, 10)?;
    if deep.is_empty() {
        return Err(DsError::failure(NO_FILES));
    }
    tracing::info!(
        "Detected {domain} root during finishUpload of {dataset_id} from {} files in {} with commonPrefixPreliminary={}",
        deep.len(),
        upload_dir.display(),
        common_prefix(&deep).display()
    );
    let root = find_common_root_directory(&deep, &boundaries);
    if !root.starts_with(upload_dir) {
        return Err(DsError::failure(ROOT_DETECTION_FAILED));
    }
    move_directory(&root, unpack_to)
        .map_err(|e| e.wrap("Could not move uploaded dataset to target directory."))
}

/// Scala `TextUtils.normalize` (umlauts and accented letters transliterated).
pub fn normalize_text(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            'ü' => "ue".into(),
            'Ü' => "Ue".into(),
            'ö' => "oe".into(),
            'Ö' => "Oe".into(),
            'ä' => "ae".into(),
            'Ä' => "Ae".into(),
            'ß' => "ss".into(),
            'é' | 'è' | 'ê' | 'ë' => "e".into(),
            'È' | 'É' | 'Ê' | 'Ë' => "E".into(),
            'Ç' => "C".into(),
            'ç' => "c".into(),
            'ñ' => "n".into(),
            'Ñ' => "N".into(),
            'ï' | 'í' | 'ì' => "i".into(),
            'Ï' => "I".into(),
            'å' => "a".into(),
            'Å' => "A".into(),
            'œ' => "oe".into(),
            'Œ' => "Oe".into(),
            'æ' => "ae".into(),
            'Æ' => "Ae".into(),
            'þ' => "th".into(),
            'Þ' => "Th".into(),
            'ø' => "oe".into(),
            'Ø' => "Oe".into(),
            other => other.to_string(),
        })
        .collect()
}

/// Scala `TextUtils.normalizeStrong` (Option rendered like Scala string interpolation).
fn normalize_strong_rendered(name: &str) -> String {
    let replaced: String = normalize_text(name)
        .chars()
        .filter(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '_' | '-' | ' ' | '\t' | '\n' | '\x0B' | '\x0C' | '\r')
        })
        .collect();
    // Scala interpolates the `Option[String]` itself.
    if replaced.is_empty() {
        "None".into()
    } else {
        format!("Some({replaced})")
    }
}

/// Scala `ObjectId.generate`: seconds, 5 process-random bytes, 3-byte counter.
fn generate_object_id() -> String {
    use std::sync::OnceLock;
    static PROCESS: OnceLock<[u8; 5]> = OnceLock::new();
    static COUNTER: OnceLock<std::sync::atomic::AtomicU32> = OnceLock::new();
    let random = |n: usize| {
        let mut bytes = [0u8; 8];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut bytes[..n]).ok();
        bytes
    };
    let process = PROCESS.get_or_init(|| random(5)[..5].try_into().unwrap());
    let counter = COUNTER.get_or_init(|| {
        let b = random(3);
        std::sync::atomic::AtomicU32::new(u32::from_be_bytes([0, b[0], b[1], b[2]]))
    });
    let c = counter.fetch_add(1, Ordering::Relaxed) & 0xff_ffff;
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as u32;
    let mut id = Vec::with_capacity(12);
    id.extend(seconds.to_be_bytes());
    id.extend(process);
    id.extend(&c.to_be_bytes()[1..]);
    id.iter().map(|b| format!("{b:02x}")).collect()
}

/// Everything `finish*Upload` needs.
pub struct FinishContext<'a> {
    pub uploads: &'a UploadService,
    pub data_sources: &'a DataSourceService,
    pub wk_client: &'a WkClient,
    pub tc: &'a TokenContext,
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> DsResult<T> + Send + 'static,
) -> DsResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(DsError::from_exception)?
}

impl FinishContext<'_> {
    fn s3_upload_base(&self, organization: &str) -> Option<UPath> {
        self.uploads
            .base_dirs()
            .get_one_for_org(organization, true, false, true)
            .ok()
    }

    fn orga_dir(&self, organization: &str) -> DsResult<PathBuf> {
        self.uploads
            .base_dirs()
            .get_one_local_for_org(organization, true, false, false)
    }

    fn unpack_to_dir(
        &self,
        source: &crate::models::DataSourceId,
        domain: UploadDomain,
        upload_id: &str,
    ) -> DsResult<PathBuf> {
        Ok(self
            .orga_dir(&source.organization_id)?
            .join(UPLOADING_DIR)
            .join(UNPACKED_DIR)
            .join(domain.as_str())
            .join(upload_id)
            .join(&source.directory_name))
    }

    /// Scala `checkWithinRequestedFileSize`.
    async fn check_within_requested_file_size(
        &self,
        upload_dir: &Path,
        upload_id: &str,
        dataset_id: &str,
        domain: UploadDomain,
    ) -> DsResult<()> {
        let store = self.uploads.store(domain);
        let reserved = store
            .find_total_file_size_in_bytes(upload_id)
            .await
            .map_err(|e| e.wrap("Could not look up reserved total file size"))?;
        let Some(reserved) = reserved else {
            return Ok(());
        };
        let dir = upload_dir.to_path_buf();
        let actual = blocking(move || size_of_directory(&dir).map_err(io_failure))
            .await
            .map_err(|e| e.wrap("Could not measure actual file size"))? as i64;
        if actual > reserved {
            // Scala starts this clean-up without awaiting it.
            if let Err(e) = self.clean_up_exceeding_size(upload_id, domain).await {
                tracing::warn!("Cleaning up oversized upload {upload_id} failed: {e}");
            }
            return Err(DsError::failure(format!(
                "Uploaded {domain} {dataset_id} exceeds the reserved size of {reserved} bytes, got {actual} bytes."
            )));
        }
        Ok(())
    }

    async fn clean_up_exceeding_size(&self, upload_id: &str, domain: UploadDomain) -> DsResult<()> {
        let dataset_id = self
            .uploads
            .dataset_id_by_upload_id(upload_id, domain)
            .await?
            .ok_or_else(DsError::empty)?;
        self.uploads
            .clean_up_uploaded(upload_id, "Exceeded reserved fileSize", domain)
            .await?;
        if domain == UploadDomain::Dataset {
            self.wk_client.delete_dataset(&dataset_id).await?;
        }
        Ok(())
    }

    /// Scala `checkAllChunksUploaded`.
    async fn check_all_chunks_uploaded(
        &self,
        upload_id: &str,
        domain: UploadDomain,
    ) -> DsResult<()> {
        let store = self.uploads.store(domain);
        let count = store
            .find_file_count(upload_id)
            .await?
            .ok_or_else(|| DsError::failure("Could not look up reserved file count."))?;
        let names = store
            .find_file_names(upload_id)
            .await
            .map_err(|e| e.wrap("Could not look up reserved file names."))?;
        if count != names.len() as i64 {
            return Err(DsError::failure(
                "Reserved file count does not match file names length.",
            ));
        }
        for name in names {
            let chunks = store
                .find_file_chunk_count(upload_id, &name)
                .await?
                .ok_or_else(|| DsError::failure("Could not look up file chunk count."))?;
            let set = store
                .find_file_chunk_set(upload_id, &name)
                .await
                .map_err(|e| e.wrap("Could not look up file chunk set."))?;
            if chunks != set.len() as i64 {
                return Err(DsError::failure(format!(
                    "Chunks missing for uploaded file {name}: expected {chunks}, got {}.",
                    set.len()
                )));
            }
        }
        Ok(())
    }

    /// Scala `deleteFailedUploadDir`.
    async fn delete_failed_upload_dir(
        &self,
        dataset_id: &str,
        unpack_to: &Path,
        directory_name: &str,
        reason: &str,
    ) {
        let delete = self.uploads.delete_temporary_files_after_upload();
        let (dataset_id, dir, name, reason) = (
            dataset_id.to_owned(),
            unpack_to.to_path_buf(),
            directory_name.to_owned(),
            reason.to_owned(),
        );
        let _ = blocking(move || {
            if delete {
                tracing::info!(
                    "Deleting failed-upload directory {} because {reason}.",
                    dir.display()
                );
                delete_directory_recursively(&dir)
            } else {
                move_to_trash(&dataset_id, &dir, &name, Some(&reason))
            }
        })
        .await;
    }

    /// Scala `cleanUpOnFailure`.
    async fn clean_up_on_failure<T>(
        &self,
        domain: UploadDomain,
        result: DsResult<T>,
        dataset_id: &str,
        source: &crate::models::DataSourceId,
        unpack_to: &Path,
        label: &str,
    ) -> DsResult<T> {
        match result {
            Ok(value) => Ok(value),
            Err(e) => {
                tracing::warn!("Error while {label}: {e}");
                self.delete_failed_upload_dir(
                    dataset_id,
                    unpack_to,
                    &source.directory_name,
                    "the upload failed",
                )
                .await;
                if domain == UploadDomain::Dataset {
                    // Scala does not await the deletion.
                    let _ = self.wk_client.delete_dataset(dataset_id).await;
                }
                Err(e.wrap(format!("Error while {label}")))
            }
        }
    }

    /// Scala `finishDatasetUpload`.
    pub async fn finish_dataset_upload(&self, upload_id: &str, dataset_id: &str) -> DsResult<()> {
        let domain = UploadDomain::Dataset;
        let store = self.uploads.store(domain);
        let source = store
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let needs_conversion = store
            .find_extra_json(upload_id, "needsConversion")
            .await?
            .and_then(|v| v.as_bool())
            .ok_or_else(DsError::empty)?;
        let voxel_size = store
            .find_extra_json(upload_id, "voxelSize")
            .await
            .ok()
            .flatten()
            .and_then(|v| VoxelSize::from_json(&v).ok());
        tracing::info!(
            "Finishing {}...",
            upload_full_name(domain, upload_id, dataset_id, &source)
        );
        let linked_layers = store
            .find_extra_json(upload_id, "linkedLayerIdentifier")
            .await?
            .ok_or_else(DsError::empty)?;
        let upload_dir =
            self.uploads
                .upload_directory_for(&source.organization_id, upload_id, domain)?;
        if !self.uploads.delete_temporary_files_after_upload() {
            let backup = self
                .orga_dir(&source.organization_id)?
                .join(crate::services::dataset_files::TRASH_DIR)
                .join(format!("uploadBackup__{upload_id}"));
            let dir = upload_dir.clone();
            tracing::info!("finishUpload for {dataset_id}: Backing up raw uploaded data...");
            blocking(move || copy_directory(&dir, &backup).map_err(io_failure)).await?;
        }
        self.check_within_requested_file_size(&upload_dir, upload_id, dataset_id, domain)
            .await
            .map_err(|e| e.wrap("File size check failed during dataset upload."))?;
        self.check_all_chunks_uploaded(upload_id, domain)
            .await
            .map_err(|e| e.wrap("Could not verify that all chunks have been uploaded."))?;
        let unpack_to = self.unpack_to_dir(&source, domain, upload_id)?;
        let (from, to, id) = (upload_dir.clone(), unpack_to.clone(), dataset_id.to_owned());
        let unpacked = blocking(move || unpack_or_move_uploaded(&from, &to, &id, domain)).await;
        self.uploads
            .clean_up_uploaded(upload_id, "Upload complete, data unpacked.", domain)
            .await?;
        self.clean_up_on_failure(
            domain,
            unpacked,
            dataset_id,
            &source,
            &unpack_to,
            &format!("unpacking dataset to {}", unpack_to.display()),
        )
        .await?;
        let processed = self
            .post_process(needs_conversion, &unpack_to, &source)
            .await;
        self.clean_up_on_failure(
            domain,
            processed,
            dataset_id,
            &source,
            &unpack_to,
            &format!("processing dataset at {}", unpack_to.display()),
        )
        .await?;
        let dir = unpack_to.clone();
        let size = blocking(move || size_of_directory(&dir).map_err(io_failure))
            .await
            .map_err(|e| e.wrap("Could not measure total size of uploaded dataset."))?;
        let data_source = self
            .move_unpacked_dataset_to_target(&unpack_to, needs_conversion, dataset_id, &source)
            .await
            .map_err(|e| e.wrap("Could not move unpacked dataset to target directory."))?;
        let mut report = json!({
            "needsConversion": needs_conversion,
            "datasetSizeBytes": size,
            "layersToLink": linked_layers,
        });
        if let Some(source) = data_source {
            report["dataSourceOpt"] =
                serde_json::to_value(&source).map_err(DsError::from_exception)?;
        }
        if let Some(voxel_size) = voxel_size {
            report["voxelSize"] =
                serde_json::to_value(voxel_size).map_err(DsError::from_exception)?;
        }
        self.wk_client
            .report_dataset_upload(dataset_id, &report, self.tc)
            .await
            .map_err(|e| {
                e.wrap("Could not report upload completion from the data store to WEBKNOSSOS.")
            })
    }

    /// Scala `exploreUploadedDataSourceIfNeeded`.
    async fn post_process(
        &self,
        needs_conversion: bool,
        unpack_to: &Path,
        source_id: &crate::models::DataSourceId,
    ) -> DsResult<()> {
        let organization = source_id.organization_id.as_str();
        if needs_conversion {
            return Ok(());
        }
        let dir = unpack_to.to_path_buf();
        let kind = blocking(move || Ok(guess_type(&dir))).await?;
        match kind {
            UploadedDataSourceType::Wkw => {
                let dir = unpack_to.to_path_buf();
                blocking(move || add_layer_and_mag_dir_if_missing(&dir, FILENAME_HEADER_WKW)).await
            }
            UploadedDataSourceType::Explored => {
                let (service, dir, organization) = (
                    self.data_sources.clone(),
                    unpack_to.to_path_buf(),
                    organization.to_owned(),
                );
                let source =
                    blocking(move || Ok(service.data_source_from_dir(&dir, &organization, false)))
                        .await?;
                if let DataSource::Usable(usable) = source
                    && !usable.all_explicit_paths().iter().all(|p| {
                        self.data_sources
                            .vaults()
                            .path_is_allowed_to_add_directly(p)
                    })
                {
                    return Err(DsError::failure(
                        "Cannot upload a data source with local paths that leave the dataset, or with paths that match the WEBKNOSSOS reserved paths.",
                    ));
                }
                Ok(())
            }
            UploadedDataSourceType::Zarr
            | UploadedDataSourceType::Zarr3
            | UploadedDataSourceType::NeuroglancerPrecomputed
            | UploadedDataSourceType::N5Multiscales
            | UploadedDataSourceType::N5Array => {
                let header = match kind {
                    UploadedDataSourceType::Zarr => Some(FILENAME_DOT_ZARRAY),
                    UploadedDataSourceType::Zarr3 => Some(FILENAME_ZARR_JSON),
                    _ => None,
                };
                if let Some(header) = header {
                    let dir = unpack_to.to_path_buf();
                    blocking(move || add_layer_and_mag_dir_if_missing(&dir, header)).await?;
                }
                let explored = crate::explore::explore_local(
                    &self.explore_context(),
                    unpack_to,
                    source_id,
                    "",
                )
                .await?;
                let dir = unpack_to.to_path_buf();
                blocking(move || crate::explore::write_local_datasource_properties(&explored, &dir))
                    .await
            }
            UploadedDataSourceType::ZarrMultilayer
            | UploadedDataSourceType::Zarr3Multilayer
            | UploadedDataSourceType::NeuroglancerMultilayer
            | UploadedDataSourceType::N5Multilayer => {
                self.explore_multiple_layers(unpack_to, source_id, kind)
                    .await
            }
        }
    }

    fn explore_context(&self) -> crate::explore::ExploreContext {
        crate::explore::ExploreContext {
            vaults: self.data_sources.vaults().clone(),
            token: None,
        }
    }

    /// Scala `tryExploringMultipleLayers`.
    async fn explore_multiple_layers(
        &self,
        path: &Path,
        source_id: &crate::models::DataSourceId,
        kind: UploadedDataSourceType,
    ) -> DsResult<()> {
        let dir = path.to_path_buf();
        let layer_dirs = blocking(move || {
            let dirs = list_directories(&dir)?;
            Ok(match kind {
                UploadedDataSourceType::ZarrMultilayer => dirs
                    .into_iter()
                    .filter(|d| {
                        contains_matching_file(d, &[FILENAME_DOT_ZARRAY, FILENAME_DOT_ZATTRS], 2)
                    })
                    .collect(),
                UploadedDataSourceType::Zarr3Multilayer => dirs
                    .into_iter()
                    .filter(|d| contains_matching_file(d, &[FILENAME_ZARR_JSON], 2))
                    .collect(),
                _ => dirs,
            })
        })
        .await?;
        let ctx = self.explore_context();
        let mut sources = Vec::new();
        for layer_dir in layer_dirs {
            let layer = layer_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let dir = layer_dir.clone();
            blocking(move || add_layer_and_mag_dir_if_missing(&dir, FILENAME_HEADER_WKW)).await?;
            sources.push(crate::explore::explore_local(&ctx, path, source_id, &layer).await?);
        }
        let first = sources.first().ok_or_else(DsError::empty)?;
        let scale = first.scale;
        let layers = crate::explore::make_layer_names_unique(
            sources.into_iter().flat_map(|s| s.data_layers).collect(),
        );
        if !layers.is_empty() {
            let combined = UsableDataSource {
                id: source_id.clone(),
                data_layers: layers,
                scale,
                default_view_configuration: None,
                status_opt: None,
            };
            let dir = path.to_path_buf();
            blocking(move || crate::explore::write_local_datasource_properties(&combined, &dir))
                .await?;
        }
        Ok(())
    }

    /// Scala `moveUnpackedDatasetToTarget` (local and managed-S3 targets).
    async fn move_unpacked_dataset_to_target(
        &self,
        unpacked: &Path,
        needs_conversion: bool,
        dataset_id: &str,
        source: &crate::models::DataSourceId,
    ) -> DsResult<Option<UsableDataSource>> {
        let orga_dir = self.orga_dir(&source.organization_id)?;
        if needs_conversion {
            let target = orga_dir
                .join(crate::services::upload::FOR_CONVERSION_DIR)
                .join(&source.directory_name);
            tracing::info!(
                "finishUpload for {dataset_id}: Moving data to input dir for worker conversion..."
            );
            let from = unpacked.to_path_buf();
            blocking(move || move_directory(&from, &target)).await?;
            return Ok(None);
        }
        let (service, dir, organization) = (
            self.data_sources.clone(),
            unpacked.to_path_buf(),
            source.organization_id.clone(),
        );
        let from_dir =
            blocking(move || Ok(service.data_source_from_dir(&dir, &organization, false))).await?;
        let usable = match from_dir {
            DataSource::Usable(usable) => usable,
            DataSource::Unusable(unusable) => {
                return Err(DsError::failure(format!(
                    "Invalid dataset uploaded: {}",
                    unusable.status
                )));
            }
        };
        let (dir, referenced) = (unpacked.to_path_buf(), usable.clone());
        blocking(move || {
            delete_files_not_referenced(&dir, &referenced);
            Ok(())
        })
        .await?;
        let new_base = if let Some(base) = self.s3_upload_base(&source.organization_id) {
            let target = base.join(&source.directory_name);
            tracing::info!("finishUpload for {dataset_id}: Copying data to {target}...");
            self.data_sources
                .vaults()
                .upload_directory_to_s3(unpacked, &target)
                .await?;
            target
        } else {
            let target = orga_dir.join(&source.directory_name);
            tracing::info!(
                "finishUpload for {dataset_id}: Moving data to final local path {}...",
                target.display()
            );
            let (from, to) = (unpacked.to_path_buf(), target.clone());
            blocking(move || move_directory(&from, &to)).await?;
            UPath::from_local_path(&target)
        };
        let adapted = DataSourceService::resolve_paths_in_new_base_path(&usable, &new_base);
        let dir = unpacked.to_path_buf();
        let _ = blocking(move || delete_directory_recursively(&dir)).await;
        Ok(Some(adapted))
    }

    /// Scala `finishMagUpload` / `finishAttachmentUpload` (shared flow).
    pub async fn finish_mag_or_attachment_upload(
        &self,
        upload_id: &str,
        dataset_id: &str,
        domain: UploadDomain,
    ) -> DsResult<()> {
        let store = self.uploads.store(domain);
        let source = store
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let layer_name = store
            .find_extra_raw(upload_id, "layerName")
            .await?
            .ok_or_else(DsError::empty)?;
        let (mag, attachment) = match domain {
            UploadDomain::Mag => {
                let value = store
                    .find_extra_json(upload_id, "mag")
                    .await?
                    .ok_or_else(DsError::empty)?;
                let mag = MagLocator::from_json(&value)
                    .map_err(|e| DsError::failure(e.validation_failure_message()))?;
                (Some(mag), None)
            }
            _ => {
                let value = store
                    .find_extra_json(upload_id, "attachment")
                    .await?
                    .ok_or_else(DsError::empty)?;
                let attachment = LayerAttachment::from_json(&value)
                    .map_err(|e| DsError::failure(e.validation_failure_message()))?;
                let kind = store
                    .find_extra_json(upload_id, "attachmentType")
                    .await?
                    .ok_or_else(DsError::empty)?;
                let kind = LayerAttachmentType::from_json(&kind)
                    .map_err(|e| DsError::failure(e.validation_failure_message()))?;
                (None, Some((attachment, kind)))
            }
        };
        let upload_dir =
            self.uploads
                .upload_directory_for(&source.organization_id, upload_id, domain)?;
        let mut unpack_to = self.unpack_to_dir(&source, domain, upload_id)?;
        if let Some(mag) = &mag {
            unpack_to = unpack_to.join(mag.mag.to_mag_literal(true));
        }
        self.check_within_requested_file_size(&upload_dir, upload_id, dataset_id, domain)
            .await
            .map_err(|e| e.wrap("dataset.upload.fileSizeCheck.failed"))?;
        self.check_all_chunks_uploaded(upload_id, domain)
            .await
            .map_err(|e| e.wrap("dataset.upload.allChunksUploadedCheck.failed"))?;
        let (from, to, id) = (upload_dir.clone(), unpack_to.clone(), dataset_id.to_owned());
        let unpacked = blocking(move || unpack_or_move_uploaded(&from, &to, &id, domain)).await;
        self.clean_up_on_failure(
            domain,
            unpacked,
            dataset_id,
            &source,
            &unpack_to,
            &format!("unpacking {domain} to {}", unpack_to.display()),
        )
        .await?;
        self.uploads
            .clean_up_uploaded(upload_id, "Upload complete, data unpacked.", domain)
            .await?;
        let dir = unpack_to.clone();
        let size = blocking(move || size_of_directory(&dir).map_err(io_failure))
            .await
            .map_err(|e| e.wrap("dataset.upload.measureTotalSize.failed"))?;
        let dir_name = match (&mag, &attachment) {
            (Some(mag), _) => format!("{}__{}", mag.mag.to_mag_literal(true), generate_object_id()),
            (_, Some((attachment, kind))) => format!(
                "{kind}/{}__{}",
                normalize_strong_rendered(&attachment.name),
                generate_object_id()
            ),
            _ => unreachable!("mag or attachment"),
        };
        let final_path = if let Some(base) = self.s3_upload_base(&source.organization_id) {
            let target = base
                .join(&source.directory_name)
                .join(&layer_name)
                .join(&dir_name);
            tracing::info!("finishUpload for {domain} ({dataset_id}): Copying data to {target}...");
            self.data_sources
                .vaults()
                .upload_directory_to_s3(&unpack_to, &target)
                .await?;
            target
        } else {
            let target = self
                .orga_dir(&source.organization_id)?
                .join(&source.directory_name)
                .join(&layer_name)
                .join(&dir_name);
            tracing::info!(
                "finishUpload for {domain} ({dataset_id}): Moving data to final local path {}...",
                target.display()
            );
            let (from, to) = (unpack_to.clone(), target.clone());
            blocking(move || move_directory(&from, &to)).await?;
            UPath::from_local_path(&target)
        };
        match (mag, attachment) {
            (Some(mag), _) => {
                let mag = MagLocator {
                    path: Some(final_path),
                    ..mag
                };
                self.wk_client
                    .report_mag_upload(&json!({"datasetId": dataset_id, "layerName": layer_name, "mag": mag, "magSizeBytes": size}))
                    .await
            }
            (_, Some((attachment, kind))) => {
                let attachment = LayerAttachment {
                    path: final_path,
                    ..attachment
                };
                self.wk_client
                    .report_attachment_upload(&json!({"datasetId": dataset_id, "layerName": layer_name, "attachmentType": kind, "attachment": attachment, "attachmentSizeBytes": size}))
                    .await
            }
            _ => unreachable!("mag or attachment"),
        }
    }
}

/// Scala `deleteFilesNotReferencedInDataSource`: files outside explicit (zip: outer) paths and
/// implicit `<layer>/<mag>` directories are removed (failures only logged).
fn delete_files_not_referenced(unpacked: &Path, source: &UsableDataSource) {
    let mut referenced: Vec<PathBuf> = Vec::new();
    for layer in &source.data_layers {
        for path in layer.all_explicit_paths() {
            let path = match path {
                UPath::ZipEntry(outer, _) => outer.as_ref(),
                other => other,
            };
            if let Ok(local) = path.to_local_path() {
                referenced.push(unpacked.join(local));
            }
        }
        for mag in layer.mags.iter().filter(|m| m.path.is_none()) {
            referenced.push(
                unpacked
                    .join(&layer.name)
                    .join(mag.mag.to_mag_literal(true)),
            );
        }
    }
    let Ok(files) = list_files_recursive(unpacked, 10) else {
        return;
    };
    let to_delete: Vec<PathBuf> = files
        .into_iter()
        .filter(|f| !referenced.iter().any(|r| f.starts_with(r)))
        .collect();
    if !to_delete.is_empty() {
        tracing::info!(
            "Uploaded dataset contains files not referenced in the datasource. Deleting {to_delete:?}..."
        );
    }
    for file in to_delete {
        if let Err(e) = std::fs::remove_file(&file) {
            tracing::warn!(
                "Deletion failed for non-referenced file {} of uploaded dataset: {e}",
                file.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn finds_common_roots_like_scala() {
        let boundaries = vec!["color".to_owned(), "segmentation".to_owned()];
        assert_eq!(
            find_common_root_directory(&[p("ds/color/1/a"), p("ds/color/1/b")], &boundaries),
            p("ds")
        );
        assert_eq!(
            find_common_root_directory(&[p("ds/x/a"), p("ds/y/b")], &boundaries),
            p("ds")
        );
        assert_eq!(
            find_common_root_directory(&[p("color/1/a"), p("color/2/b")], &boundaries),
            p("")
        );
        assert_eq!(
            find_common_root_directory(&[p("ds/file.txt")], &boundaries),
            p("ds")
        );
        assert_eq!(
            find_common_root_directory(&[p("file.txt")], &boundaries),
            p("")
        );
        assert_eq!(common_prefix(&[p("/a/b/c"), p("/a/b/d")]), p("/a/b"));
    }

    #[test]
    fn renders_normalize_strong_options() {
        assert_eq!(
            normalize_strong_rendered("Mesh Ü-1.hdf5"),
            "Some(Mesh Ue-1hdf5)"
        );
        assert_eq!(normalize_strong_rendered("..."), "None");
    }

    #[test]
    fn generates_object_ids() {
        let a = generate_object_id();
        let b = generate_object_id();
        assert_eq!(a.len(), 24);
        assert_ne!(a, b);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    }
}
