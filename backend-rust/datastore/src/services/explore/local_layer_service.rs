//! Scala `ExploreLocalLayerService`.

use crate::{
    datareaders::n5::N5Header,
    error::{DsError, DsResult},
    models::{DataSourceId, StaticLayer, UPath, UsableDataSource, Vec3Int},
};

use super::{
    layer_utils::adapt_layers_and_voxel_size,
    remote_layer_explorer::{ExploreContext, Explorer},
};

fn local_upath(path: &std::path::Path) -> UPath {
    let upath = UPath::from_local_path(path);
    if [".zip", ".ozx"]
        .iter()
        .any(|e| path.to_string_lossy().to_lowercase().ends_with(e))
    {
        UPath::ZipEntry(Box::new(upath), String::new())
    } else {
        upath
    }
}

fn map_mag_paths(layers: Vec<StaticLayer>, f: impl Fn(&UPath) -> UPath) -> Vec<StaticLayer> {
    layers
        .into_iter()
        .map(|mut layer| {
            for mag in &mut layer.mags {
                mag.path = mag.path.as_ref().map(&f);
            }
            layer
        })
        .collect()
}

/// Scala `selectLastDirectory`.
fn select_last_directory(p: &UPath) -> UPath {
    let parent = p.parent();
    if &parent == p {
        p.clone()
    } else {
        p.relativized_in(&parent)
    }
}

/// Scala `selectLastTwoDirectories`.
fn select_last_two_directories(p: &UPath) -> UPath {
    let parent = p.parent();
    let grand_parent = parent.parent();
    if &parent == p || grand_parent == parent {
        p.clone()
    } else {
        p.relativized_in(&grand_parent)
    }
}

fn directory_entries(path: &std::path::Path) -> DsResult<Vec<std::path::PathBuf>> {
    let mut entries: Vec<_> = std::fs::read_dir(path)
        .map_err(|e| DsError::failure(e.to_string()))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect();
    entries.sort();
    Ok(entries)
}

/// Scala `exploreLocalLayer`.
async fn explore_local_layer(
    ctx: &ExploreContext,
    explorer: Explorer,
    relative: fn(&UPath) -> UPath,
    path: &std::path::Path,
    id: &DataSourceId,
    layer_directory: &str,
) -> DsResult<UsableDataSource> {
    let layer = if layer_directory.is_empty() {
        match directory_entries(path)?.as_slice() {
            [single] => single
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            _ => String::new(),
        }
    } else {
        layer_directory.to_owned()
    };
    let resolved = if layer.is_empty() {
        path.to_path_buf()
    } else {
        path.join(&layer)
    };
    let vault_path = ctx
        .vaults
        .vault_path_for(&local_upath(&resolved))
        .await
        .map_err(|e| e.wrap("Failed to set up remote file system"))?;
    let explored = explorer.explore(ctx, &vault_path, None).await?;
    let (layers, voxel_size) = adapt_layers_and_voxel_size(explored, None)?;
    Ok(UsableDataSource {
        id: id.clone(),
        data_layers: map_mag_paths(layers, relative),
        scale: voxel_size,
        default_view_configuration: None,
        status_opt: None,
    })
}

/// Scala `exploreLocalZarrArray`: every entry of the layer directory must be a mag directory.
async fn explore_local_zarr_array(
    ctx: &ExploreContext,
    path: &std::path::Path,
    id: &DataSourceId,
    layer_directory: &str,
) -> DsResult<UsableDataSource> {
    let dir = if layer_directory.is_empty() {
        path.to_path_buf()
    } else {
        path.join(layer_directory)
    };
    let entries = directory_entries(&dir).map_err(|e| {
        e.wrap(format!(
            "Could not resolve color directory as child of {}",
            path.display()
        ))
    })?;
    let mut explored = Vec::new();
    for entry in entries {
        let name = entry
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let mag = Vec3Int::from_mag_literal(&name, true)
            .ok_or_else(|| DsError::failure(format!("invalid mag: {name}")))?;
        let vault_path = ctx
            .vaults
            .vault_path_for(&UPath::from_local_path(&entry))
            .await
            .map_err(|e| e.wrap("Failed to set up remote file system"))?;
        explored.extend(
            Explorer::ZarrArray(mag)
                .explore(ctx, &vault_path, None)
                .await?,
        );
    }
    let (layers, voxel_size) = adapt_layers_and_voxel_size(explored, None)?;
    Ok(UsableDataSource {
        id: id.clone(),
        data_layers: map_mag_paths(layers, select_last_two_directories),
        scale: voxel_size,
        default_view_configuration: None,
        status_opt: None,
    })
}

