//! Scala `UploadService` (reservation, resumable chunks, cancel, clean-up) and the Redis
//! `UploadMetadataStore`s. Redis keys and stored JSON are byte-compatible with the Scala datastore
//! so both can share one Redis during a staged cutover.
//!
//! Finishing uploads (unpacking, exploration, moving to the target) is in `upload_finish.rs`.
use std::{
    io::{Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde_json::Value;

use crate::{
    error::{DsError, DsResult},
    models::DataSourceId,
    redis_store::RedisStore,
    services::{BaseDirService, dataset_files::delete_directory_recursively},
};

/// Scala `uploadIdleExpiry`.
pub const UPLOAD_IDLE_EXPIRY: Duration = Duration::from_secs(14 * 24 * 60 * 60);
const REFRESH_THRESHOLD: Duration = Duration::from_secs(24 * 60 * 60);
pub const UPLOADING_DIR: &str = ".uploading";
pub const UNPACKED_DIR: &str = ".unpacked";
pub const FOR_CONVERSION_DIR: &str = ".forConversion";
pub const CONVERTING_DIR: &str = ".converting";

/// Scala `UploadDomain`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UploadDomain {
    Dataset,
    Mag,
    Attachment,
}

impl UploadDomain {
    pub const ALL: [Self; 3] = [Self::Dataset, Self::Mag, Self::Attachment];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dataset => "dataset",
            Self::Mag => "mag",
            Self::Attachment => "attachment",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.as_str() == name)
    }
}

impl std::fmt::Display for UploadDomain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Scala `UploadMetadataStore` and its domain subclasses.
#[derive(Clone)]
pub struct UploadMetadataStore {
    domain: UploadDomain,
    store: RedisStore,
}

fn parse_failure(e: serde_json::Error) -> DsError {
    DsError::failure(format!("JSON parsing failed: {e}"))
}

impl UploadMetadataStore {
    pub fn new(domain: UploadDomain, store: RedisStore) -> Self {
        Self { domain, store }
    }

    fn prefix(&self) -> String {
        format!("upload___{}___", self.domain)
    }
    fn key(&self, upload_id: &str, suffix: &str) -> String {
        format!("{}{upload_id}___{suffix}", self.prefix())
    }
    fn file_key(&self, upload_id: &str, file: &str, suffix: &str) -> String {
        format!("{}{upload_id}___file___{file}___{suffix}", self.prefix())
    }
    /// Dataset domain: `<prefix>___<DataSourceId JSON>___datasourceId` (value: the upload id).
    fn upload_id_by_data_source_key(&self, id: &DataSourceId) -> String {
        format!(
            "{}___{}___datasourceId",
            self.prefix(),
            serde_json::to_string(id).expect("DataSourceId serializes")
        )
    }

    /// Scala `insertSerialized` (`Json.stringify(Json.toJson(value))`).
    async fn insert_serialized(&self, key: &str, value: &impl serde::Serialize) -> DsResult<()> {
        let serialized = serde_json::to_string(value).map_err(DsError::from_exception)?;
        self.store
            .insert(key, &serialized, Some(UPLOAD_IDLE_EXPIRY))
            .await
    }

    async fn find_json(&self, key: &str) -> DsResult<Option<Value>> {
        self.store
            .find(key)
            .await?
            .map(|raw| serde_json::from_str(&raw).map_err(parse_failure))
            .transpose()
    }

    pub async fn is_known_upload(&self, upload_id: &str) -> DsResult<bool> {
        self.store.contains(&self.key(upload_id, "fileCount")).await
    }

    pub async fn find_data_source_id(&self, upload_id: &str) -> DsResult<Option<DataSourceId>> {
        self.find_json(&self.key(upload_id, "dataSourceId"))
            .await?
            .map(|v| DataSourceId::from_json(&v).map_err(|e| parse_failure_js(&e)))
            .transpose()
    }

