//! `models.annotation.AnnotationUploadService` plus the upload helpers of
//! `AnnotationIOController` (`nameForUploaded`, `descriptionForNMLs`,
//! `wkUrlsForNMLs`, `returnError`, `findDatasetForUploadedAnnotations`) and
//! `DatasetDAO.findOneByIdOrNameAndOrganization`. Library only; the routes
//! (`POST /annotations/upload`, `POST /tasks/createFromFiles`) are documented in
//! `checkpoints/annotation-upload-service.md`.
//!
//! Extraction is split in a pure, CPU-bound step ([`prepare_files`]: unzip and
//! [`parse_nml`] every NML) and an async step ([`PreparedUpload::finish`]: one
//! dataset lookup per parsed NML, exactly where Scala interleaves its database
//! access). [`extract_from_files`] runs both, the first on the blocking pool.
//!
//! Uploaded files have no on-disk path here. Scala keys the other (non-NML)
//! zip entries by `file.getPath + entryName` and prefixes NML volume locations
//! with the same `file.getPath`; the Rust stand-in for `file.getPath` is
//! `upload-{index}/` for the n-th uploaded file and `{key}/` for a nested zip
//! that was stored under `key`. Only these keys are observable (as
//! `UploadedVolumeLayer::data_zip_location` and in the names of NMLs from nested
//! zips when `useZipName` is set, where Scala exposes its temp-file path).

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::io::{Cursor, Read};

use axum::{
    Json,
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use zip::ZipArchive;

use crate::dataset_access::READ_PREDICATE;
use crate::error::{ApiError, ApiResult};
use crate::nml_parser::{
    DatasetRef, NmlParseContext, NmlParseOutcome, NmlParseResult, SharedParsingParameters,
    UploadedVolumeLayer, file_name_without_extension, parse_nml,
};
use crate::proto::datastore::{SegmentGroup, SkeletonTracing, TreeGroup, VolumeTracing};

// ---------------------------------------------------------------------------
// Messages (util/Msg.scala)
// ---------------------------------------------------------------------------

/// `Msg.Nml.differentDatasets`.
pub const MSG_DIFFERENT_DATASETS: &str =
    "Cannot upload annotations that belong to different datasets at once.";
/// `Msg.Nml.uploadSuccess`.
pub const MSG_UPLOAD_SUCCESS: &str = "Successfully uploaded annotation file.";
/// `Msg.Nml.fileNotFound` (createFromFiles without .nml/.zip files).
pub const MSG_FILE_NOT_FOUND: &str = "Could not extract NML file.";
/// `returnError` when no file failed (all empty, or no files at all).
pub const MSG_UPLOAD_FAILED: &str = "NML upload failed";
/// `MultiNmlParseResult.toBoxes` for task creation.
pub const MSG_MULTI_LAYER_TASK_VOLUME: &str =
    "Cannot create tasks from multi-layer volume annotations.";
const MSG_NAME_NOT_UNIQUE: &str = "Multiple datasets with this name exist in this organization. Specify dataset id to select correct one.";

/// `Msg.Nml.parseFailed`.
pub fn msg_parse_failed(file_name: &str, error: &str) -> String {
    format!("Could not parse file “{file_name}”: {error}")
}

/// `Msg.Dataset.notFound(id: ObjectId)`.
pub fn msg_dataset_not_found(dataset_id: &str) -> String {
    format!("Dataset “{dataset_id}” could not be found or accessed.")
}

/// `Msg.Dataset.notFound(name: String)`.
pub fn msg_dataset_name_not_found(name: &str) -> String {
    format!("Dataset with name “{name}” could not be found or accessed.")
}

fn msg_dataset_not_found_wrong_host(dataset_id: &str, got_host: &str, this_host: &str) -> String {
    format!(
        "Dataset “{dataset_id}” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “{got_host}” while this instance is “{this_host}”."
    )
}

fn msg_organization_not_found(organization_id: &str) -> String {
    format!("Organization “{organization_id}” could not be found or accessed.")
}

fn msg_organization_not_found_wrong_host(
    organization_id: &str,
    got_host: &str,
    this_host: &str,
) -> String {
    format!(
        "Organization “{organization_id}” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “{got_host}” while this instance is “{this_host}”."
    )
}

// ---------------------------------------------------------------------------
// Result container (NmlResults.MultiNmlParseResult)
// ---------------------------------------------------------------------------

/// `NmlResults.MultiNmlParseResult`: per-NML results in Scala's order and the
/// other (non-NML) zip entries keyed by `path + entryName`, which
/// `UploadedVolumeLayer::data_zip_location` / `edited_mapping_edges_location`
/// reference.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MultiNmlParseResult {
    pub parse_results: Vec<NmlParseResult>,
    pub other_files: BTreeMap<String, Bytes>,
}

impl MultiNmlParseResult {
    /// `containsFailure` (empty results are not failures).
    pub fn contains_failure(&self) -> bool {
        self.parse_results
            .iter()
            .any(|r| matches!(r, NmlParseResult::Failure { .. }))
    }

    /// `UploadedVolumeLayer.getDataZipFrom`.
    pub fn data_zip_for(&self, layer: &UploadedVolumeLayer) -> Option<&Bytes> {
        self.other_files.get(&layer.data_zip_location)
    }

    /// `UploadedVolumeLayer.getEditableMappingEdgesZipFrom`.
    pub fn editable_mapping_edges_zip_for(&self, layer: &UploadedVolumeLayer) -> Option<&Bytes> {
        layer
            .edited_mapping_edges_location
            .as_ref()
            .and_then(|location| self.other_files.get(location))
    }

    /// `toBoxes` (task creation; single-layer volumes only), one container per
    /// parse result in order.
    pub fn to_boxes(&self) -> Vec<TracingBoxContainer> {
        self.parse_results
            .iter()
            .map(|result| match result.to_success() {
                Err(error) => TracingBoxContainer {
                    file_name: Err(error.clone()),
                    description: Err(error.clone()),
                    skeleton: Err(error.clone()),
                    volume: Err(error.clone()),
                    dataset_id: Err(error),
                },
                Ok(success) => {
                    let volume = match success.volume_layers.as_slice() {
                        [] => Ok(None),
                        [layer] => Ok(Some((layer.clone(), self.data_zip_for(layer).cloned()))),
                        _ => Err(MSG_MULTI_LAYER_TASK_VOLUME.to_owned()),
                    };
                    TracingBoxContainer {
                        file_name: Ok(result.file_name().to_owned()),
                        description: Ok(success.description.clone()),
                        skeleton: Ok(success.skeleton_tracing.clone()),
                        volume,
                        dataset_id: Ok(success.dataset_id.clone()),
                    }
                }
            })
            .collect()
    }
}

/// `NmlResults.TracingBoxContainer`. `Err` carries the Scala failure message
/// (`Couldn’t parse file: …` from `toSuccessBox`, or the multi-layer message);
/// `volume: Ok(None)` is Scala's `Empty` (skeleton-only file).
#[derive(Debug, Clone, PartialEq)]
pub struct TracingBoxContainer {
    pub file_name: Result<String, String>,
    pub description: Result<String, String>,
    pub skeleton: Result<SkeletonTracing, String>,
    pub volume: Result<Option<(UploadedVolumeLayer, Option<Bytes>)>, String>,
    pub dataset_id: Result<String, String>,
}

