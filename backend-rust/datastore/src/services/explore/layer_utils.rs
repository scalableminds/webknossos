//! Scala `ExploreLayerUtils`: layer set utilities.

use crate::{
    error::{DsError, DsResult},
    models::{StaticLayer, VoxelSize},
};
use webknossos_common::explore_layers::Explored;

/// Scala `formatFailureChain` (an `Empty` box renders as `Empty`).
pub fn format_failure(error: &DsError) -> String {
    if *error == DsError::empty() {
        "Empty".to_owned()
    } else {
        error.to_string()
    }
}

/// Scala `ExploreLayerUtils.adaptLayersAndVoxelSize`, failing with Scala's failure chain.
pub(super) fn adapt_layers_and_voxel_size(
    explored: Vec<Explored>,
    preferred: Option<VoxelSize>,
) -> DsResult<(Vec<StaticLayer>, VoxelSize)> {
    webknossos_common::explore_layers::adapt_layers_and_voxel_size(explored, preferred).map_err(
        |messages| {
            let mut messages = messages.into_iter();
            let innermost = DsError::failure(messages.next().unwrap_or_default());
            messages.fold(innermost, DsError::wrap)
        },
    )
}

/// Scala `removeHeaderFileNamesFromUriSuffix`.
pub(super) fn remove_header_file_names_from_uri_suffix(uri: &str) -> String {
    let mut out = uri;
    for suffix in [
        "attributes.json",
        ".zarray",
        ".zattrs",
        ".zgroup",
        "info",
        "zarr.json",
    ] {
        out = out.strip_suffix(suffix).unwrap_or(out);
    }
    out.to_owned()
}

/// Scala `removeNeuroglancerPrefixesFromUri`.
pub(super) fn remove_neuroglancer_prefixes_from_uri(uri: &str) -> String {
    let mut out = uri;
    for prefix in ["zarr3://", "zarr://", "precomputed://", "n5://"] {
        out = out.strip_prefix(prefix).unwrap_or(out);
    }
    out.to_owned()
}