    pub async fn find_dataset_id(&self, upload_id: &str) -> DsResult<Option<String>> {
        self.find_json(&self.key(upload_id, "datasetId"))
            .await?
            .map(|v| match v {
                Value::String(id) => Ok(id),
                other => Err(DsError::failure(format!(
                    "JSON parsing failed: expected an ObjectId string, got {other}"
                ))),
            })
            .transpose()
    }

    pub async fn find_file_paths(&self, upload_id: &str) -> DsResult<Option<Vec<String>>> {
        self.find_json(&self.key(upload_id, "filePaths"))
            .await?
            .map(|v| serde_json::from_value(v).map_err(parse_failure))
            .transpose()
    }

    pub async fn find_total_file_size_in_bytes(&self, upload_id: &str) -> DsResult<Option<i64>> {
        self.store
            .find_long(&self.key(upload_id, "totalFileSizeInBytes"))
            .await
    }

    pub async fn find_file_count(&self, upload_id: &str) -> DsResult<Option<i64>> {
        self.store
            .find_long(&self.key(upload_id, "fileCount"))
            .await
    }

    pub async fn find_file_names(&self, upload_id: &str) -> DsResult<Vec<String>> {
        self.store
            .find_set(&self.key(upload_id, "fileNameSet"))
            .await
    }

    pub async fn find_file_chunk_count(
        &self,
        upload_id: &str,
        file: &str,
    ) -> DsResult<Option<i64>> {
        self.store
            .find_long(&self.file_key(upload_id, file, "chunkCount"))
            .await
    }

    pub async fn find_file_chunk_set(&self, upload_id: &str, file: &str) -> DsResult<Vec<String>> {
        self.store
            .find_set(&self.file_key(upload_id, file, "chunkSet"))
            .await
    }

    pub async fn is_file_known(&self, upload_id: &str, file: &str) -> DsResult<bool> {
        self.store
            .contains(&self.file_key(upload_id, file, "chunkCount"))
            .await
    }

    pub async fn is_file_chunk_set_known(&self, upload_id: &str, file: &str) -> DsResult<bool> {
        self.store
            .contains(&self.file_key(upload_id, file, "chunkSet"))
            .await
    }

    pub async fn is_chunk_present(
        &self,
        upload_id: &str,
        file: &str,
        chunk: i64,
    ) -> DsResult<bool> {
        self.store
            .is_contained_in_set(
                &self.file_key(upload_id, file, "chunkSet"),
                &chunk.to_string(),
            )
            .await
    }

    pub async fn insert_total_file_count(&self, upload_id: &str, count: i64) -> DsResult<()> {
        self.store
            .insert(
                &self.key(upload_id, "fileCount"),
                &count.to_string(),
                Some(UPLOAD_IDLE_EXPIRY),
            )
            .await
    }

    pub async fn insert_total_file_size_in_bytes(
        &self,
        upload_id: &str,
        size: Option<i64>,
    ) -> DsResult<()> {
        if let Some(size) = size {
            self.store
                .insert(
                    &self.key(upload_id, "totalFileSizeInBytes"),
                    &size.to_string(),
                    Some(UPLOAD_IDLE_EXPIRY),
                )
                .await?;
        }
        Ok(())
    }

    pub async fn insert_file_path_into_set(&self, upload_id: &str, file: &str) -> DsResult<bool> {
        self.store
            .insert_into_set(
                &self.key(upload_id, "fileNameSet"),
                file,
                Some(UPLOAD_IDLE_EXPIRY),
            )
            .await
    }

    pub async fn insert_file_chunk_count(
        &self,
        upload_id: &str,
        file: &str,
        count: i64,
    ) -> DsResult<()> {
        self.store
            .insert(
                &self.file_key(upload_id, file, "chunkCount"),
                &count.to_string(),
                Some(UPLOAD_IDLE_EXPIRY),
            )
            .await
    }