fn has_n5_header(dir: &std::path::Path) -> bool {
    std::fs::read(dir.join("attributes.json")).is_ok_and(|b| N5Header::parse(&b).is_ok())
}

/// Scala `PathUtils.recurseSubdirsUntil` (depth-first, max depth 10).
fn recurse_subdirs_until(
    path: &std::path::Path,
    condition: &dyn Fn(&std::path::Path) -> bool,
    depth: usize,
) -> Option<std::path::PathBuf> {
    if depth > 10 {
        return None;
    }
    if condition(path) {
        return Some(path.to_path_buf());
    }
    directory_entries(path)
        .ok()?
        .into_iter()
        .filter(|p| p.is_dir())
        .find_map(|dir| recurse_subdirs_until(&dir, condition, depth + 1))
}

/// Scala `exploreLocalN5Array`.
async fn explore_local_n5_array(
    ctx: &ExploreContext,
    path: &std::path::Path,
    id: &DataSourceId,
) -> DsResult<UsableDataSource> {
    let layer_path =
        recurse_subdirs_until(path, &has_n5_header, 0).unwrap_or_else(|| path.to_path_buf());
    let base = UPath::from_local_path(path);
    let mut explored =
        explore_local_layer(ctx, Explorer::N5Array, Clone::clone, &layer_path, id, "").await?;
    explored.data_layers = map_mag_paths(explored.data_layers, |p| p.relativized_in(&base));
    Ok(explored)
}

/// Scala `ExploreLocalLayerService.exploreLocal`: first successful local explorer.
pub async fn explore_local(
    ctx: &ExploreContext,
    path: &std::path::Path,
    id: &DataSourceId,
    layer_directory: &str,
) -> DsResult<UsableDataSource> {
    let attempts = [
        explore_local_layer(
            ctx,
            Explorer::NgffV0_4,
            select_last_two_directories,
            path,
            id,
            "",
        )
        .await,
        explore_local_layer(
            ctx,
            Explorer::NgffV0_5,
            select_last_two_directories,
            path,
            id,
            "",
        )
        .await,
        explore_local_zarr_array(ctx, path, id, layer_directory).await,
        explore_local_layer(
            ctx,
            Explorer::Precomputed,
            select_last_directory,
            path,
            id,
            layer_directory,
        )
        .await,
        explore_local_layer(
            ctx,
            Explorer::N5CompactMultiscales,
            select_last_directory,
            path,
            id,
            layer_directory,
        )
        .await,
        explore_local_layer(
            ctx,
            Explorer::N5Multiscales,
            select_last_directory,
            path,
            id,
            layer_directory,
        )
        .await,
        explore_local_n5_array(ctx, path, id).await,
    ];
    let mut last = DsError::empty();
    for attempt in attempts {
        match attempt {
            Ok(source) => return Ok(source),
            Err(e) => last = e,
        }
    }
    Err(last.wrap("Could not explore local data source"))
}

/// Scala `writeLocalDatasourceProperties` (compact JSON).
pub fn write_local_datasource_properties(
    source: &UsableDataSource,
    path: &std::path::Path,
) -> DsResult<()> {
    let value = serde_json::to_value(source).map_err(DsError::from_exception)?;
    let bytes = serde_json::to_vec(&crate::models::json::PlayValue(&value))
        .map_err(DsError::from_exception)?;
    std::fs::write(
        path.join(crate::models::FILENAME_DATASOURCE_PROPERTIES_JSON),
        bytes,
    )
    .map_err(|e| DsError::failure(e.to_string()))
}
