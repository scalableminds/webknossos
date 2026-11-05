//! Scala `guessTypeOfUploadedDataSource` and the WKW layer/mag layout fix-up.
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::filesystem::{list_directories, list_files_recursive, move_directory_via_temp, names};
use crate::{error::DsResult, models::FILENAME_DATASOURCE_PROPERTIES_JSON};

pub(super) const FILENAME_HEADER_WKW: &str = "header.wkw";
pub(super) const FILENAME_DOT_ZARRAY: &str = ".zarray";
pub(super) const FILENAME_DOT_ZATTRS: &str = ".zattrs";
pub(super) const FILENAME_ZARR_JSON: &str = "zarr.json";
const FILENAME_INFO: &str = "info";
const FILENAME_ATTRIBUTES_JSON: &str = "attributes.json";

/// Scala `UploadedDataSourceType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum UploadedDataSourceType {
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

pub(super) fn contains_matching_file(dir: &Path, names: &[&str], max_depth: usize) -> bool {
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
pub(super) fn guess_type(dir: &Path) -> UploadedDataSourceType {
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
pub(super) fn add_layer_and_mag_dir_if_missing(dir: &Path, header_file: &str) -> DsResult<()> {
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