// ---------------------------------------------------------------------------
// Extraction limits (Rust-only; Scala has none besides the request body limit)
// ---------------------------------------------------------------------------

/// Bounds for zip extraction. Scala unzips without any limit (nested all-zip
/// archives even recurse without depth bound), so these are Rust additions
/// that guard against zip bombs; everything is held in memory here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtractionLimits {
    /// Maximum number of central-directory entries of a single archive.
    pub max_zip_entries: usize,
    /// Maximum total number of decompressed bytes over the whole upload.
    pub max_extracted_bytes: u64,
    /// Maximum nesting of zips that contain only zips (0 = no nested zip is
    /// unpacked recursively).
    pub max_zip_nesting_depth: usize,
}

impl Default for ExtractionLimits {
    fn default() -> Self {
        Self {
            max_zip_entries: 10_000,
            max_extracted_bytes: 2 * 1024 * 1024 * 1024,
            max_zip_nesting_depth: 8,
        }
    }
}

/// An extraction limit was exceeded; the whole upload is rejected (400).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractionLimitExceeded(pub String);

impl From<ExtractionLimitExceeded> for ApiError {
    fn from(error: ExtractionLimitExceeded) -> Self {
        ApiError::bad_request(error.0)
    }
}

// ---------------------------------------------------------------------------
// Extraction (extractFromFiles / extractFromZip / extractFromNml)
// ---------------------------------------------------------------------------

/// One NML parsed in [`prepare_files`], waiting for its dataset lookup.
#[derive(Debug, Clone, PartialEq)]
struct PendingNml {
    /// Name the result carries (file name, or zip entry path).
    file_name: String,
    outcome: NmlParseOutcome,
    /// `Some(zip path)` for NMLs from a zip (`nmlParametersToResult` basePath).
    base_path: Option<String>,
    /// `useZipName`: successes are renamed to the zip name.
    rename_to: Option<String>,
}

/// Result of the pure extraction step; [`PreparedUpload::finish`] performs the
/// per-NML dataset lookups.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedUpload {
    pending: Vec<PendingNml>,
    other_files: BTreeMap<String, Bytes>,
}

impl PreparedUpload {
    /// Number of NMLs found (each needs one dataset lookup).
    pub fn nml_count(&self) -> usize {
        self.pending.len()
    }

    /// Scala `extractFromNml` after parsing: validated dataset id, dataset lookup
    /// (`findOneByIdOrNameAndOrganization`), `nmlParametersToResult`, then
    /// `withName(zip name)` for `useZipName`. Lookups run serially in result order.
    pub async fn finish<L: DatasetLookup>(self, lookup: &L) -> ApiResult<MultiNmlParseResult> {
        let mut parse_results = Vec::with_capacity(self.pending.len());
        for pending in self.pending {
            let file_name = pending.file_name;
            let result = match pending.outcome {
                NmlParseOutcome::Empty => NmlParseResult::Empty { file_name },
                NmlParseOutcome::Failure(error) => NmlParseResult::Failure { file_name, error },
                NmlParseOutcome::Parsed(parsed) => {
                    let dataset = match parsed.validated_dataset_id() {
                        Err(error) => Err(error),
                        Ok(dataset_id) => {
                            lookup
                                .find_dataset(
                                    dataset_id.as_deref(),
                                    &parsed.dataset_name,
                                    &parsed.organization_id,
                                )
                                .await?
                        }
                    };
                    match dataset {
                        Ok(dataset) => NmlParseResult::Success {
                            file_name,
                            success: Box::new(
                                parsed.into_success(&dataset, pending.base_path.as_deref()),
                            ),
                        },
                        Err(error) => NmlParseResult::Failure { file_name, error },
                    }
                }
            };
            parse_results.push(match &pending.rename_to {
                Some(name) => result.with_name(name),
                None => result,
            });
        }
        Ok(MultiNmlParseResult {
            parse_results,
            other_files: self.other_files,
        })
    }
}

/// Scala `extractFromFiles(files, sharedParams)` (with `useZipName` passed
/// separately, as the parser's `SharedParsingParameters` lacks it): runs
/// [`prepare_files`] on the blocking pool with a fresh
/// [`NmlParseContext::current`] per NML, then [`PreparedUpload::finish`].
/// `files` are `(uploaded file name, bytes)` in request order.
pub async fn extract_from_files<L: DatasetLookup>(
    files: Vec<(String, Bytes)>,
    params: SharedParsingParameters,
    use_zip_name: bool,
    limits: ExtractionLimits,
    lookup: &L,
) -> ApiResult<MultiNmlParseResult> {
    let prepared = tokio::task::spawn_blocking(move || {
        prepare_files(
            files,
            &params,
            use_zip_name,
            &limits,
            &mut NmlParseContext::current,
        )
    })
    .await
    .map_err(|_| ApiError::internal())??;
    prepared.finish(lookup).await
}

/// Pure part of Scala `extractFromFiles`. `context` is called once per NML
/// (Scala's wall clock and random task-bounding-box colour per parse).
///
/// Scala semantics mirrored:
/// - a file whose name ends with `.zip` (case-sensitive) is opened as a zip;
///   unreadable zips are skipped silently. Every other file is parsed as an NML
///   under its own name (no base path, never renamed).
/// - a zip whose (non-directory, non-hidden) entries all end with `.zip` is
///   unpacked and each entry is processed again as an uploaded file named by
///   its key (`path + entryName`); only those nested results are kept.
/// - otherwise entries are processed in central-directory order: directories
///   (`…/`), hidden entries (last path component starting with `.`) and
///   `__MACOSX…` are skipped; an absolute or escaping (`..`) path stops the
///   archive (zip-slip guard of `ZipIO.withUnziped`, earlier entries are kept),
///   as does an unreadable entry. The Java-normalized entry path is the NML
///   name if it ends with `.nml`, else the entry is stored in `other_files`
///   under `path + entryPath`. NML results of one zip come out in reverse entry
///   order (Scala prepends them) and, with `use_zip_name`, carry the zip name.
/// - `combineWith`: results are appended; an existing other-file key wins.
pub fn prepare_files(
    files: Vec<(String, Bytes)>,
    params: &SharedParsingParameters,
    use_zip_name: bool,
    limits: &ExtractionLimits,
    context: &mut dyn FnMut() -> NmlParseContext,
) -> Result<PreparedUpload, ExtractionLimitExceeded> {
    let mut extractor = Extractor {
        params,
        use_zip_name,
        limits,
        context,
        extracted_bytes: 0,
    };
    let files = files
        .into_iter()
        .enumerate()
        .map(|(index, (name, bytes))| (format!("upload-{index}/"), name, bytes))
        .collect();
    let collected = extractor.files(files, 0)?;
    Ok(PreparedUpload {
        pending: collected.pending,
        other_files: collected.other_files.into_map(),
    })
}

