//! Scala `Zarr3ArrayExplorer`.

use crate::{
    datareaders::{DatasetHeader, zarr3::Zarr3Header},
    datavault::VaultPath,
    error::DsResult,
    models::{AxisOrder, Vec3Int, enums::DataFormat},
};
use webknossos_common::explore_layers::Explored;

use super::remote_layer_explorer::{
    ExploreContext, bounding_box_of, element_class_of, layer, looks_like_segmentation_layer,
    mag_locator, unit_voxel_size,
};

/// Scala `Zarr3ArrayExplorer`.
pub(super) async fn explore_zarr3_array(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let json_path = path.join(crate::datareaders::zarr3::FILENAME_ZARR_JSON);
    let name = path.basename();
    let json = ctx
        .read_json_or(
            &json_path,
            format!("failed to read zarr v3 header at {json_path}"),
        )
        .await?;
    let header = Zarr3Header::for_exploration(&json)?;
    let element_class = element_class_of(&header, "failed to read element class from zarr header")?;
    let axis_order = AxisOrder::as_cxyz_from_rank(header.rank() as i32);
    let bbox = bounding_box_of(
        &header,
        &axis_order,
        "failed to read bounding box from zarr header. Make sure data is in (T/C)ZYX format",
    )?;
    let locator = mag_locator(Vec3Int::new(1, 1, 1), path, axis_order, None, credential_id);
    let segmentation = looks_like_segmentation_layer(&name, element_class);
    Ok(vec![(
        layer(
            &name,
            DataFormat::Zarr3,
            bbox,
            element_class,
            vec![locator],
            segmentation,
        ),
        unit_voxel_size(),
    )])
}