    pub async fn insert_file_chunk_into_set(
        &self,
        upload_id: &str,
        file: &str,
        chunk: i64,
    ) -> DsResult<bool> {
        self.store
            .insert_into_set(
                &self.file_key(upload_id, file, "chunkSet"),
                &chunk.to_string(),
                Some(UPLOAD_IDLE_EXPIRY),
            )
            .await
    }

    pub async fn remove_file_chunk_from_set(
        &self,
        upload_id: &str,
        file: &str,
        chunk: i64,
    ) -> DsResult<bool> {
        self.store
            .remove_from_set(
                &self.file_key(upload_id, file, "chunkSet"),
                &chunk.to_string(),
            )
            .await
    }

    pub async fn insert_dataset_id(&self, upload_id: &str, dataset_id: &str) -> DsResult<()> {
        self.insert_serialized(&self.key(upload_id, "datasetId"), &dataset_id)
            .await
    }

    pub async fn insert_data_source_id(&self, upload_id: &str, id: &DataSourceId) -> DsResult<()> {
        self.insert_serialized(&self.key(upload_id, "dataSourceId"), id)
            .await
    }

    pub async fn insert_file_paths(
        &self,
        upload_id: &str,
        paths: Option<&[String]>,
    ) -> DsResult<()> {
        self.insert_serialized(
            &self.key(upload_id, "filePaths"),
            &paths.unwrap_or_default(),
        )
        .await
    }

    /// Additional single-value keys of the domain subclasses (`mag`, `layerName`, …).
    pub async fn insert_extra_serialized(
        &self,
        upload_id: &str,
        suffix: &str,
        value: &impl serde::Serialize,
    ) -> DsResult<()> {
        self.insert_serialized(&self.key(upload_id, suffix), value)
            .await
    }

    /// Scala `insert` of a raw string (the `layerName` keys are not JSON-encoded).
    pub async fn insert_extra_raw(
        &self,
        upload_id: &str,
        suffix: &str,
        value: &str,
    ) -> DsResult<()> {
        self.store
            .insert(
                &self.key(upload_id, suffix),
                value,
                Some(UPLOAD_IDLE_EXPIRY),
            )
            .await
    }

    pub async fn find_extra_json(&self, upload_id: &str, suffix: &str) -> DsResult<Option<Value>> {
        self.find_json(&self.key(upload_id, suffix)).await
    }

    pub async fn find_extra_raw(&self, upload_id: &str, suffix: &str) -> DsResult<Option<String>> {
        self.store.find(&self.key(upload_id, suffix)).await
    }

    /// Dataset domain: Scala `insertUploadIdByDataSourceId` (the value is JSON-encoded).
    pub async fn insert_upload_id_by_data_source_id(
        &self,
        id: &DataSourceId,
        upload_id: &str,
    ) -> DsResult<()> {
        self.insert_serialized(&self.upload_id_by_data_source_key(id), &upload_id)
            .await
    }

    /// Dataset domain: Scala `findUploadIdByDataSourceId` reads the raw (still JSON-encoded) value.
    pub async fn find_upload_id_by_data_source_id(
        &self,
        id: &DataSourceId,
    ) -> DsResult<Option<String>> {
        self.store
            .find(&self.upload_id_by_data_source_key(id))
            .await
    }