/// Insertion-ordered other files (Scala `Map[String, File]`).
#[derive(Default)]
struct OtherFiles {
    entries: Vec<(String, Bytes)>,
    index: HashMap<String, usize>,
}

impl OtherFiles {
    /// `otherFiles += key -> file` (a later entry with the same key replaces it).
    fn insert(&mut self, key: String, bytes: Bytes) {
        match self.index.get(&key) {
            Some(&position) => self.entries[position].1 = bytes,
            None => {
                self.index.insert(key.clone(), self.entries.len());
                self.entries.push((key, bytes));
            }
        }
    }

    /// `other.otherFiles ++ otherFiles`: existing keys win.
    fn insert_if_absent(&mut self, key: String, bytes: Bytes) {
        if !self.index.contains_key(&key) {
            self.insert(key, bytes);
        }
    }

    fn into_map(self) -> BTreeMap<String, Bytes> {
        self.entries.into_iter().collect()
    }
}

#[derive(Default)]
struct Collected {
    pending: Vec<PendingNml>,
    other_files: OtherFiles,
}

impl Collected {
    /// `MultiNmlParseResult.combineWith`.
    fn combine_with(&mut self, other: Collected) {
        self.pending.extend(other.pending);
        for (key, bytes) in other.other_files.entries {
            self.other_files.insert_if_absent(key, bytes);
        }
    }
}

struct Extractor<'a> {
    params: &'a SharedParsingParameters,
    use_zip_name: bool,
    limits: &'a ExtractionLimits,
    context: &'a mut dyn FnMut() -> NmlParseContext,
    extracted_bytes: u64,
}

type Archive = ZipArchive<Cursor<Bytes>>;

impl Extractor<'_> {
    fn parse(&mut self, name: &str, bytes: &[u8]) -> NmlParseOutcome {
        let context = (self.context)();
        parse_nml(name, bytes, self.params, &context)
    }

    /// `extractFromFiles` (fold over `(path, name, bytes)`).
    fn files(
        &mut self,
        files: Vec<(String, String, Bytes)>,
        depth: usize,
    ) -> Result<Collected, ExtractionLimitExceeded> {
        let mut collected = Collected::default();
        for (path, name, bytes) in files {
            if !name.ends_with(".zip") {
                let outcome = self.parse(&name, &bytes);
                collected.pending.push(PendingNml {
                    file_name: name,
                    outcome,
                    base_path: None,
                    rename_to: None,
                });
                continue;
            }
            let Ok(mut archive) = ZipArchive::new(Cursor::new(bytes)) else {
                tracing::debug!("Skipping an uploaded zip that cannot be opened");
                continue;
            };
            if archive.len() > self.limits.max_zip_entries {
                return Err(ExtractionLimitExceeded(format!(
                    "Zip file “{name}” has more than {} entries.",
                    self.limits.max_zip_entries
                )));
            }
            if all_entries_are_zips(&archive) {
                if depth >= self.limits.max_zip_nesting_depth {
                    return Err(ExtractionLimitExceeded(format!(
                        "Zip files are nested deeper than {} levels.",
                        self.limits.max_zip_nesting_depth
                    )));
                }
                let unpacked = self.zip(&path, &name, &mut archive)?;
                let nested = unpacked
                    .other_files
                    .entries
                    .into_iter()
                    .map(|(key, bytes)| (format!("{key}/"), key, bytes))
                    .collect();
                collected.combine_with(self.files(nested, depth + 1)?);
            } else {
                let unpacked = self.zip(&path, &name, &mut archive)?;
                collected.combine_with(unpacked);
            }
        }
        Ok(collected)
    }

    /// `extractFromZip(file, Some(name))` over `ZipIO.withUnziped`.
    fn zip(
        &mut self,
        path: &str,
        name: &str,
        archive: &mut Archive,
    ) -> Result<Collected, ExtractionLimitExceeded> {
        let mut collected = Collected::default();
        for index in 0..archive.len() {
            let Some(Ok(raw_name)) = archive.name_for_index(index) else {
                break;
            };
            let raw_name = raw_name.into_owned();
            if is_directory_entry(&raw_name) || is_hidden_entry(&raw_name) {
                continue;
            }
            let Some(entry_path) = java_normalized_relative_path(&raw_name) else {
                tracing::warn!("Zip entry rejected as a potential zip slip attack");
                break;
            };
            let Some(bytes) = self.read_entry(archive, index)? else {
                break;
            };
            if entry_path.ends_with(".nml") {
                let outcome = self.parse(&entry_path, &bytes);
                collected.pending.push(PendingNml {
                    file_name: entry_path,
                    outcome,
                    base_path: Some(path.to_owned()),
                    rename_to: self.use_zip_name.then(|| name.to_owned()),
                });
            } else {
                collected
                    .other_files
                    .insert(format!("{path}{entry_path}"), Bytes::from(bytes));
            }
        }
        // `pendingResults ::= parsedResult` prepends.
        collected.pending.reverse();
        Ok(collected)
    }

    /// Decompresses one entry within the remaining byte budget. `Ok(None)` is
    /// an unreadable entry (stops the archive like Scala's caught exception).
    fn read_entry(
        &mut self,
        archive: &mut Archive,
        index: usize,
    ) -> Result<Option<Vec<u8>>, ExtractionLimitExceeded> {
        let remaining = self
            .limits
            .max_extracted_bytes
            .saturating_sub(self.extracted_bytes);
        let Ok(entry) = archive.by_index(index) else {
            return Ok(None);
        };
        let capacity = entry.size().min(remaining).min(64 * 1024 * 1024);
        let mut bytes = Vec::with_capacity(usize::try_from(capacity).unwrap_or(0));
        if entry
            .take(remaining.saturating_add(1))
            .read_to_end(&mut bytes)
            .is_err()
        {
            return Ok(None);
        }
        let read = bytes.len() as u64;
        if read > remaining {
            return Err(ExtractionLimitExceeded(format!(
                "Uploaded zip files extract to more than {} bytes.",
                self.limits.max_extracted_bytes
            )));
        }
        self.extracted_bytes += read;
        Ok(Some(bytes))
    }
}

/// `ZipEntry.isDirectory`.
fn is_directory_entry(raw_name: &str) -> bool {
    raw_name.ends_with('/')
}

/// `ZipIO.isFileHidden`: `new File(name).isHidden` (Unix: last path component
/// starts with `.`) or a `__MACOSX` prefix.
fn is_hidden_entry(raw_name: &str) -> bool {
    let last = raw_name
        .split('/')
        .rev()
        .find(|component| !component.is_empty())
        .unwrap_or("");
    last.starts_with('.') || raw_name.starts_with("__MACOSX")
}

/// `ZipIO.forallZipEntries(zip)(_.getName.endsWith(".zip"))` (raw names,
/// directories and hidden entries excluded; vacuously true for empty zips).
fn all_entries_are_zips(archive: &Archive) -> bool {
    (0..archive.len()).all(|index| match archive.name_for_index(index) {
        Some(Ok(name)) => {
            is_directory_entry(&name) || is_hidden_entry(&name) || name.ends_with(".zip")
        }
        _ => false,
    })
}

