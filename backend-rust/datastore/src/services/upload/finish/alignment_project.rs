//! Scala `UploadService.finishAlignmentProjectUpload`: the uploaded files are kept as they are
//! (a single uploaded zip is unpacked) in the alignment project directory. The worker reads them
//! via the path of the tile CSV, which is validated here and reported to WEBKNOSSOS.
use std::path::{Path, PathBuf};

use super::{
    FinishContext, NO_FILES,
    filesystem::{
        io_failure, list_files_recursive, move_directory, size_of_directory, unzip_to_directory,
    },
};
use crate::{
    error::{DsError, DsResult, blocking},
    services::upload::{
        UploadDomain,
        alignment_project::{ReportAlignmentProjectUploadParameters, msg, relative_to},
        tile_csv, upload_full_name,
    },
};

const DOMAIN: UploadDomain = UploadDomain::AlignmentProject;

/// Scala `unpackOrMoveAlignmentProjectUpload`: a single uploaded zip is unpacked (without
/// truncating a common prefix), otherwise the uploaded files are moved as they are.
fn unpack_or_move(
    upload_dir: &Path,
    target_dir: &Path,
    alignment_project_id: &str,
) -> DsResult<()> {
    let uploaded = list_files_recursive(upload_dir, usize::MAX)?;
    match uploaded.as_slice() {
        [] => Err(DsError::failure(NO_FILES)),
        [zip]
            if zip
                .file_name()
                .is_some_and(|name| name.to_string_lossy().to_lowercase().ends_with(".zip")) =>
        {
            tracing::info!(
                "finishUpload for alignment project {alignment_project_id}: Unzipping to {}...",
                target_dir.display()
            );
            unzip_to_directory(zip, target_dir, &[], false, &[])
                .map(|_| ())
                .map_err(|e| e.wrap(msg::UNZIP_FAILED))
        }
        _ => move_directory(upload_dir, target_dir)
            .map_err(|e| e.wrap("Could not move uploaded dataset to target directory.")),
    }
}

/// What the finished project directory contains.
struct ProjectContents {
    files: Vec<PathBuf>,
    total_size_in_bytes: i64,
}

impl FinishContext<'_> {
    /// Scala `finishAlignmentProjectUpload`.
    pub async fn finish_alignment_project_upload(
        &self,
        upload_id: &str,
        alignment_project_id: &str,
    ) -> DsResult<()> {
        let store = self.uploads.store(DOMAIN);
        let source = store
            .find_data_source_id(upload_id)
            .await?
            .ok_or_else(DsError::empty)?;
        tracing::info!(
            "Finishing {}...",
            upload_full_name(DOMAIN, upload_id, alignment_project_id, &source)
        );
        let upload_dir =
            self.uploads
                .upload_directory_for(&source.organization_id, upload_id, DOMAIN)?;
        self.check_within_requested_file_size(&upload_dir, upload_id, alignment_project_id, DOMAIN)
            .await
            .map_err(|e| e.wrap("File size check failed during dataset upload."))?;
        self.check_all_chunks_uploaded(upload_id, DOMAIN)
            .await
            .map_err(|e| e.wrap("Could not verify that all chunks have been uploaded."))?;
        let target_dir = self
            .uploads
            .alignment_project_dir_for(&source.organization_id, alignment_project_id)?;
        let (from, to, id) = (
            upload_dir.clone(),
            target_dir.clone(),
            alignment_project_id.to_owned(),
        );
        blocking(move || {
            if to.exists() {
                return Err(DsError::failure(msg::directory_exists(
                    &to.to_string_lossy(),
                )));
            }
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).map_err(io_failure)?;
            }
            unpack_or_move(&from, &to, &id)
        })
        .await?;
        self.uploads
            .clean_up_uploaded(upload_id, "Upload complete, data unpacked.", DOMAIN)
            .await?;
        let dir = target_dir.clone();
        let contents = blocking(move || {
            let files = list_files_recursive(&dir, usize::MAX)?;
            let size = size_of_directory(&dir)
                .map_err(io_failure)
                .map_err(|e| e.wrap("Could not measure total size of uploaded dataset."))?;
            Ok::<_, DsError>(ProjectContents {
                files,
                total_size_in_bytes: size as i64,
            })
        })
        .await?;
        let csv_files: Vec<&PathBuf> = contents
            .files
            .iter()
            .filter(|file| {
                file.file_name()
                    .is_some_and(|name| name.to_string_lossy().to_lowercase().ends_with(".csv"))
            })
            .collect();
        let section_range = match csv_files.as_slice() {
            [csv] => {
                let csv = (*csv).clone();
                blocking(move || tile_csv::parse_section_range_file(&csv)).await
            }
            [] => Err(DsError::failure(tile_csv::msg::NOT_FOUND)),
            many => Err(DsError::failure(tile_csv::msg::multiple_found(
                &many
                    .iter()
                    .map(|file| relative_to(&target_dir, file))
                    .collect::<Vec<_>>(),
            ))),
        };
        let csv_path = match csv_files.as_slice() {
            [csv] => Some(relative_to(&target_dir, csv)),
            _ => None,
        };
        let (section_range, invalid_reason) = match section_range {
            Ok(range) => (Some(range), None),
            Err(e) => (None, Some(e.message)),
        };
        self.wk_client
            .report_alignment_project_upload(&ReportAlignmentProjectUploadParameters {
                alignment_project_id: alignment_project_id.to_owned(),
                csv_path,
                file_count: contents.files.len() as i64,
                total_size_in_bytes: contents.total_size_in_bytes,
                section_range,
                invalid_reason,
            })
            .await
            .map_err(|e| e.wrap(msg::REPORT_UPLOAD_FAILED))
    }
}
