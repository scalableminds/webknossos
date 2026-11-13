//! Scala `UploadService` alignment project part: reserving the resumable tile upload, cancelling
//! it when WEBKNOSSOS deletes the project, and replacing the tile CSV of an uploaded project.
//! Finishing the upload is in `finish/alignment_project.rs`.
//!
//! An alignment project upload stores the alignment project id where dataset uploads store the
//! dataset id, and `DataSourceId(<alignment project id>, <organization>)` as its data source id.
//! The uploaded files end up in `<organization dir>/.alignmentProjects/<alignment project id>`.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::{DsError, DsResult, blocking},
    models::{DataSourceId, LocalPath},
    services::upload::{
        ALIGNMENT_PROJECTS_DIR, ResumableUploadInfo, UploadDomain, UploadService,
        tile_csv::{self, SectionRange},
    },
};

/// Msg.AlignmentProject (the datastore part).
pub mod msg {
    pub const UPLOAD_VALIDATION_FAILED: &str =
        "Could not validate alignment project information for upload.";
    pub const FINISH_UPLOAD_FAILED: &str = "Could not finish the alignment project upload.";
    pub const REPORT_UPLOAD_FAILED: &str =
        "Could not report the alignment project upload to WEBKNOSSOS.";
    pub const UNZIP_FAILED: &str = "Could not unzip the uploaded file.";
    pub fn directory_exists(directory: &str) -> String {
        format!("Alignment project directory {directory} already exists.")
    }
    pub fn directory_missing(directory: &str) -> String {
        format!("Alignment project directory {directory} does not exist.")
    }
}

/// Scala `AlignmentProjectCsvReplacementInfo`: returned by WEBKNOSSOS when it allows replacing
/// the tile CSV of an alignment project.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentProjectCsvReplacementInfo {
    pub organization_id: String,
    /// Relative to the alignment project directory.
    #[serde(default)]
    pub current_csv_path: Option<String>,
}

/// Scala `AlignmentProjectUploadAdditionalInfo`: WEBKNOSSOS' answer to the reservation, also
/// the answer of the datastore's reserve route.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentProjectUploadAdditionalInfo {
    pub new_alignment_project_id: String,
}

/// Scala `ReportAlignmentProjectCsvReplacementParameters`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportAlignmentProjectCsvReplacementParameters {
    pub alignment_project_id: String,
    pub csv_path: String,
    pub section_range: SectionRange,
}

/// Scala `ReportAlignmentProjectUploadParameters` (JsonAutoFormat: absent options are omitted).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportAlignmentProjectUploadParameters {
    pub alignment_project_id: String,
    /// Relative to the alignment project directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub csv_path: Option<String>,
    pub file_count: i64,
    pub total_size_in_bytes: i64,
    /// Set if the CSV is valid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_range: Option<SectionRange>,
    /// Set if the CSV is invalid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_reason: Option<String>,
}

/// `projectDir.relativize(path).toString` for a path inside the project directory.
pub(crate) fn relative_to(project_dir: &Path, path: &Path) -> String {
    path.strip_prefix(project_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

impl UploadService {
    /// Scala `alignmentProjectDirFor`: in the organization's first upload-enabled local base
    /// directory.
    pub fn alignment_project_dir_for(
        &self,
        organization: &str,
        alignment_project_id: &str,
    ) -> DsResult<PathBuf> {
        Ok(self
            .base_dirs()
            .get_one_local_for_org(organization, true, false, false)?
            .join(ALIGNMENT_PROJECTS_DIR)
            .join(alignment_project_id))
    }

    /// Scala `reserveAlignmentProjectUpload`.
    pub async fn reserve_alignment_project_upload(
        &self,
        info: &ResumableUploadInfo,
        organization: &str,
        alignment_project_id: &str,
    ) -> DsResult<()> {
        let source = DataSourceId::new(alignment_project_id.to_owned(), organization.to_owned());
        self.reserve_resumable_upload(
            info,
            alignment_project_id,
            &source,
            UploadDomain::AlignmentProject,
        )
        .await?;
        self.store(UploadDomain::AlignmentProject)
            .insert_upload_id_by_alignment_project_id(alignment_project_id, &info.upload_id)
            .await
    }

    /// Scala `cancelAlignmentProjectUpload`: called when WEBKNOSSOS deletes an alignment
    /// project. Unknown uploads (finished or expired) are ignored, and so is a failing lookup
    /// (Scala `shiftBox`).
    pub async fn cancel_alignment_project_upload(
        &self,
        alignment_project_id: &str,
    ) -> DsResult<()> {
        let lookup = self
            .store(UploadDomain::AlignmentProject)
            .find_upload_id_by_alignment_project_id(alignment_project_id)
            .await;
        let Ok(Some(upload_id)) = lookup else {
            return Ok(());
        };
        self.clean_up_uploaded(
            &upload_id,
            "Alignment project was deleted",
            UploadDomain::AlignmentProject,
        )
        .await
    }

    /// Scala `replaceAlignmentProjectCsv`: validates the new CSV before storing it next to the
    /// current one. Previous versions are kept, so that running and past jobs still find the CSV
    /// they were started with. Returns the new path relative to the project.
    pub async fn replace_alignment_project_csv(
        &self,
        alignment_project_id: &str,
        replacement: &AlignmentProjectCsvReplacementInfo,
        uploaded_csv: bytes::Bytes,
        uploaded_file_name: &str,
    ) -> DsResult<(String, SectionRange)> {
        let service = self.clone();
        let (id, replacement, file_name) = (
            alignment_project_id.to_owned(),
            replacement.clone(),
            uploaded_file_name.to_owned(),
        );
        blocking(move || {
            let section_range = tile_csv::parse_section_range_reader(&uploaded_csv[..])?;
            let project_dir =
                service.alignment_project_dir_for(&replacement.organization_id, &id)?;
            if !project_dir.is_dir() {
                return Err(DsError::failure(msg::directory_missing(
                    &project_dir.to_string_lossy(),
                )));
            }
            // `projectDir.resolve(currentCsvPath).normalize()`.
            let current_csv = replacement
                .current_csv_path
                .as_deref()
                .map(|path| LocalPath::from_path(&project_dir.join(path)).to_path_buf());
            let target_dir = match &current_csv {
                Some(current) => current.parent().map(Path::to_path_buf),
                None => Some(project_dir.clone()),
            };
            let Some(target_dir) = target_dir.filter(|dir| dir.starts_with(&project_dir)) else {
                return Err(DsError::failure(tile_csv::msg::INVALID_CURRENT_PATH));
            };
            let current_name = current_csv
                .as_deref()
                .and_then(Path::file_name)
                .map(|name| name.to_string_lossy().into_owned());
            let target_path = target_dir.join(tile_csv::next_csv_file_name(
                current_name.as_deref(),
                &file_name,
                |name| target_dir.join(name).exists(),
            ));
            // `Files.copy` without REPLACE_EXISTING.
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target_path)
                .and_then(|mut file| std::io::Write::write_all(&mut file, &uploaded_csv))
                .map_err(|e| DsError::from_exception(e).wrap(tile_csv::msg::STORE_FAILED))?;
            tracing::info!(
                "Replaced tile CSV of alignment project {id} with {}.",
                target_path.display()
            );
            Ok((relative_to(&project_dir, &target_path), section_range))
        })
        .await
    }
}
