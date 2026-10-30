//! Scala `WebknossosZarrExplorer`.

use crate::{
    datavault::{ByteRange, VaultPath},
    error::{DsError, DsResult},
    models::{MagLocator, StaticLayer, UsableDataSource, enums::DataFormat},
};
use webknossos_common::explore_layers::Explored;

use super::remote_layer_explorer::ExploreContext;

/// Scala `WebknossosZarrExplorer`: a WEBKNOSSOS Zarr streaming datasource with resolved paths.
pub(super) async fn explore_webknossos_zarr(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let properties = path.join(crate::models::FILENAME_DATASOURCE_PROPERTIES_JSON);
    let json = ctx.read_json(&properties).await.map_err(DsError::from)?;
    let source = UsableDataSource::from_json(&json)
        .map_err(|e| DsError::failure(e.validation_failure_message()))?;
    let base = path.upath().clone();
    let mut result = Vec::new();
    for layer in &source.data_layers {
        let header = match layer.data_format {
            DataFormat::Zarr => crate::datareaders::zarr::FILENAME_DOT_ZARRAY,
            DataFormat::Zarr3 => crate::datareaders::zarr3::FILENAME_ZARR_JSON,
            other => {
                return Err(DsError::failure(format!(
                    "Invalid layer dataformat {other}, can only explore zarr, zarr3 as WebknossosZarr"
                )));
            }
        };
        let mut mags = Vec::new();
        for mag in &layer.mags {
            let resolved = match &mag.path {
                Some(p) => p.resolved_in(&base),
                None => {
                    let mag_path = path.join(&layer.name).join(&mag.mag.to_mag_literal(true));
                    mag_path
                        .join(header)
                        .read_bytes(ByteRange::Complete, ctx.token())
                        .await
                        .map_err(|e| DsError::from(e.wrap(format!("Could not find {mag_path}"))))?;
                    mag_path.upath().clone()
                }
            };
            mags.push(MagLocator {
                path: Some(resolved),
                credential_id: credential_id.map(str::to_owned),
                ..mag.clone()
            });
        }
        let attachments = layer.attachments.as_ref().map(|a| a.resolved_in(&base));
        result.push((
            StaticLayer {
                mags,
                attachments,
                ..layer.clone()
            },
            source.scale,
        ));
    }
    Ok(result)
}
