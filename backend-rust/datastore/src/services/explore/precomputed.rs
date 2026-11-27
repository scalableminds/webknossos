//! Scala `PrecomputedExplorer`.

use serde_json::Value;

use crate::{
    datareaders::precomputed::PrecomputedHeader,
    datavault::VaultPath,
    error::{DsError, DsResult},
    models::{
        AxisOrder, BoundingBox, DataLayerAttachments, LayerAttachment, Vec3Double, Vec3Int,
        VoxelSize,
        enums::{DataFormat, ElementClass, LayerAttachmentDataformat},
    },
};
use webknossos_common::explore_layers::Explored;

use super::remote_layer_explorer::{ExploreContext, layer, mag_locator};

/// Scala `PrecomputedExplorer`.
pub(super) async fn explore_precomputed(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let info_path = path.join(crate::datareaders::precomputed::header::FILENAME_INFO);
    let json = ctx
        .read_json_or(
            &info_path,
            format!("Failed to read neuroglancer precomputed metadata at {info_path}"),
        )
        .await?;
    let header: PrecomputedHeader = serde_json::from_value(json).map_err(|e| {
        DsError::failure(e.to_string()).wrap(format!(
            "Failed to read neuroglancer precomputed metadata at {info_path}"
        ))
    })?;
    let name = path.basename();
    let first = header.scales.first().ok_or_else(DsError::empty)?;
    let offset = first.voxel_offset.clone().unwrap_or_else(|| vec![0, 0, 0]);
    let size: Vec<i32> = first.size.iter().map(|s| *s as i32).collect();
    let bbox = match (offset.as_slice(), size.as_slice()) {
        ([x, y, z], [w, h, d]) => BoundingBox::new(Vec3Int::new(*x, *y, *z), *w, *h, *d),
        _ => return Err(DsError::empty()),
    };
    let element_class = match header.data_type.to_lowercase().as_str() {
        "uint8" => ElementClass::Uint8,
        "uint16" => ElementClass::Uint16,
        "uint32" => ElementClass::Uint32,
        "uint64" => ElementClass::Uint64,
        "float32" => ElementClass::Float,
        _ => {
            return Err(DsError::failure(format!(
                "Unknown data type {}",
                header.data_type
            )));
        }
    };
    let smallest = first.resolution.clone();
    let voxel_size = match smallest.as_slice() {
        [x, y, z] => Vec3Double::new(*x, *y, *z),
        _ => return Err(DsError::empty()),
    };
    let mut mags = Vec::new();
    for scale in &header.scales {
        let normalized: Vec<i32> = scale
            .resolution
            .iter()
            .zip(&smallest)
            .map(|(r, m)| (r / m) as i32)
            .collect();
        let mag = Vec3Int::from_slice(&normalized).ok_or_else(DsError::empty)?;
        mags.push(mag_locator(
            mag,
            &path.join(&scale.key),
            AxisOrder::XYZ,
            None,
            credential_id,
        ));
    }
    let mesh_path = path.join(header.mesh_path());
    let meshes = explore_precomputed_meshes(ctx, &mesh_path, credential_id).await;
    let mut explored = layer(
        &name,
        DataFormat::NeuroglancerPrecomputed,
        bbox,
        element_class,
        mags,
        header.describes_segmentation_layer(),
    );
    if header.describes_segmentation_layer() && !meshes.is_empty() {
        explored.attachments = Some(DataLayerAttachments {
            meshes,
            ..Default::default()
        });
    }
    Ok(vec![(
        explored,
        VoxelSize::from_factor_with_default_unit(voxel_size),
    )])
}

/// Scala `exploreMeshesForLayer`: a valid mesh `info` (12-element transform) adds the `mesh`
/// attachment; any failure means no meshes.
pub(super) async fn explore_precomputed_meshes(
    ctx: &ExploreContext,
    mesh_path: &VaultPath,
    credential_id: Option<&str>,
) -> Vec<LayerAttachment> {
    let Ok(info) = ctx.read_json(&mesh_path.join("info")).await else {
        return Vec::new();
    };
    let valid = info
        .get("lod_scale_multiplier")
        .is_some_and(Value::is_number)
        && info
            .get("vertex_quantization_bits")
            .is_some_and(Value::is_i64)
        && info
            .get("transform")
            .and_then(Value::as_array)
            .is_some_and(|t| t.iter().all(Value::is_number) && t.len() == 12);
    if !valid {
        return Vec::new();
    }
    vec![LayerAttachment {
        name: "mesh".into(),
        path: mesh_path.upath().clone(),
        data_format: LayerAttachmentDataformat::NeuroglancerPrecomputed,
        credential_id: credential_id.map(str::to_owned),
    }]
}
