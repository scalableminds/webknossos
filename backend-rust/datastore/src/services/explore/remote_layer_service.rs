//! Scala `ExploreRemoteLayerService`.

use futures::future::join_all;

use crate::{
    error::{DsError, DsResult},
    models::{DataSourceId, UPath, UsableDataSource, VoxelSize},
};
use webknossos_common::explore_layers::Explored;

use super::{
    layer_utils::{
        adapt_layers_and_voxel_size, remove_header_file_names_from_uri_suffix,
        remove_neuroglancer_prefixes_from_uri,
    },
    remote_layer_explorer::{ExploreContext, Explorer},
};

pub(super) const MAX_RECURSIVE_SEARCH_DEPTH: usize = 3;
pub(super) const MAX_EXPLORED_ITEMS_PER_LEVEL: usize = 10;

/// Scala `ExploreRemoteLayerParameters`.
#[derive(Debug, Clone)]
pub struct ExploreRemoteLayerParameters {
    pub remote_uri: String,
    pub credential_id: Option<String>,
    pub preferred_voxel_size: Option<VoxelSize>,
}

/// Scala `ExploreRemoteLayerService` (credentials and S3 endpoints come from the vault service).
pub struct ExploreRemoteLayerService<'a> {
    pub ctx: ExploreContext,
    pub wk_client: &'a crate::clients::wk::WkClient,
    pub local_directory_whitelist: &'a [String],
}

impl ExploreRemoteLayerService<'_> {
    /// Scala `exploreRemoteDatasource`.
    pub async fn explore_remote_datasource(
        &self,
        parameters: &[ExploreRemoteLayerParameters],
        report: &mut Vec<String>,
    ) -> DsResult<UsableDataSource> {
        let mut explored = Vec::new();
        for p in parameters {
            explored.extend(
                self.explore_one_uri(&p.remote_uri, p.credential_id.as_deref(), report)
                    .await?,
            );
        }
        let preferred = parameters.iter().find_map(|p| p.preferred_voxel_size);
        if explored.is_empty() {
            return Err(DsError::failure("Detected zero layers"));
        }
        let (layers, voxel_size) = adapt_layers_and_voxel_size(explored, preferred)?;
        Ok(UsableDataSource {
            id: DataSourceId::new("", ""),
            data_layers: layers,
            scale: voxel_size,
            default_view_configuration: None,
            status_opt: None,
        })
    }

    async fn explore_one_uri(
        &self,
        uri: &str,
        credential_id: Option<&str>,
        report: &mut Vec<String>,
    ) -> DsResult<Vec<Explored>> {
        let cleaned =
            remove_neuroglancer_prefixes_from_uri(&remove_header_file_names_from_uri_suffix(uri));
        let parsed = UPath::parse(&cleaned)
            .map_err(|e| DsError::from(e).wrap(format!("Received invalid URI: {uri}")))?;
        let credential = match credential_id {
            Some(id) => {
                let value = self.wk_client.get_credential(id).await?;
                Some(
                    crate::datavault::DataVaultCredential::from_json(&value)
                        .map_err(DsError::failure)?,
                )
            }
            None => None,
        };
        let parsed = self
            .ctx
            .vaults
            .insert_s3_endpoint_if_missing(&parsed, credential.as_ref())
            .await?;
        let upath = match &parsed {
            UPath::ZipEntry(..) => parsed.clone(),
            _ if [".zip", ".ozx"]
                .iter()
                .any(|e| parsed.to_string().to_lowercase().ends_with(e)) =>
            {
                UPath::ZipEntry(Box::new(parsed.clone()), String::new())
            }
            _ => parsed.clone(),
        };
        if !upath.is_remote() {
            let allowed = self.local_directory_whitelist.iter().any(|entry| {
                upath.starts_with(&UPath::from_local_path(std::path::Path::new(entry)))
            });
            if !allowed {
                return Err(DsError::failure(format!(
                    "Absolute path {upath} in local file system is not in path whitelist. Consider adding it to datastore.localDirectoryWhitelist"
                )));
            }
        }
        let path = self
            .ctx
            .vaults
            .vault_path_for_credentialized(crate::datavault::CredentializedUPath::new(
                upath, credential,
            ))
            .await
            .map_err(|e| e.wrap("Failed to set up remote file system"))?;
        let mut queue = vec![(path, 0usize)];
        let explorers = Explorer::REMOTE;
        while !queue.is_empty() {
            let (path, depth) = queue.remove(0);
            if depth > MAX_RECURSIVE_SEARCH_DEPTH {
                return Err(DsError::empty());
            }
            let results = join_all(
                explorers
                    .iter()
                    .map(|e| e.explore(&self.ctx, &path, credential_id)),
            )
            .await;
            let mut found = None;
            for (explorer, result) in explorers.iter().zip(results) {
                match result {
                    Ok(layers) => {
                        report.push(format!(
                            "Found {} {} layers at {path}.",
                            layers.len(),
                            explorer.name()
                        ));
                        found.get_or_insert(layers);
                    }
                    Err(e) => report.push(format!(
                        "Error when reading {path} as {}: {e}",
                        explorer.name()
                    )),
                }
            }
            if let Some(layers) = found {
                return Ok(layers);
            }
            let children = path
                .list_directory(MAX_EXPLORED_ITEMS_PER_LEVEL, self.ctx.token())
                .await
                .map_err(DsError::from)?;
            queue.extend(children.into_iter().map(|c| (c, depth + 1)));
        }
        // Scala `Fox.empty` once nothing is left to search.
        Err(DsError::empty())
    }
}
