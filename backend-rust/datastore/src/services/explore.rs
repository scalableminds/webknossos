//! Scala `explore` package: guess WEBKNOSSOS layers from Zarr / Zarr3 / OME-NGFF / N5 /
//! Neuroglancer precomputed data (and Neuroglancer URIs) reachable through data vaults.
//!
//! Every explorer returns layers with the voxel size they were found at; `ExploreRemoteLayerService`
//! tries all explorers per path (first success wins, in explorer order), recurses into up to 10
//! children per directory for at most 3 levels, and finally unifies voxel sizes across layers.

mod layer_utils;
mod local_layer_service;
mod n5;
mod neuroglancer;
mod ngff;
mod precomputed;
mod remote_layer_explorer;
mod remote_layer_service;
mod webknossos_zarr;
mod zarr3_array;
mod zarr_array;

pub use layer_utils::format_failure;
pub use local_layer_service::{explore_local, write_local_datasource_properties};
pub use remote_layer_explorer::ExploreContext;
pub use remote_layer_service::{ExploreRemoteLayerParameters, ExploreRemoteLayerService};
pub use webknossos_common::explore_layers::make_layer_names_unique;

#[cfg(test)]
mod services_explore_tests;
