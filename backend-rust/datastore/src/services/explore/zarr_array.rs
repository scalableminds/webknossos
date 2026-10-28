//! Scala `ZarrArrayExplorer`.

use crate::{
    datareaders::{DatasetHeader, zarr::ZarrHeader},
    datavault::VaultPath,
    error::DsResult,
    models::{Vec3Int, enums::DataFormat},
};
use webknossos_common::explore_layers::Explored;

use super::remote_layer_explorer::{
    ExploreContext, bounding_box_of, element_class_of, layer, looks_like_segmentation_layer,
    mag_locator, unit_voxel_size, zyx_from_rank,
};

/// Scala `ZarrArrayExplorer`.
pub(super) async fn explore_zarr_array(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
    mag: Vec3Int,
) -> DsResult<Vec<Explored>> {
    let zarray_path = path.join(crate::datareaders::zarr::FILENAME_DOT_ZARRAY);
    let name = path.basename();
    let json = ctx
        .read_json_or(
            &zarray_path,
            format!("failed to read zarr header at {zarray_path}"),
        )
        .await?;
    let header = ZarrHeader::from_json(&json)
        .map_err(|e| e.wrap(format!("failed to read zarr header at {zarray_path}")))?;
    let element_class = element_class_of(&header, "failed to read element class from zarr header")?;
    let axis_order = zyx_from_rank(header.rank());
    let bbox = bounding_box_of(
        &header,
        &axis_order,
        "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format",
    )?;
    let locator = mag_locator(mag, path, axis_order, None, credential_id);
    let segmentation = looks_like_segmentation_layer(&name, element_class);
    Ok(vec![(
        layer(
            &name,
            DataFormat::Zarr,
            bbox,
            element_class,
            vec![locator],
            segmentation,
        ),
        unit_voxel_size(),
    )])
}