/// `Path.of(name).normalize()` on Unix with ZipIO's zip-slip checks: `None` for
/// absolute paths and paths starting with a `..` component.
fn java_normalized_relative_path(raw_name: &str) -> Option<String> {
    if raw_name.starts_with('/') {
        return None;
    }
    let mut components: Vec<&str> = Vec::new();
    for component in raw_name.split('/') {
        match component {
            "" | "." => {}
            ".." => match components.last() {
                Some(&last) if last != ".." => {
                    components.pop();
                }
                _ => components.push(".."),
            },
            other => components.push(other),
        }
    }
    if components.first() == Some(&"..") {
        return None;
    }
    Some(components.join("/"))
}

// ---------------------------------------------------------------------------
// Dataset lookup (DatasetDAO.findOneByIdOrNameAndOrganization)
// ---------------------------------------------------------------------------

/// The per-NML dataset lookup of [`PreparedUpload::finish`]. The inner `Err`
/// is the formatted failure chain that becomes the `NmlParseFailure` error;
/// the outer error is an infrastructure failure that aborts the request.
pub trait DatasetLookup: Sync {
    fn find_dataset(
        &self,
        dataset_id: Option<&str>,
        dataset_name: &str,
        organization_id: &str,
    ) -> impl Future<Output = ApiResult<Result<DatasetRef, String>>> + Send;
}

/// [`find_one_by_id_or_name_and_organization`] with the requesting user's
/// dataset read access (Scala's request `DBAccessContext`).
#[derive(Debug, Clone)]
pub struct PgDatasetLookup {
    pub pool: PgPool,
    pub user_id: String,
}

impl DatasetLookup for PgDatasetLookup {
    fn find_dataset(
        &self,
        dataset_id: Option<&str>,
        dataset_name: &str,
        organization_id: &str,
    ) -> impl Future<Output = ApiResult<Result<DatasetRef, String>>> + Send {
        find_one_by_id_or_name_and_organization(
            &self.pool,
            &self.user_id,
            dataset_id,
            dataset_name,
            organization_id,
        )
    }
}

type DatasetRow = (String, String, String);

fn dataset_ref((id, name, organization_id): DatasetRow) -> DatasetRef {
    DatasetRef {
        id,
        name,
        organization_id,
    }
}

/// `DatasetDAO.findOne(id)` with the user's read access (`datasets_`, i.e. not
/// deleted).
pub async fn find_readable_dataset(
    pool: &PgPool,
    user_id: &str,
    dataset_id: &str,
) -> ApiResult<Option<DatasetRef>> {
    let row: Option<DatasetRow> = sqlx::query_as(&format!(
        "SELECT d._id, d.name, d._organization FROM webknossos.datasets_ d
         WHERE d._id = $3 AND {READ_PREDICATE}"
    ))
    .bind(user_id)
    .bind(None::<&str>)
    .bind(dataset_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(dataset_ref))
}

/// `DatasetDAO.findOneByIdOrNameAndOrganization` with the user's read access:
/// by id (`Dataset “id” could not be found or accessed.`), else by directory
/// name in the organization (oldest first), else by name if unique in the
/// organization (`Dataset with name “n” could not be found or accessed.`, with
/// `<~ Multiple datasets with this name exist …` when ambiguous). The
/// organization itself is not access-checked, as in Scala.
pub async fn find_one_by_id_or_name_and_organization(
    pool: &PgPool,
    user_id: &str,
    dataset_id: Option<&str>,
    dataset_name: &str,
    organization_id: &str,
) -> ApiResult<Result<DatasetRef, String>> {
    if let Some(dataset_id) = dataset_id {
        return Ok(find_readable_dataset(pool, user_id, dataset_id)
            .await?
            .ok_or_else(|| msg_dataset_not_found(dataset_id)));
    }
    let by_directory_name: Option<DatasetRow> = sqlx::query_as(&format!(
        "SELECT d._id, d.name, d._organization FROM webknossos.datasets_ d
         WHERE d.directoryName = $3 AND d._organization = $4 AND {READ_PREDICATE}
         ORDER BY d.created ASC LIMIT 1"
    ))
    .bind(user_id)
    .bind(None::<&str>)
    .bind(dataset_name)
    .bind(organization_id)
    .fetch_optional(pool)
    .await?;
    if let Some(row) = by_directory_name {
        return Ok(Ok(dataset_ref(row)));
    }
    let mut by_name: Vec<DatasetRow> = sqlx::query_as(&format!(
        "SELECT d._id, d.name, d._organization FROM webknossos.datasets_ d
         WHERE d.name = $3 AND d._organization = $4 AND {READ_PREDICATE}
         LIMIT 2"
    ))
    .bind(user_id)
    .bind(None::<&str>)
    .bind(dataset_name)
    .bind(organization_id)
    .fetch_all(pool)
    .await?;
    Ok(match by_name.len() {
        0 => Err(msg_dataset_name_not_found(dataset_name)),
        1 => Ok(dataset_ref(by_name.remove(0))),
        _ => Err(format!(
            "{} <~ {MSG_NAME_NOT_UNIQUE}",
            msg_dataset_name_not_found(dataset_name)
        )),
    })
}

// ---------------------------------------------------------------------------
// wrapOrPrefixGroups
// ---------------------------------------------------------------------------

/// `wrapOrPrefixGroups`: with `create_group_for_each_file`, each success's
/// trees (and each volume layer's segments) are wrapped in one new group named
/// after the file name without `.nml`/`.zip`; otherwise, if there is more than
/// one result (failures count), tree names get the prefix
/// `fileName-without-last-extension_`. Segments are never renamed.
pub fn wrap_or_prefix_groups(
    parse_results: Vec<NmlParseResult>,
    create_group_for_each_file: bool,
) -> Vec<NmlParseResult> {
    if create_group_for_each_file {
        parse_results.into_iter().map(wrap_in_groups).collect()
    } else if parse_results.len() > 1 {
        parse_results
            .into_iter()
            .map(add_prefix_to_tree_names)
            .collect()
    } else {
        parse_results
    }
}

fn add_prefix_to_tree_names(result: NmlParseResult) -> NmlParseResult {
    match result {
        NmlParseResult::Success {
            file_name,
            mut success,
        } => {
            // `name.replaceAll("\\.[^.]*$", "")`: drop from the last dot.
            let stem = file_name
                .rfind('.')
                .map_or(&file_name[..], |dot| &file_name[..dot]);
            let prefix = format!("{stem}_");
            for tree in &mut success.skeleton_tracing.trees {
                tree.name = format!("{prefix}{}", tree.name);
            }
            NmlParseResult::Success { file_name, success }
        }
        other => other,
    }
}

fn wrap_in_groups(result: NmlParseResult) -> NmlParseResult {
    match result {
        NmlParseResult::Success {
            file_name,
            mut success,
        } => {
            let name = file_name_without_extension(&file_name).to_owned();
            wrap_trees_in_group(&name, &mut success.skeleton_tracing);
            for layer in &mut success.volume_layers {
                wrap_segments_in_group(&name, &mut layer.tracing);
            }
            NmlParseResult::Success { file_name, success }
        }
        other => other,
    }
}

