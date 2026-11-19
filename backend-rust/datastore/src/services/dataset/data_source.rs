//! DataSourceService disk loading, attachment scanning, path resolution and vault invalidation.
//! Blocking disk operations are called via spawn_blocking from controllers.
use crate::{
    datavault::DataVaultService,
    models::{
        DataLayerAttachments, DataSource, DataSourceId, FILENAME_DATASOURCE_PROPERTIES_JSON,
        LayerAttachment, LayerAttachmentDataformat, StaticLayer, UPath, UnusableDataSource,
        UsableDataSource, status,
    },
};
use serde_json::Value;
use std::path::Path;

#[derive(Clone)]
pub struct DataSourceService {
    vaults: DataVaultService,
}
impl DataSourceService {
    pub fn new(vaults: DataVaultService) -> Self {
        Self { vaults }
    }

    pub fn vaults(&self) -> &DataVaultService {
        &self.vaults
    }

    /// Folder/organization identity overrides the id stored in the properties file.
    pub fn data_source_from_dir(
        &self,
        path: &Path,
        organization: &str,
        resolve_paths: bool,
    ) -> DataSource {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let id = DataSourceId::new(name, organization);
        let file = path.join(FILENAME_DATASOURCE_PROPERTIES_JSON);
        if !file.exists() {
            return DataSource::Unusable(UnusableDataSource::new(id, status::NOT_IMPORTED_YET));
        }
        let json = parse_properties_file(&file);
        let parsed = json.as_ref().map_err(Clone::clone).and_then(|v| {
            UsableDataSource::from_json(v).map_err(|e| e.validation_failure_message())
        });
        match parsed {
            Ok(mut source) => {
                let errors = source.validation_errors();
                if !errors.is_empty() {
                    return DataSource::Unusable(UnusableDataSource {
                        id,
                        data_layers: None,
                        status: format!("Error: {}", errors.join(" ")),
                        scale: Some(source.scale),
                        existing_data_source_properties: serde_json::to_value(&source).ok(),
                    });
                }
                source.data_layers = source
                    .data_layers
                    .iter()
                    .map(|layer| {
                        let layer = layer.with_merged_attachments(
                            &scan_attachments(&path.join(&layer.name))
                                .relativized_in(&UPath::from_local_path(path)),
                        );
                        if resolve_paths {
                            resolve_layer_paths(path, &layer)
                        } else {
                            layer
                        }
                    })
                    .collect();
                source.id = id;
                DataSource::Usable(source)
            }
            Err(error) => DataSource::Unusable(UnusableDataSource {
                id,
                data_layers: None,
                status: format!("Error: Invalid json format in {}: {error}", file.display()),
                scale: None,
                existing_data_source_properties: json.ok(),
            }),
        }
    }

    /// Uploads/remote source moves resolve implicit paths without probing for a local mag dir.
    pub fn resolve_paths_in_new_base_path(
        source: &UsableDataSource,
        base: &UPath,
    ) -> UsableDataSource {
        let mut source = source.clone();
        for layer in &mut source.data_layers {
            for mag in &mut layer.mags {
                mag.path = Some(match &mag.path {
                    Some(path) => path.resolved_in(base),
                    None => base.join(&layer.name).join(&mag.mag.to_mag_literal(true)),
                });
            }
            layer.attachments = layer.attachments.as_ref().map(|a| a.resolved_in(base));
        }
        source
    }

    /// Scala reports the number of mag references visited, not actual cache removals.
    /// Missing/invalid mag paths do not stop invalidation (Scala invokes each Fox independently).
    pub async fn invalidate_vault_cache(
        &self,
        source: &DataSource,
        name: Option<&str>,
    ) -> Option<usize> {
        let source = source.to_usable()?;
        let mut visited = 0;
        for layer in source
            .data_layers
            .iter()
            .filter(|l| name.is_none_or(|n| l.name == n))
        {
            for mag in &layer.mags {
                let _ = self.vaults.remove_vault_from_cache_for_mag(mag).await;
                visited += 1;
            }
            for attachment in layer.all_attachments() {
                self.vaults
                    .remove_vault_from_cache_for_attachment(attachment)
                    .await;
            }
        }
        Some(visited)
    }
}

fn resolve_layer_paths(path: &Path, layer: &StaticLayer) -> StaticLayer {
    let mut layer = layer.clone();
    for mag in &mut layer.mags {
        mag.path = Some(DataVaultService::resolve_mag_path(
            mag,
            path,
            &path.join(&layer.name),
        ));
    }
    layer.attachments = layer
        .attachments
        .as_ref()
        .map(|a| a.resolved_in(&UPath::from_local_path(path)));
    layer
}

fn parse_properties_file(file: &Path) -> Result<Value, String> {
    if file.is_dir() {
        return Err("Invalid path for json parsing.".into());
    }
    let text = std::fs::read_to_string(file).map_err(|_| {
        format!("Failed to parse Json in '{FILENAME_DATASOURCE_PROPERTIES_JSON}'. Access denied.")
    })?;
    // Scala Source.getLines().mkString drops LF, CRLF and CR separators before Json.parse.
    let joined: String = text.split(['\r', '\n']).collect();
    serde_json::from_str(&joined).map_err(|e| {
        format!("Failed to parse Json in '{FILENAME_DATASOURCE_PROPERTIES_JSON}': {e}")
    })
}

fn scan_files(
    layer_dir: &Path,
    directory: &str,
    format: LayerAttachmentDataformat,
) -> Vec<LayerAttachment> {
    let Ok(entries) = std::fs::read_dir(layer_dir.join(directory)) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let suffix = format!(".{format}");
    for entry in entries {
        let Ok(entry) = entry else { return Vec::new() };
        let path = entry.path();
        // Case-sensitive extension, non-directories (including hidden files), following symlinks.
        let filename = path.file_name().unwrap_or_default().to_string_lossy();
        if !path.is_dir() && filename.ends_with(&suffix) {
            found.push(LayerAttachment {
                name: filename
                    .rsplit_once('.')
                    .map_or(filename.as_ref(), |(stem, _)| stem)
                    .to_owned(),
                path: UPath::from_local_path(&path),
                data_format: format,
                credential_id: None,
            });
        }
    }
    found
}

fn scan_attachments(layer_dir: &Path) -> DataLayerAttachments {
    use LayerAttachmentDataformat::{Hdf5, Json};
    DataLayerAttachments {
        meshes: scan_files(layer_dir, "meshes", Hdf5),
        agglomerates: scan_files(layer_dir, "agglomerates", Hdf5),
        segment_index: scan_files(layer_dir, "segmentIndex", Hdf5)
            .into_iter()
            .next(),
        connectomes: scan_files(layer_dir, "connectomes", Hdf5),
        cumsum: scan_files(layer_dir, "agglomerates", Json)
            .into_iter()
            .next(),
        // Scala only discovers statistics through explicit datasource metadata.
        segment_statistics: None,
    }
}
