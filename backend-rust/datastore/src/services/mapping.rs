//! Scala `MappingService` (JSON mapping files): `<orgaDir>/<dataset>/<layer>/mappings/<name>.json`.
//! Typed JSON mapping application for ad-hoc meshing, with configured caching.
use std::path::{Path, PathBuf};

use crate::{
    error::{DsError, DsResult},
    models::DataSourceId,
    services::BaseDirService,
};

const MAPPINGS_DIR: &str = "mappings";
const MAPPING_FILE_EXTENSION: &str = "json";

/// `FileNotFoundException.getMessage` style: `<path> (<OS reason>)`.
fn java_file_error(path: &Path, error: &std::io::Error) -> String {
    let reason = error.to_string();
    let reason = reason
        .rfind(" (os error ")
        .map_or(reason.as_str(), |i| &reason[..i]);
    format!("{} ({reason})", path.display())
}

/// Scala `loadMappingBytes`. Mapping names with path separators are refused (Play decodes `%2F`
/// in path parameters; Scala would resolve such names outside the mappings directory).
pub fn load_mapping_bytes(
    base_dirs: &BaseDirService,
    data_source_id: &DataSourceId,
    layer_name: &str,
    mapping: &str,
) -> DsResult<Vec<u8>> {
    if mapping.contains(['/', '\\']) || layer_name.contains(['/', '\\']) {
        return Err(DsError::failure(format!(
            "Invalid mapping name “{mapping}”."
        )));
    }
    let orga_dir =
        base_dirs.get_one_local_for_org(&data_source_id.organization_id, false, false, false)?;
    let path: PathBuf = orga_dir
        .join(&data_source_id.directory_name)
        .join(layer_name)
        .join(MAPPINGS_DIR)
        .join(format!("{mapping}.{MAPPING_FILE_EXTENSION}"));
    std::fs::read(&path).map_err(|e| DsError::failure(java_file_error(&path, &e)))
}

/// Scala `exploreMappings`: regular files ending in `.json` directly in `<layerDir>/mappings`,
/// without the extension. Scala returns a `Set` (unspecified order); sorted here.
pub fn explore_mappings(layer_dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(layer_dir.join(MAPPINGS_DIR)) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        // `Files.isRegularFile` follows symbolic links.
        .filter(|p| p.is_file())
        .filter_map(|p| {
            let name = p.file_name()?.to_str()?.to_owned();
            name.ends_with(&format!(".{MAPPING_FILE_EXTENSION}"))
                .then(|| name[..name.len() - MAPPING_FILE_EXTENSION.len() - 1].to_owned())
        })
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explores_json_files_only() {
        let dir = std::env::temp_dir().join(format!("wk-mappings-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("mappings/sub.json")).unwrap();
        for name in ["b.json", "a.json", "c.JSON", "d.json.bak", "e.v2.json"] {
            std::fs::write(dir.join("mappings").join(name), b"{}").unwrap();
        }
        assert_eq!(explore_mappings(&dir), ["a", "b", "e.v2"]);
        assert!(explore_mappings(&dir.join("missing")).is_empty());
    }
}

use crate::{models::ElementClass, wk_client::AlfuCache};
use std::{collections::HashMap, sync::Arc, time::Duration};
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct MappingKey {
    source: DataSourceId,
    layer: String,
    name: String,
    width: usize,
}
pub struct MappingService {
    base_dirs: BaseDirService,
    cache: AlfuCache<MappingKey, Arc<HashMap<u64, u64>>>,
}
impl MappingService {
    pub fn new(base_dirs: BaseDirService, max_entries: usize) -> Self {
        Self {
            base_dirs,
            cache: AlfuCache::new(
                max_entries,
                Duration::from_secs(7200),
                Duration::from_secs(3600),
            ),
        }
    }
    pub fn clear_caches(&self, source: &DataSourceId, layer: Option<&str>) -> usize {
        self.cache
            .clear_matching(|k| k.source == *source && layer.is_none_or(|l| l == k.layer))
    }
    pub async fn load(
        &self,
        source: &DataSourceId,
        layer: &str,
        name: &str,
        width: usize,
    ) -> DsResult<Arc<HashMap<u64, u64>>> {
        let key = MappingKey {
            source: source.clone(),
            layer: layer.into(),
            name: name.into(),
            width,
        };
        self.cache
            .get_or_load(key.clone(), || async {
                let dirs = self.base_dirs.clone();
                tokio::task::spawn_blocking(move || {
                    let bytes = load_mapping_bytes(&dirs, &key.source, &key.layer, &key.name)?;
                    Ok(Arc::new(parse_mapping(&bytes, key.width)?))
                })
                .await
                .map_err(DsError::from_exception)?
            })
            .await
    }
}
pub fn integer_width(class: ElementClass) -> DsResult<usize> {
    match class {
        ElementClass::Uint8 | ElementClass::Int8 => Ok(1),
        ElementClass::Uint16 | ElementClass::Int16 => Ok(2),
        ElementClass::Uint32 | ElementClass::Int32 => Ok(4),
        ElementClass::Uint64 | ElementClass::Int64 => Ok(8),
        _ => Err(DsError::failure(
            "Unsupported element class for ad-hoc meshing.",
        )),
    }
}
pub fn narrow_id(id: u64, width: usize) -> u64 {
    if width == 8 {
        id
    } else {
        id & ((1u64 << (width * 8)) - 1)
    }
}
/// Gson nextLong accepts numeric strings and integral floating representations, then Scala
/// narrows both keys and representatives to the layer's storage type before building its map.
pub fn parse_mapping(bytes: &[u8], width: usize) -> DsResult<HashMap<u64, u64>> {
    if ![1, 2, 4, 8].contains(&width) {
        return Err(DsError::failure("Invalid mapping element width."));
    }
    let json: serde_json::Value = serde_json::from_slice(bytes).map_err(DsError::from_exception)?;
    let obj = json
        .as_object()
        .ok_or_else(|| DsError::failure("Expected mapping object."))?;
    let Some(name) = obj.get("name") else {
        return Err(DsError::empty());
    };
    if !name.is_string() && !name.is_number() {
        return Err(DsError::failure("Expected mapping name."));
    }
    let Some(classes) = obj.get("classes") else {
        return Err(DsError::empty());
    };
    let classes = classes
        .as_array()
        .ok_or_else(|| DsError::failure("Expected mapping classes array."))?;
    let mut mapping = HashMap::new();
    for class in classes {
        let ids = class
            .as_array()
            .ok_or_else(|| DsError::failure("Expected mapping class array."))?;
        let mut first = None;
        for id in ids {
            let signed = if let Some(n) = id.as_i64() {
                Some(n)
            } else {
                let value = if let Some(s) = id.as_str() {
                    s.parse::<i64>().ok().map(|i| i as u64)
                } else {
                    None
                };
                if let Some(value) = value {
                    Some(value as i64)
                } else {
                    let float = id.as_f64().or_else(|| id.as_str()?.parse::<f64>().ok());
                    float
                        .filter(|f| f.is_finite() && *f == (*f as i64) as f64)
                        .map(|f| f as i64)
                }
            }
            .ok_or_else(|| DsError::failure("Expected mapping signed Long id."))?;
            let current = narrow_id(signed as u64, width);
            if let Some(first) = first {
                mapping.insert(current, first);
            } else {
                first = Some(current);
            }
        }
    }
    Ok(mapping)
}