/// `GroupUtils.getMaximumTreeGroupId` (0 for no groups).
fn maximum_tree_group_id(groups: &[TreeGroup]) -> i32 {
    groups
        .iter()
        .map(|g| g.group_id.max(maximum_tree_group_id(&g.children)))
        .max()
        .unwrap_or(0)
}

/// `GroupUtils.getMaximumSegmentGroupId` (0 for no groups).
fn maximum_segment_group_id(groups: &[SegmentGroup]) -> i32 {
    groups
        .iter()
        .map(|g| g.group_id.max(maximum_segment_group_id(&g.children)))
        .max()
        .unwrap_or(0)
}

fn wrap_trees_in_group(name: &str, tracing: &mut SkeletonTracing) {
    if tracing.trees.is_empty() && tracing.tree_groups.is_empty() {
        return;
    }
    let unused_group_id = maximum_tree_group_id(&tracing.tree_groups).wrapping_add(1);
    for tree in &mut tracing.trees {
        tree.group_id = Some(tree.group_id.unwrap_or(unused_group_id));
    }
    let children = std::mem::take(&mut tracing.tree_groups);
    tracing.tree_groups = vec![TreeGroup {
        name: name.to_owned(),
        group_id: unused_group_id,
        children,
        is_expanded: Some(true),
    }];
}

fn wrap_segments_in_group(name: &str, tracing: &mut VolumeTracing) {
    if tracing.segments.is_empty() && tracing.segment_groups.is_empty() {
        return;
    }
    let unused_group_id = maximum_segment_group_id(&tracing.segment_groups).wrapping_add(1);
    for segment in &mut tracing.segments {
        segment.group_id = Some(segment.group_id.unwrap_or(unused_group_id));
    }
    let children = std::mem::take(&mut tracing.segment_groups);
    tracing.segment_groups = vec![SegmentGroup {
        name: name.to_owned(),
        group_id: unused_group_id,
        children,
        is_expanded: None,
    }];
}

// ---------------------------------------------------------------------------
// AnnotationIOController helpers
// ---------------------------------------------------------------------------

/// Java regex `$` without MULTILINE: end of input, or before a final line
/// terminator.
fn strip_suffix_before_final_terminator(text: &str, suffix: &str) -> Option<String> {
    if let Some(stem) = text.strip_suffix(suffix) {
        return Some(stem.to_owned());
    }
    ["\r\n", "\n", "\r", "\u{85}", "\u{2028}", "\u{2029}"]
        .iter()
        .find_map(|terminator| {
            text.strip_suffix(terminator)
                .and_then(|body| body.strip_suffix(suffix))
                .map(|stem| format!("{stem}{terminator}"))
        })
}

/// `nameForUploaded`: for exactly one (successful) file its name with a
/// trailing `.nml` and every `.zip` occurrence removed, else `None`.
pub fn name_for_uploaded(file_names: &[&str]) -> Option<String> {
    match file_names {
        [name] => {
            let without_nml =
                strip_suffix_before_final_terminator(name, ".nml").unwrap_or((*name).to_owned());
            Some(without_nml.replace(".zip", ""))
        }
        _ => None,
    }
}

/// Java `String.trim` (strips code points <= U+0020).
fn java_trim(text: &str) -> &str {
    text.trim_matches(|c: char| c <= ' ')
}

/// `descriptionForNMLs`: the unique non-empty (then trimmed) description, else "".
pub fn description_for_nmls(descriptions: &[Option<&str>]) -> String {
    let non_empty: Vec<&str> = descriptions
        .iter()
        .flatten()
        .filter(|d| !d.is_empty())
        .map(|d| java_trim(d))
        .collect();
    find_unique_element(&non_empty)
        .map(|d| (*d).to_owned())
        .unwrap_or_default()
}

/// `wkUrlsForNMLs`: the wkUrl if all files agree on it (`None`s count as one
/// distinct value), else "".
pub fn wk_urls_for_nmls(wk_urls: &[Option<&str>]) -> String {
    match find_unique_element(wk_urls) {
        Some(Some(url)) => (*url).to_owned(),
        _ => String::new(),
    }
}

/// `SequenceUtils.findUniqueElement`.
fn find_unique_element<T: PartialEq>(items: &[T]) -> Option<&T> {
    let first = items.first()?;
    items.iter().all(|item| item == first).then_some(first)
}

/// `nameForUploaded`, `descriptionForNMLs` and `wkUrlsForNMLs` over the
/// successful results (the upload route's `parseResultsFiltered`).
pub fn upload_metadata(successes: &[NmlParseResult]) -> (Option<String>, String, String) {
    let names: Vec<&str> = successes.iter().map(NmlParseResult::file_name).collect();
    let descriptions: Vec<Option<&str>> =
        successes.iter().map(NmlParseResult::description).collect();
    let wk_urls: Vec<Option<&str>> = successes
        .iter()
        .map(|r| r.to_success().ok().and_then(|s| s.wk_url.as_deref()))
        .collect();
    (
        name_for_uploaded(&names),
        description_for_nmls(&descriptions),
        wk_urls_for_nmls(&wk_urls),
    )
}

/// Messages of `returnError`: one `Could not parse file “f”: error` per failed
/// result (empty results are skipped), in result order.
pub fn upload_error_messages(parse_results: &[NmlParseResult]) -> Vec<String> {
    parse_results
        .iter()
        .filter_map(|result| match result {
            NmlParseResult::Failure { file_name, error } => {
                Some(msg_parse_failed(file_name, error))
            }
            _ => None,
        })
        .collect()
}

/// `returnError` as rendered by `ExtendedController.boxToResult`: 400 with
/// `{"messages": [{"error": …}, …]}` listing every failed file, or
/// `{"messages": [{"error": "NML upload failed"}]}` when nothing failed.
/// Pass the unwrapped extraction results (Scala uses `parsedFiles`).
pub fn return_error(parse_results: &[NmlParseResult]) -> Response {
    let messages = upload_error_messages(parse_results);
    if messages.is_empty() {
        return ApiError::bad_request(MSG_UPLOAD_FAILED).into_response();
    }
    let messages: Vec<Value> = messages
        .into_iter()
        .map(|message| json!({ "error": message }))
        .collect();
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "messages": messages })),
    )
        .into_response()
}

/// Pure part of `findDatasetForUploadedAnnotations`: the unique dataset id
/// (`SequenceUtils.findUniqueElement`) and `assertAllOnSameOrganization`
/// (tracings without organization are ignored), both failing with
/// `Msg.Nml.differentDatasets` (400). Returns `(dataset id, organization id)`.
pub fn uploaded_annotations_dataset_and_organization(
    skeletons: &[&SkeletonTracing],
    volumes: &[&UploadedVolumeLayer],
    dataset_ids: &[&str],
) -> ApiResult<(String, Option<String>)> {
    let dataset_id = find_unique_element(dataset_ids)
        .ok_or_else(|| ApiError::bad_request(MSG_DIFFERENT_DATASETS))?;
    let organization_ids: Vec<&str> = skeletons
        .iter()
        .filter_map(|s| s.organization_id.as_deref())
        .chain(
            volumes
                .iter()
                .filter_map(|v| v.tracing.organization_id.as_deref()),
        )
        .collect();
    if let Some(first) = organization_ids.first()
        && organization_ids.iter().any(|id| id != first)
    {
        return Err(ApiError::bad_request(MSG_DIFFERENT_DATASETS));
    }
    Ok((
        (*dataset_id).to_owned(),
        organization_ids.first().map(|id| (*id).to_owned()),
    ))
}