    /// Single-value keys of the domain subclass (removed/expired with the upload).
    fn extra_suffixes(&self) -> &'static [&'static str] {
        match self.domain {
            UploadDomain::Dataset => &["linkedLayerIdentifier", "needsConversion", "voxelSize"],
            UploadDomain::Mag => &["mag", "layerName"],
            UploadDomain::Attachment => &["attachmentType", "attachment", "layerName"],
        }
    }

    /// Scala `cleanUp` (domain override first, then the base keys).
    pub async fn clean_up(&self, upload_id: &str) -> DsResult<()> {
        if self.domain == UploadDomain::Dataset {
            let id = self
                .find_data_source_id(upload_id)
                .await?
                .ok_or_else(DsError::empty)?;
            self.store
                .remove(&self.key(upload_id, "linkedLayerIdentifier"))
                .await?;
            self.store
                .remove(&self.key(upload_id, "needsConversion"))
                .await?;
            self.store
                .remove(&self.upload_id_by_data_source_key(&id))
                .await?;
        } else {
            for suffix in self.extra_suffixes() {
                self.store.remove(&self.key(upload_id, suffix)).await?;
            }
        }
        self.store.remove(&self.key(upload_id, "fileCount")).await?;
        for file in self.find_file_names(upload_id).await? {
            self.store
                .remove(&self.file_key(upload_id, &file, "chunkCount"))
                .await?;
            self.store
                .remove(&self.file_key(upload_id, &file, "chunkSet"))
                .await?;
        }
        for suffix in [
            "fileNameSet",
            "totalFileSizeInBytes",
            "dataSourceId",
            "datasetId",
            "filePaths",
        ] {
            self.store.remove(&self.key(upload_id, suffix)).await?;
        }
        Ok(())
    }

    /// Scala `refreshExpiry`: only once a day has passed since the last refresh.
    pub async fn refresh_expiry(&self, upload_id: &str) -> DsResult<()> {
        if self.domain == UploadDomain::Dataset {
            let id = self
                .find_data_source_id(upload_id)
                .await?
                .ok_or_else(DsError::empty)?;
            for suffix in self.extra_suffixes() {
                self.store
                    .expire(&self.key(upload_id, suffix), UPLOAD_IDLE_EXPIRY)
                    .await?;
            }
            self.store
                .expire(&self.upload_id_by_data_source_key(&id), UPLOAD_IDLE_EXPIRY)
                .await?;
        } else {
            for suffix in self.extra_suffixes() {
                self.store
                    .expire(&self.key(upload_id, suffix), UPLOAD_IDLE_EXPIRY)
                    .await?;
            }
        }
        let remaining = self
            .store
            .ttl_seconds(&self.key(upload_id, "fileCount"))
            .await?;
        let threshold = (UPLOAD_IDLE_EXPIRY - REFRESH_THRESHOLD).as_secs() as i64;
        if remaining >= 0 && remaining < threshold {
            for suffix in [
                "fileCount",
                "totalFileSizeInBytes",
                "fileNameSet",
                "dataSourceId",
                "datasetId",
                "filePaths",
            ] {
                self.store
                    .expire(&self.key(upload_id, suffix), UPLOAD_IDLE_EXPIRY)
                    .await?;
            }
            for file in self.find_file_names(upload_id).await? {
                self.store
                    .expire(
                        &self.file_key(upload_id, &file, "chunkCount"),
                        UPLOAD_IDLE_EXPIRY,
                    )
                    .await?;
                self.store
                    .expire(
                        &self.file_key(upload_id, &file, "chunkSet"),
                        UPLOAD_IDLE_EXPIRY,
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

fn parse_failure_js(e: &crate::models::JsError) -> DsError {
    DsError::failure(format!(
        "JSON parsing failed: {}",
        e.validation_failure_message()
    ))
}

/// Scala `ResumableUploadInfo`.
#[derive(Debug, Clone, PartialEq)]
pub struct ResumableUploadInfo {
    pub upload_id: String,
    pub total_file_count: i64,
    pub file_paths: Option<Vec<String>>,
    pub total_file_size_in_bytes: Option<i64>,
}

impl ResumableUploadInfo {
    pub fn from_json(json: &Value) -> crate::models::JsResult<Self> {
        use crate::models::json::{Fields, read_i64, read_list, read_string};
        let mut f = Fields::new(json);
        let upload_id = f.req("uploadId", read_string);
        let total_file_count = f.req("totalFileCount", read_i64);
        let file_paths = f.opt("filePaths", |v| read_list(v, read_string));
        let total_file_size_in_bytes = f.opt("totalFileSizeInBytes", read_i64);
        f.finish()?;
        Ok(Self {
            upload_id: upload_id?,
            total_file_count: total_file_count?,
            file_paths: file_paths?,
            total_file_size_in_bytes: total_file_size_in_bytes?,
        })
    }
}

/// Scala `uploadFullName`.
pub fn upload_full_name(
    domain: UploadDomain,
    upload_id: &str,
    dataset_id: &str,
    source: &DataSourceId,
) -> String {
    format!("upload {upload_id} for {domain} (dataset {dataset_id} - {source})")
}

/// Scala `extractDatasetUploadId`: the part before the first `/`.
pub fn extract_upload_id(upload_file_id: &str) -> &str {
    upload_file_id.split('/').next().unwrap_or_default()
}

/// Java `String.split("/")` (trailing empty strings dropped).
fn java_split_slash(value: &str) -> Vec<&str> {
    let mut parts: Vec<&str> = value.split('/').collect();
    while parts.len() > 1 && parts.last() == Some(&"") {
        parts.pop();
    }
    if parts.iter().all(|p| p.is_empty()) && value.contains('/') {
        return Vec::new();
    }
    parts
}

/// Whether `relative` resolved in a directory stays inside it (lexically). Scala checks
/// `uploadDir.relativize(uploadDir.resolve(filePath)).startsWith("../")`.
fn stays_inside(relative: &str) -> bool {
    let mut depth = 0i64;
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    true
}

/// Scala `UploadService` (B8a part).
#[derive(Clone)]
pub struct UploadService {
    base_dirs: BaseDirService,
    dataset: UploadMetadataStore,
    mag: UploadMetadataStore,
    attachment: UploadMetadataStore,
    delete_temporary_files_after_upload: bool,
}

impl UploadService {
    pub fn new(
        base_dirs: BaseDirService,
        store: RedisStore,
        delete_temporary_files_after_upload: bool,
    ) -> Self {
        Self {
            base_dirs,
            dataset: UploadMetadataStore::new(UploadDomain::Dataset, store.clone()),
            mag: UploadMetadataStore::new(UploadDomain::Mag, store.clone()),
            attachment: UploadMetadataStore::new(UploadDomain::Attachment, store),
            delete_temporary_files_after_upload,
        }
    }

    pub fn base_dirs(&self) -> &BaseDirService {
        &self.base_dirs
    }

    pub fn delete_temporary_files_after_upload(&self) -> bool {
        self.delete_temporary_files_after_upload
    }

    pub fn store(&self, domain: UploadDomain) -> &UploadMetadataStore {
        match domain {
            UploadDomain::Dataset => &self.dataset,
            UploadDomain::Mag => &self.mag,
            UploadDomain::Attachment => &self.attachment,
        }
    }

    pub async fn is_known_upload(&self, upload_id: &str, domain: UploadDomain) -> DsResult<bool> {
        self.store(domain).is_known_upload(upload_id).await
    }

    pub async fn is_known_upload_by_file_id(
        &self,
        file_id: &str,
        domain: UploadDomain,
    ) -> DsResult<bool> {
        self.is_known_upload(extract_upload_id(file_id), domain)
            .await
    }

    pub async fn dataset_id_by_upload_id(
        &self,
        upload_id: &str,
        domain: UploadDomain,
    ) -> DsResult<Option<String>> {
        self.store(domain).find_dataset_id(upload_id).await
    }

    fn orga_dir_for_upload(&self, organization: &str) -> DsResult<PathBuf> {
        self.base_dirs
            .get_one_local_for_org(organization, true, false, false)
    }

    /// Scala `uploadDirectoryFor`.
    pub fn upload_directory_for(
        &self,
        organization: &str,
        upload_id: &str,
        domain: UploadDomain,
    ) -> DsResult<PathBuf> {
        Ok(self
            .orga_dir_for_upload(organization)?
            .join(UPLOADING_DIR)
            .join(domain.as_str())
            .join(upload_id))
    }

    /// Scala `reserveResumableUpload`.
    pub async fn reserve_resumable_upload(
        &self,
        info: &ResumableUploadInfo,
        dataset_id: &str,
        source: &DataSourceId,
        domain: UploadDomain,
    ) -> DsResult<()> {
        let bases = self.base_dirs.clone();
        let organization = source.organization_id.clone();
        tokio::task::spawn_blocking(move || {
            bases.get_one_local_for_org(&organization, true, true, true)
        })
        .await
        .map_err(DsError::from_exception)??;
        let upload_id = &info.upload_id;
        tracing::info!(
            "Reserving {}...",
            upload_full_name(domain, upload_id, dataset_id, source)
        );
        let store = self.store(domain);
        store.insert_data_source_id(upload_id, source).await?;
        store.insert_dataset_id(upload_id, dataset_id).await?;
        store
            .insert_total_file_count(upload_id, info.total_file_count)
            .await?;
        store
            .insert_total_file_size_in_bytes(upload_id, info.total_file_size_in_bytes)
            .await?;
        store
            .insert_file_paths(upload_id, info.file_paths.as_deref())
            .await
    }

    /// Scala `getFilePathAndDirForUploadFileId`.
    async fn file_path_and_dir(
        &self,
        file_id: &str,
        domain: UploadDomain,
    ) -> DsResult<(String, PathBuf)> {
        let upload_id = extract_upload_id(file_id);
        let source = self
            .store(domain)
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let upload_dir = self.upload_directory_for(&source.organization_id, upload_id, domain)?;
        let parts = java_split_slash(file_id);
        let raw = parts.get(1..).unwrap_or_default().join("/");
        if raw.is_empty() {
            // Scala `charAt(0)` on an empty string throws.
            return Err(DsError::from_exception(
                "java.lang.StringIndexOutOfBoundsException: Index 0 out of bounds for length 0",
            ));
        }
        let file_path = raw.strip_prefix('/').unwrap_or(&raw).to_owned();
        if !stays_inside(&file_path) {
            return Err(DsError::failure(format!("Invalid file path: {file_path}")));
        }
        Ok((file_path, upload_dir))
    }

    /// Scala `isChunkPresent`.
    pub async fn is_chunk_present(
        &self,
        file_id: &str,
        chunk: i64,
        domain: UploadDomain,
    ) -> DsResult<bool> {
        let store = self.store(domain);
        let upload_id = extract_upload_id(file_id);
        let (file_path, _) = self.file_path_and_dir(file_id, domain).await?;
        if !store.is_file_known(upload_id, &file_path).await? {
            return Ok(false);
        }
        let set_known = store.is_file_chunk_set_known(upload_id, &file_path).await?;
        let present = store.is_chunk_present(upload_id, &file_path, chunk).await?;
        Ok(set_known && present)
    }

    /// Scala `handleUploadChunk`: writes the chunk at `(chunkNumber - 1) * chunkSize` once.
    #[allow(clippy::too_many_arguments)]
    pub async fn handle_upload_chunk(
        &self,
        file_id: &str,
        chunk_size: i64,
        current_chunk_size: i64,
        total_chunk_count: i64,
        chunk_number: i64,
        bytes: bytes::Bytes,
        domain: UploadDomain,
    ) -> DsResult<()> {
        let store = self.store(domain);
        let upload_id = extract_upload_id(file_id);
        let dataset_id = store
            .find_dataset_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let source = store
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let (file_path, upload_dir) = self.file_path_and_dir(file_id, domain).await?;
        store.refresh_expiry(upload_id).await?;
        if !store.is_file_known(upload_id, &file_path).await? {
            store
                .insert_file_path_into_set(upload_id, &file_path)
                .await?;
            store
                .insert_file_chunk_count(upload_id, &file_path, total_chunk_count)
                .await?;
        }
        if !store
            .insert_file_chunk_into_set(upload_id, &file_path, chunk_number)
            .await?
        {
            return Ok(());
        }
        let target = upload_dir.join(&file_path);
        let written = tokio::task::spawn_blocking(move || -> Result<(), String> {
            if bytes.len() as i64 > current_chunk_size {
                return Err(format!(
                    "Chunk request currentChunkSize {current_chunk_size} doesn’t match passed file length {}",
                    bytes.len()
                ));
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let offset = (chunk_number - 1)
                .checked_mul(chunk_size)
                .and_then(|o| u64::try_from(o).ok())
                .ok_or_else(|| "Negative seek offset".to_owned())?;
            let mut file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(&target)
                .map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())
        })
        .await
        .map_err(DsError::from_exception)?;
        if let Err(message) = written {
            // Scala does not await this removal.
            let _ = store
                .remove_file_chunk_from_set(upload_id, &file_path, chunk_number)
                .await;
            let error = format!(
                "Error receiving chunk {chunk_number} for {}: {message}",
                upload_full_name(domain, upload_id, &dataset_id, &source)
            );
            tracing::warn!("{error}");
            return Err(DsError::failure(error));
        }
        Ok(())
    }

    /// Scala `cleanUpUploaded`: removes the upload directory and all Redis keys.
    pub async fn clean_up_uploaded(
        &self,
        upload_id: &str,
        reason: &str,
        domain: UploadDomain,
    ) -> DsResult<()> {
        let store = self.store(domain);
        let source = store
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let upload_dir = self.upload_directory_for(&source.organization_id, upload_id, domain)?;
        tracing::info!(
            "Cleaning up uploaded {}. Reason: {reason}",
            upload_dir.display()
        );
        tokio::task::spawn_blocking(move || delete_directory_recursively(&upload_dir))
            .await
            .map_err(DsError::from_exception)??;
        store.clean_up(upload_id).await
    }

    /// Scala `cancelUpload`. Scala discards the clean-up future (its failures are ignored).
    pub async fn cancel_upload(&self, domain: UploadDomain, upload_id: &str) -> DsResult<()> {
        let store = self.store(domain);
        let source = store
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        let dataset_id = store
            .find_dataset_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        if !store.is_known_upload(upload_id).await? {
            return Ok(());
        }
        tracing::info!(
            "Cancelling {}...",
            upload_full_name(domain, upload_id, &dataset_id, &source)
        );
        if let Err(e) = self
            .clean_up_uploaded(upload_id, "Cancelled by user", domain)
            .await
        {
            tracing::warn!("Cleaning up cancelled upload {upload_id} failed: {e}");
        }
        Ok(())
    }

    /// Scala `cleanUpUploadFilesAfterConvertJob` (only with `deleteTemporaryFilesAfterUpload`).
    pub fn clean_up_upload_files_after_convert_job(
        &self,
        organization: &str,
        directory_name: &str,
        job_id: &str,
    ) {
        if !self.delete_temporary_files_after_upload {
            return;
        }
        let Ok(orga_dir) = self.orga_dir_for_upload(organization) else {
            return;
        };
        for target in [
            orga_dir.join(FOR_CONVERSION_DIR).join(directory_name),
            orga_dir.join(CONVERTING_DIR).join(job_id),
        ] {
            // `enforceContainedIn = Some(orgaDir)`: strictly inside the organization directory.
            let normalized = crate::models::LocalPath::from_path(&target).to_path_buf();
            if normalized.starts_with(&orga_dir) && normalized != orga_dir {
                let _ = delete_directory_recursively(&normalized);
            } else {
                tracing::warn!(
                    "Refusing to delete {}: it is not contained within expected parent directory {}",
                    target.display(),
                    orga_dir.display()
                );
            }
        }
    }

    /// Scala `enrichUnfinishedUploadInfoWithUploadIds`: uploads without a Redis entry are dropped;
    /// the others get upload id and file paths from Redis. Entries whose lookups fail are dropped
    /// too (Scala flattens failed boxes). Note: Scala stores the upload id JSON-encoded but reads it
    /// raw, so the file-path lookup uses the quoted id; kept for parity.
    pub async fn enrich_unfinished_uploads(&self, uploads: Vec<Value>) -> Vec<Value> {
        let mut result = Vec::new();
        for mut upload in uploads {
            let Some(id) = upload
                .get("dataSourceId")
                .and_then(|v| DataSourceId::from_json(v).ok())
            else {
                continue;
            };
            let Ok(Some(upload_id)) = self.dataset.find_upload_id_by_data_source_id(&id).await
            else {
                continue;
            };
            let Ok(Some(file_paths)) = self.dataset.find_file_paths(&upload_id).await else {
                continue;
            };
            upload["uploadId"] = Value::String(upload_id);
            upload["filePaths"] = Value::from(file_paths);
            result.push(upload);
        }
        result
    }

    /// Scala `cleanUpOrphanUploads` (run once, 10 s after start): upload directories without
    /// Redis metadata in any domain are deleted.
    pub async fn clean_up_orphan_uploads(&self) -> DsResult<()> {
        let bases = self.base_dirs.clone();
        let orga_dirs = tokio::task::spawn_blocking(move || -> Vec<PathBuf> {
            let mut dirs: Vec<PathBuf> = Vec::new();
            for (base, organization) in bases.local_dirs(None, false) {
                if organization.is_some() {
                    dirs.push(base);
                } else if let Ok(entries) = std::fs::read_dir(&base) {
                    dirs.extend(
                        entries
                            .filter_map(Result::ok)
                            .map(|e| e.path())
                            .filter(|p| p.is_dir()),
                    );
                }
            }
            dirs
        })
        .await
        .map_err(DsError::from_exception)?;
        for orga_dir in orga_dirs {
            for domain in UploadDomain::ALL {
                let uploading = orga_dir.join(UPLOADING_DIR).join(domain.as_str());
                let Ok(entries) = std::fs::read_dir(&uploading) else {
                    continue;
                };
                for dir in entries
                    .filter_map(Result::ok)
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                {
                    let upload_id = dir
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned();
                    let mut known = false;
                    for any in UploadDomain::ALL {
                        known |= self.is_known_upload(&upload_id, any).await?;
                    }
                    if !known {
                        match delete_directory_recursively(&dir) {
                            Ok(()) => tracing::info!(
                                "Deleted orphan {domain} upload at {}",
                                dir.display()
                            ),
                            Err(_) => tracing::warn!(
                                "Failed to delete orphan {domain} upload at {}",
                                dir.display()
                            ),
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Spawns the one-off orphan clean-up 10 s after start (Scala `scheduleOnce(10 seconds)`).
    pub fn spawn_orphan_clean_up(&self) -> tokio::task::JoinHandle<()> {
        let service = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(10)).await;
            if let Err(e) = service.clean_up_orphan_uploads().await {
                tracing::warn!("Cleaning up orphan uploads failed: {e}");
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_upload_file_ids_like_java() {
        assert_eq!(extract_upload_id("abc/x/y"), "abc");
        assert_eq!(extract_upload_id(""), "");
        assert_eq!(java_split_slash("id/a/b/"), ["id", "a", "b"]);
        assert!(java_split_slash("///").is_empty());
    }

    #[test]
    fn rejects_paths_leaving_the_upload_dir() {
        assert!(stays_inside("a/b.zip"));
        assert!(stays_inside("a/../b"));
        assert!(!stays_inside("../b"));
        assert!(!stays_inside("a/../../b"));
    }
}
