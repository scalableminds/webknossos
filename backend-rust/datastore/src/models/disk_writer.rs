//! Scala `services/DataSourceToDiskWriter` + `DataSourceValidation.assertValidDataSource`:
//! validates a data source, appends the previous `datasource-properties.json` to
//! `datasource-properties-backups.log` and writes the new file (paths relativized to the data
//! source directory, `resolutions` dropped, small `largestSegmentId`s as plain numbers).
//!
//! Blocking file IO (like the Scala trait); async callers wrap it in `spawn_blocking`.

use std::{fs::OpenOptions, io::Write, path::Path, time::SystemTime};

use serde_json::Value;

use super::datasource::{FILENAME_DATASOURCE_PROPERTIES_JSON, UsableDataSource};
use super::upath::UPath;
use crate::error::{DsError, format_iso_instant};

/// Scala `logFileName`.
pub const BACKUP_LOG_FILE_NAME: &str = "datasource-properties-backups.log";
/// Scala `Msg.Dataset.DataSource.updateFileFailed`.
pub const UPDATE_FILE_FAILED: &str = "Could not update datasource-properties.json file.";
/// Message of the validation `ParamFailure`.
pub const DATA_SOURCE_INVALID: &str = "DataSource is invalid";

/// Why [`update_data_source_on_disk`] failed.
#[derive(Debug, Clone, PartialEq)]
pub enum DiskWriteError {
    /// Scala `ParamFailure("DataSource is invalid", [{"error": msg}, ...])`; Scala's
    /// `boxToResult` answers `400 {"messages": <param>}` for it.
    Invalid(Value),
    /// A file system failure (already wrapped with [`UPDATE_FILE_FAILED`]).
    Failure(DsError),
}

impl DiskWriteError {
    /// Response body Scala renders for this failure: `{"messages": [...]}` for validation errors,
    /// otherwise the regular failure body.
    pub fn messages_body(&self) -> Option<Value> {
        match self {
            Self::Invalid(errors) => Some(serde_json::json!({ "messages": errors })),
            Self::Failure(_) => None,
        }
    }
}

/// Scala `assertValidDataSource`.
pub fn assert_valid_data_source(data_source: &UsableDataSource) -> Result<(), DiskWriteError> {
    match data_source.validation_error_json() {
        Some(errors) => Err(DiskWriteError::Invalid(errors)),
        None => Ok(()),
    }
}

/// Scala `updateDataSourceOnDisk`.
pub fn update_data_source_on_disk(
    data_source_path: &Path,
    data_source: &UsableDataSource,
) -> Result<(), DiskWriteError> {
    update_data_source_on_disk_at(data_source_path, data_source, SystemTime::now())
}

/// [`update_data_source_on_disk`] with an explicit backup timestamp (for tests).
pub fn update_data_source_on_disk_at(
    data_source_path: &Path,
    data_source: &UsableDataSource,
    now: SystemTime,
) -> Result<(), DiskWriteError> {
    assert_valid_data_source(data_source)?;
    backup_previous_properties(data_source_path, now)
        .map_err(|e| DiskWriteError::Failure(e.wrap(UPDATE_FILE_FAILED)))?;
    let relativized = relativize_paths_of_data_source(data_source_path, data_source);
    let content = relativized.to_properties_file_content();
    // `JsonHelper.writeToFile` → `FileIO.printToFile` (`Failure(ex.getMessage)`).
    std::fs::write(
        data_source_path.join(FILENAME_DATASOURCE_PROPERTIES_JSON),
        content,
    )
    .map_err(|e| {
        DiskWriteError::Failure(
            DsError::failure(java_file_error_message(
                &data_source_path.join(FILENAME_DATASOURCE_PROPERTIES_JSON),
                &e,
            ))
            .wrap(UPDATE_FILE_FAILED),
        )
    })
}

/// Scala `relativizePathsOfDataSource`.
pub fn relativize_paths_of_data_source(
    data_source_path: &Path,
    data_source: &UsableDataSource,
) -> UsableDataSource {
    let base = UPath::from_local_path(data_source_path);
    UsableDataSource {
        data_layers: data_source
            .data_layers
            .iter()
            .map(|layer| layer.relativize_paths(&base))
            .collect(),
        ..data_source.clone()
    }
}

/// Scala `backupPreviousProperties`.
fn backup_previous_properties(data_source_path: &Path, now: SystemTime) -> Result<(), DsError> {
    let properties_file = data_source_path.join(FILENAME_DATASOURCE_PROPERTIES_JSON);
    let previous_content = if properties_file.exists() {
        // `Source.fromFile(..).getLines().mkString("\n")`.
        let bytes = std::fs::read(&properties_file)
            .map_err(|e| DsError::failure(java_file_error_message(&properties_file, &e)))?;
        java_lines(&String::from_utf8_lossy(&bytes)).join("\n")
    } else {
        "<empty>".to_owned()
    };
    let output = format!(
        "Contents of {FILENAME_DATASOURCE_PROPERTIES_JSON} were changed by WEBKNOSSOS at {}. Old content: \n\n{previous_content}\n\n",
        format_iso_instant(now)
    );
    let log_path = data_source_path.join(BACKUP_LOG_FILE_NAME);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut file| file.write_all(output.as_bytes()))
        .map_err(|e| {
            DsError::failure(format!(
                "Could not back up old contents: java.io.FileNotFoundException: {}",
                java_file_error_message(&log_path, &e)
            ))
        })
}

/// `BufferedReader.readLine` splitting: `\n`, `\r\n` and `\r` end a line; no empty last line.
fn java_lines(content: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut rest = content;
    while !rest.is_empty() {
        match rest.find(['\n', '\r']) {
            Some(idx) => {
                lines.push(&rest[..idx]);
                let skip = if rest[idx..].starts_with("\r\n") {
                    2
                } else {
                    1
                };
                rest = &rest[idx + skip..];
            }
            None => {
                lines.push(rest);
                rest = "";
            }
        }
    }
    lines
}

/// `FileNotFoundException.getMessage` style: `<path> (<OS reason>)`.
fn java_file_error_message(path: &Path, error: &std::io::Error) -> String {
    let reason = error.to_string();
    let reason = match reason.rfind(" (os error ") {
        Some(idx) => reason[..idx].to_owned(),
        None => reason,
    };
    format!("{} ({reason})", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_line_splitting() {
        assert_eq!(java_lines("a\nb\r\nc\rd\n"), vec!["a", "b", "c", "d"]);
        assert_eq!(java_lines("a\n\nb"), vec!["a", "", "b"]);
        assert!(java_lines("").is_empty());
    }
}