/// `findDatasetForUploadedAnnotations`. `this_host` is `conf.Http.uri`
/// (the public URL without trailing slash); `wk_url` comes from
/// [`wk_urls_for_nmls`]. Statuses and messages as in Scala:
/// different datasets/organizations → 400; organization missing → 404
/// (`Organization “o” could not be found or accessed.`, wrong-host variant when
/// the files name another non-empty wkUrl); dataset unreadable → 403
/// (`Dataset “id” …`, wrong-host variant likewise); dataset of another
/// organization → 403 `Dataset “id” could not be found or accessed.`
pub async fn find_dataset_for_uploaded_annotations(
    pool: &PgPool,
    user_id: &str,
    this_host: &str,
    skeletons: &[&SkeletonTracing],
    volumes: &[&UploadedVolumeLayer],
    dataset_ids: &[&str],
    wk_url: &str,
) -> ApiResult<DatasetRef> {
    let (dataset_id, organization_id) =
        uploaded_annotations_dataset_and_organization(skeletons, volumes, dataset_ids)?;
    let wrong_host = !wk_url.is_empty() && this_host != wk_url;
    let organization_id = match organization_id {
        Some(organization_id) => {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id = $1)",
            )
            .bind(&organization_id)
            .fetch_one(pool)
            .await?;
            if !exists {
                return Err(ApiError::not_found(if wrong_host {
                    msg_organization_not_found_wrong_host(&organization_id, wk_url, this_host)
                } else {
                    msg_organization_not_found(&organization_id)
                }));
            }
            organization_id
        }
        None => sqlx::query_scalar::<_, String>(
            "SELECT o._id FROM webknossos.organizations_ o
             JOIN webknossos.datasets_ d ON o._id = d._organization WHERE d._id = $1",
        )
        .bind(&dataset_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::forbidden(msg_dataset_not_found(&dataset_id)))?,
    };
    let dataset = find_readable_dataset(pool, user_id, &dataset_id)
        .await?
        .ok_or_else(|| {
            ApiError::forbidden(if wrong_host {
                msg_dataset_not_found_wrong_host(&dataset_id, wk_url, this_host)
            } else {
                msg_dataset_not_found(&dataset_id)
            })
        })?;
    if dataset.organization_id != organization_id {
        return Err(ApiError::forbidden(msg_dataset_not_found(&dataset_id)));
    }
    Ok(dataset)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;

    use super::*;
    use crate::nml_parser::NmlParseSuccessWithoutFile;
    use crate::proto::datastore::{ColorProto, Segment, Tree};

    const DATASET_ID: &str = "5f0000000000000000000abc";

    fn params() -> SharedParsingParameters {
        SharedParsingParameters {
            user_organization_id: "org".to_owned(),
            ..Default::default()
        }
    }

    fn context() -> NmlParseContext {
        NmlParseContext {
            now_millis: 1,
            task_bounding_box_color: ColorProto {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        }
    }

    /// NML with one tree named `tree`, optionally a volume at `location`.
    fn nml(volume_location: Option<&str>) -> Bytes {
        let volume = volume_location
            .map(|l| format!(r#"<volume id="0" location="{l}" name="v"/>"#))
            .unwrap_or_default();
        Bytes::from(format!(
            r#"<things><parameters><experiment name="ds" description="d"/></parameters>
<thing id="1" name="tree"><nodes><node id="1" x="1" y="2" z="3"/></nodes><edges/></thing>{volume}</things>"#
        ))
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> Bytes {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            if name.ends_with('/') {
                writer
                    .add_directory(*name, SimpleFileOptions::default())
                    .unwrap();
            } else {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(bytes).unwrap();
            }
        }
        Bytes::from(writer.finish().unwrap().into_inner())
    }

    struct TestLookup;

    impl DatasetLookup for TestLookup {
        fn find_dataset(
            &self,
            dataset_id: Option<&str>,
            dataset_name: &str,
            organization_id: &str,
        ) -> impl Future<Output = ApiResult<Result<DatasetRef, String>>> + Send {
            let result = if dataset_name == "ds" && dataset_id.is_none() {
                Ok(DatasetRef {
                    id: DATASET_ID.to_owned(),
                    name: "ds".to_owned(),
                    organization_id: organization_id.to_owned(),
                })
            } else {
                Err(msg_dataset_name_not_found(dataset_name))
            };
            std::future::ready(Ok(result))
        }
    }

    fn extract_with(
        files: Vec<(&str, Bytes)>,
        use_zip_name: bool,
        limits: ExtractionLimits,
    ) -> Result<MultiNmlParseResult, ExtractionLimitExceeded> {
        let files = files
            .into_iter()
            .map(|(name, bytes)| (name.to_owned(), bytes))
            .collect();
        let prepared = prepare_files(files, &params(), use_zip_name, &limits, &mut context)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        Ok(runtime.block_on(prepared.finish(&TestLookup)).unwrap())
    }

    fn extract(files: Vec<(&str, Bytes)>, use_zip_name: bool) -> MultiNmlParseResult {
        extract_with(files, use_zip_name, ExtractionLimits::default()).unwrap()
    }

    fn names(result: &MultiNmlParseResult) -> Vec<(&str, bool)> {
        result
            .parse_results
            .iter()
            .map(|r| (r.file_name(), r.succeeded()))
            .collect()
    }

    fn success(result: &NmlParseResult) -> &NmlParseSuccessWithoutFile {
        result.to_success().unwrap()
    }

    #[test]
    fn plain_nml_files_are_parsed_in_order_without_base_path() {
        let result = extract(
            vec![
                ("a.nml", nml(Some("data.zip"))),
                ("b.txt", Bytes::from_static(b"<things>")),
                ("c.nml", Bytes::new()),
                ("FOO.ZIP", Bytes::from_static(b"not xml")),
            ],
            true,
        );
        assert_eq!(
            names(&result),
            vec![
                ("a.nml", true),
                ("b.txt", false),
                ("c.nml", false),
                ("FOO.ZIP", false)
            ]
        );
        assert!(matches!(
            result.parse_results[2],
            NmlParseResult::Empty { .. }
        ));
        assert!(result.contains_failure());
        let layer = &success(&result.parse_results[0]).volume_layers[0];
        assert_eq!(layer.data_zip_location, "data.zip");
        assert!(result.other_files.is_empty());
    }

    #[test]
    fn zip_entries_are_parsed_reversed_renamed_and_keyed_by_path() {
        let other_nml = String::from_utf8(nml(None).to_vec())
            .unwrap()
            .replace(r#"name="ds""#, r#"name="missing""#);
        let archive = zip_of(&[
            ("dir/", b""),
            ("dir/first.nml", &nml(Some("volume.zip"))),
            ("./volume.zip", b"VOLUME"),
            (".hidden.nml", b"x"),
            ("__MACOSX/._first.nml", b"x"),
            ("second.nml", other_nml.as_bytes()),
        ]);
        let renamed = extract(vec![("up.zip", archive.clone())], true);
        // Failures keep their entry name; successes carry the zip name.
        assert_eq!(
            names(&renamed),
            vec![("second.nml", false), ("up.zip", true)]
        );
        let NmlParseResult::Failure { error, .. } = &renamed.parse_results[0] else {
            panic!("expected failure");
        };
        assert_eq!(
            error,
            "Dataset with name “missing” could not be found or accessed."
        );
        let layer = &success(&renamed.parse_results[1]).volume_layers[0];
        assert_eq!(layer.data_zip_location, "upload-0/volume.zip");
        assert_eq!(
            renamed.data_zip_for(layer).map(|b| b.as_ref()),
            Some(&b"VOLUME"[..])
        );
        assert_eq!(
            renamed.other_files.keys().collect::<Vec<_>>(),
            vec!["upload-0/volume.zip"]
        );

        let kept = extract(vec![("up.zip", archive)], false);
        assert_eq!(
            names(&kept),
            vec![("second.nml", false), ("dir/first.nml", true)]
        );
        // to_boxes: the failure propagates, the success carries its data zip.
        let boxes = kept.to_boxes();
        assert_eq!(
            boxes[0].skeleton.as_ref().unwrap_err(),
            "Couldn’t parse file: second.nml. Dataset with name “missing” could not be found or accessed."
        );
        let (layer, data) = boxes[1].volume.clone().unwrap().unwrap();
        assert_eq!(layer.name.as_deref(), Some("v"));
        assert_eq!(data.as_deref(), Some(&b"VOLUME"[..]));
        assert_eq!(boxes[1].dataset_id.as_deref(), Ok(DATASET_ID));
    }

    #[test]
    fn nested_zips_are_unpacked_recursively_only_when_all_entries_are_zips() {
        let inner_a = zip_of(&[("a.nml", &nml(Some("v.zip"))), ("v.zip", b"V")]);
        let inner_b = zip_of(&[("b.nml", &nml(None))]);
        let outer = zip_of(&[("x/a.zip", &inner_a), ("b.zip", &inner_b), ("x/", b"")]);
        let result = extract(vec![("first.nml", nml(None)), ("outer.zip", outer)], true);
        assert_eq!(
            names(&result),
            vec![
                ("first.nml", true),
                ("upload-1/x/a.zip", true),
                ("upload-1/b.zip", true)
            ]
        );
        let layer = &success(&result.parse_results[1]).volume_layers[0];
        assert_eq!(layer.data_zip_location, "upload-1/x/a.zip/v.zip");
        // Only nested results are kept; the nested zips themselves are not other files.
        assert_eq!(
            result.other_files.keys().collect::<Vec<_>>(),
            vec!["upload-1/x/a.zip/v.zip"]
        );

        // A zip mixing NMLs and zips stores the inner zip as an other file.
        let mixed = zip_of(&[("m.nml", &nml(None)), ("inner.zip", &inner_b)]);
        let result = extract(vec![("mixed.zip", mixed)], false);
        assert_eq!(names(&result), vec![("m.nml", true)]);
        assert_eq!(
            result.other_files.keys().collect::<Vec<_>>(),
            vec!["upload-0/inner.zip"]
        );

        // Empty and unreadable zips contribute nothing.
        let result = extract(
            vec![
                ("empty.zip", zip_of(&[])),
                ("broken.zip", Bytes::from_static(b"PK nope")),
            ],
            true,
        );
        assert!(result.parse_results.is_empty() && result.other_files.is_empty());
    }

    #[test]
    fn zip_slip_entries_stop_the_archive_but_keep_earlier_entries() {
        let archive = zip_of(&[
            ("ok.nml", &nml(None)),
            ("a/../b.nml", &nml(None)),
            ("a/../../evil.nml", &nml(None)),
            ("late.nml", &nml(None)),
        ]);
        let result = extract(vec![("z.zip", archive)], false);
        assert_eq!(names(&result), vec![("b.nml", true), ("ok.nml", true)]);
        let absolute = zip_of(&[("/abs.nml", &nml(None)), ("after.nml", &nml(None))]);
        assert!(
            extract(vec![("z.zip", absolute)], false)
                .parse_results
                .is_empty()
        );
    }

    #[test]
    fn extraction_limits_are_enforced() {
        let limits = ExtractionLimits {
            max_zip_entries: 2,
            max_extracted_bytes: 10,
            max_zip_nesting_depth: 1,
        };
        let many = zip_of(&[("1", b""), ("2", b""), ("3", b"")]);
        assert!(extract_with(vec![("m.zip", many)], false, limits).is_err());
        let big = zip_of(&[("big.bin", &[0u8; 11])]);
        assert!(extract_with(vec![("b.zip", big)], false, limits).is_err());
        let fits = zip_of(&[("small.bin", &[0u8; 10])]);
        assert_eq!(
            extract_with(vec![("s.zip", fits)], false, limits)
                .unwrap()
                .other_files
                .len(),
            1
        );
        // One all-zip level is unpacked; the inner zip holds an NML, not only zips.
        let limits = ExtractionLimits {
            max_extracted_bytes: 1 << 20,
            ..limits
        };
        let one_level = zip_of(&[("i.zip", &zip_of(&[("a.nml", b"")]))]);
        let result = extract_with(vec![("l0.zip", one_level.clone())], false, limits).unwrap();
        assert_eq!(names(&result), vec![("a.nml", false)]);
        let two_levels = zip_of(&[("o.zip", &one_level)]);
        assert!(extract_with(vec![("l0.zip", two_levels)], false, limits).is_err());
    }

    #[test]
    fn entry_path_helpers_follow_java() {
        assert_eq!(
            java_normalized_relative_path("a//./b/../c.nml").as_deref(),
            Some("a/c.nml")
        );
        assert_eq!(java_normalized_relative_path("a/..").as_deref(), Some(""));
        assert_eq!(
            java_normalized_relative_path("..x/y").as_deref(),
            Some("..x/y")
        );
        assert_eq!(java_normalized_relative_path("../y"), None);
        assert_eq!(java_normalized_relative_path("/y"), None);
        assert!(is_hidden_entry("a/.b") && is_hidden_entry(".a/") && is_hidden_entry("__MACOSXy"));
        assert!(!is_hidden_entry(".a/b") && !is_hidden_entry("a.b"));
    }

    fn tree(name: &str, group_id: Option<i32>) -> Tree {
        Tree {
            name: name.to_owned(),
            group_id,
            ..Default::default()
        }
    }

    fn success_result(file_name: &str, trees: Vec<Tree>, groups: Vec<TreeGroup>) -> NmlParseResult {
        NmlParseResult::Success {
            file_name: file_name.to_owned(),
            success: Box::new(NmlParseSuccessWithoutFile {
                skeleton_tracing: SkeletonTracing {
                    trees,
                    tree_groups: groups,
                    ..Default::default()
                },
                volume_layers: vec![UploadedVolumeLayer {
                    tracing: VolumeTracing {
                        segments: vec![Segment {
                            segment_id: 1,
                            ..Default::default()
                        }],
                        segment_groups: vec![SegmentGroup {
                            name: "sg".to_owned(),
                            group_id: 4,
                            children: vec![],
                            is_expanded: None,
                        }],
                        ..Default::default()
                    },
                    data_zip_location: String::new(),
                    name: None,
                    edited_mapping_edges_location: None,
                    edited_mapping_base_mapping_name: None,
                }],
                dataset_id: DATASET_ID.to_owned(),
                description: String::new(),
                wk_url: None,
            }),
        }
    }

    fn group(name: &str, group_id: i32, children: Vec<TreeGroup>) -> TreeGroup {
        TreeGroup {
            name: name.to_owned(),
            group_id,
            children,
            is_expanded: None,
        }
    }

    #[test]
    fn groups_are_wrapped_per_file() {
        let results = vec![
            success_result(
                "Some.File.NML",
                vec![tree("a", None), tree("b", Some(2))],
                vec![group("g", 2, vec![group("deep", 7, vec![])])],
            ),
            success_result("empty.zip", vec![], vec![]),
            NmlParseResult::Empty {
                file_name: "e.nml".to_owned(),
            },
        ];
        let wrapped = wrap_or_prefix_groups(results, true);
        let first = success(&wrapped[0]);
        let skeleton = &first.skeleton_tracing;
        assert_eq!(skeleton.tree_groups.len(), 1);
        let wrapper = &skeleton.tree_groups[0];
        assert_eq!(
            (wrapper.name.as_str(), wrapper.group_id, wrapper.is_expanded),
            ("Some.File", 8, Some(true))
        );
        assert_eq!(wrapper.children[0].children[0].name, "deep");
        assert_eq!(
            skeleton
                .trees
                .iter()
                .map(|t| t.group_id)
                .collect::<Vec<_>>(),
            vec![Some(8), Some(2)]
        );
        let volume = &first.volume_layers[0].tracing;
        assert_eq!(volume.segment_groups[0].group_id, 5);
        assert_eq!(volume.segment_groups[0].name, "Some.File");
        assert_eq!(volume.segment_groups[0].is_expanded, None);
        assert_eq!(volume.segments[0].group_id, Some(5));
        // No trees and no groups: skeleton untouched, segments still wrapped.
        let second = success(&wrapped[1]);
        assert!(second.skeleton_tracing.tree_groups.is_empty());
        assert_eq!(
            second.volume_layers[0].tracing.segment_groups[0].name,
            "empty"
        );
        assert!(matches!(wrapped[2], NmlParseResult::Empty { .. }));
    }

    #[test]
    fn tree_names_are_prefixed_only_for_multiple_results() {
        let single = wrap_or_prefix_groups(
            vec![success_result("one.nml", vec![tree("a", None)], vec![])],
            false,
        );
        assert_eq!(success(&single[0]).skeleton_tracing.trees[0].name, "a");
        let multiple = wrap_or_prefix_groups(
            vec![
                success_result("x.y.nml", vec![tree("a", None)], vec![]),
                success_result("noext", vec![tree("b", None)], vec![]),
                NmlParseResult::Failure {
                    file_name: "f.nml".to_owned(),
                    error: "e".to_owned(),
                },
            ],
            false,
        );
        assert_eq!(
            success(&multiple[0]).skeleton_tracing.trees[0].name,
            "x.y_a"
        );
        assert_eq!(
            success(&multiple[1]).skeleton_tracing.trees[0].name,
            "noext_b"
        );
        assert!(
            success(&multiple[0])
                .skeleton_tracing
                .tree_groups
                .is_empty()
        );
    }

    #[test]
    fn naming_description_and_wk_url_helpers() {
        assert_eq!(name_for_uploaded(&["a.nml"]).as_deref(), Some("a"));
        assert_eq!(name_for_uploaded(&["a.nml.nml"]).as_deref(), Some("a.nml"));
        assert_eq!(
            name_for_uploaded(&["x.zip.zipy.nml"]).as_deref(),
            Some("xy")
        );
        assert_eq!(name_for_uploaded(&["a.nml\n"]).as_deref(), Some("a\n"));
        assert_eq!(name_for_uploaded(&["a.NML"]).as_deref(), Some("a.NML"));
        assert_eq!(name_for_uploaded(&["a.nml", "b.nml"]), None);
        assert_eq!(name_for_uploaded(&[]), None);

        assert_eq!(
            description_for_nmls(&[Some(" d "), Some("d"), None, Some("")]),
            "d"
        );
        assert_eq!(description_for_nmls(&[Some("a"), Some("b")]), "");
        assert_eq!(description_for_nmls(&[Some("  "), Some("a")]), "");
        assert_eq!(description_for_nmls(&[None]), "");

        assert_eq!(wk_urls_for_nmls(&[Some("u"), Some("u")]), "u");
        assert_eq!(wk_urls_for_nmls(&[Some("u"), None]), "");
        assert_eq!(wk_urls_for_nmls(&[None, None]), "");
        assert_eq!(wk_urls_for_nmls(&[]), "");
    }

    #[test]
    fn error_aggregation_and_consistency_checks() {
        let results = vec![
            NmlParseResult::Failure {
                file_name: "a.nml".to_owned(),
                error: "boom".to_owned(),
            },
            NmlParseResult::Empty {
                file_name: "b.nml".to_owned(),
            },
        ];
        assert_eq!(
            upload_error_messages(&results),
            vec!["Could not parse file “a.nml”: boom"]
        );
        assert_eq!(return_error(&results).status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            return_error(&results[1..]).status(),
            StatusCode::BAD_REQUEST
        );
        assert!(upload_error_messages(&results[1..]).is_empty());

        let with_org = |org: Option<&str>| SkeletonTracing {
            organization_id: org.map(str::to_owned),
            ..Default::default()
        };
        let (a, b, none) = (with_org(Some("a")), with_org(Some("b")), with_org(None));
        assert_eq!(
            uploaded_annotations_dataset_and_organization(&[&a, &none, &a], &[], &["x", "x"])
                .unwrap(),
            ("x".to_owned(), Some("a".to_owned()))
        );
        assert_eq!(
            uploaded_annotations_dataset_and_organization(&[&none], &[], &["x"]).unwrap(),
            ("x".to_owned(), None)
        );
        for (skeletons, ids) in [(vec![&a, &b], vec!["x"]), (vec![&a], vec!["x", "y"])] {
            let error =
                uploaded_annotations_dataset_and_organization(&skeletons, &[], &ids).unwrap_err();
            assert_eq!(
                (error.status, error.message.as_str()),
                (StatusCode::BAD_REQUEST, MSG_DIFFERENT_DATASETS)
            );
        }

        let (name, description, wk_url) =
            upload_metadata(&[success_result("f.zip", vec![], vec![])]);
        assert_eq!(
            (name.as_deref(), description.as_str(), wk_url.as_str()),
            (Some("f"), "", "")
        );
    }
}
