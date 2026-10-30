//! The data source model shared with the datastore (`webknossos_common::datasource`), and what
//! only the backend does with it: loading it like DatasetService.dataSourceFor and persisting it
//! like DatasetLayerDAO.updateLayers.
use serde_json::Value;

pub(crate) use webknossos_common::datasource::{
    AdditionalAxis, CoordinateTransformation, DataLayerAttachments, DataSource, LayerAttachment,
    LayerKind, MagLocator, StaticLayer, UsableDataSource, VoxelSize,
};

use webknossos_common::enums::LayerAttachmentType;

use super::dataset_dao;
use crate::error::{ApiError, ApiResult};
use crate::util::id::ObjectId;

pub(crate) fn invalid_body(_: impl std::fmt::Display) -> ApiError {
    ApiError::bad_request(crate::msg::request::INVALID_JSON_BODY)
}

/// Deterministic replacement for Scala's `DataSource.hashCode`, stored in
/// `datasets.inboxSourceHash` so unchanged inbox reports can be skipped.
/// The case-class hash cannot be reproduced; this hashes the canonical
/// (sorted-key) JSON of the parsed data source instead. Hashes written by
/// the Scala backend therefore never match, which costs exactly one
/// rewrite per dataset on the first report after switching backends.
pub(crate) fn inbox_source_hash(source: &DataSource) -> i32 {
    use sha1::{Digest, Sha1};
    let canonical = serde_json::to_value(source)
        .and_then(|value| serde_json::to_vec(&value))
        .unwrap_or_default();
    let digest = Sha1::digest(&canonical);
    i32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]])
}

/// The same data in the usable shape, as accepted by the dataset insertion
/// helpers (voxel size and usability are passed separately).
pub(crate) fn as_usable_shape(source: &DataSource) -> UsableDataSource {
    match source {
        DataSource::Usable(s) => s.clone(),
        DataSource::Unusable(s) => UsableDataSource {
            id: s.id.clone(),
            data_layers: source.all_layers().to_vec(),
            scale: s.scale.unwrap_or(VoxelSize::from_factor_with_default_unit(
                webknossos_common::geometry::Vec3Double::new(1.0, 1.0, 1.0),
            )),
            default_view_configuration: None,
            status_opt: Some(s.status.clone()),
        },
    }
}

/// (type, attachment) in DatasetLayerAttachmentDAO.updateAttachments order.
pub(crate) fn typed_attachments(
    attachments: &DataLayerAttachments,
) -> Vec<(LayerAttachmentType, &LayerAttachment)> {
    use LayerAttachmentType as T;
    let mut result = Vec::new();
    result.extend(attachments.agglomerates.iter().map(|a| (T::Agglomerate, a)));
    result.extend(attachments.connectomes.iter().map(|a| (T::Connectome, a)));
    result.extend(
        attachments
            .segment_index
            .iter()
            .map(|a| (T::SegmentIndex, a)),
    );
    result.extend(attachments.meshes.iter().map(|a| (T::Mesh, a)));
    result.extend(attachments.cumsum.iter().map(|a| (T::Cumsum, a)));
    result.extend(
        attachments
            .segment_statistics
            .iter()
            .map(|a| (T::SegmentStatistics, a)),
    );
    result
}

/// DatasetService.dataSourceFor on a usable dataset, typed (real paths).
pub(crate) async fn load(
    pool: &sqlx::PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<UsableDataSource> {
    let rendered = crate::dataset::routes::data_source_for_rpc(pool, dataset_id, true).await?;
    UsableDataSource::from_json(&rendered).map_err(|_| ApiError::internal())
}

/// DatasetLayerDAO.updateLayers (mags, transforms, attachments and axes) in
/// the caller's transaction; pending upload mags/attachments are kept.
pub(crate) async fn write_layers(
    connection: &mut sqlx::PgConnection,
    dataset_id: &ObjectId,
    layers: &[StaticLayer],
) -> ApiResult<()> {
    let names: Vec<&str> = layers.iter().map(|l| l.name.as_str()).collect();
    dataset_dao::delete_layers_not_in(connection, dataset_id, &names).await?;
    for layer in layers {
        dataset_dao::upsert_layer(connection, dataset_id, layer).await?;
    }
    dataset_dao::delete_settled_mags(connection, dataset_id).await?;
    for layer in layers {
        for mag in &layer.mags {
            dataset_dao::insert_mag(connection, dataset_id, &layer.name, mag).await?;
        }
    }
    dataset_dao::delete_coordinate_transformations(connection, dataset_id).await?;
    for layer in layers {
        for (index, transform) in layer
            .coordinate_transformations
            .iter()
            .flatten()
            .enumerate()
        {
            // Json.toJson(None) is a JSON null, not SQL NULL.
            let rendered = serde_json::json!(transform);
            let written = |key: &str| rendered.get(key).cloned().unwrap_or(Value::Null);
            dataset_dao::insert_coordinate_transformation(
                connection,
                dataset_id,
                &layer.name,
                transform.transformation_type.as_str(),
                written("matrix"),
                written("correspondences"),
                index as i32,
            )
            .await?;
        }
    }
    dataset_dao::delete_settled_attachments(connection, dataset_id).await?;
    for layer in layers {
        for (typ, attachment) in layer.attachments.iter().flat_map(typed_attachments) {
            dataset_dao::insert_attachment(connection, dataset_id, &layer.name, typ, attachment)
                .await?;
        }
    }
    dataset_dao::delete_additional_axes(connection, dataset_id).await?;
    for layer in layers {
        for axis in layer.additional_axes.iter().flatten() {
            // AdditionalAxis.lowerBound/upperBound index into the bounds array.
            let (Some(lower), Some(upper)) = (axis.lower_bound(), axis.upper_bound()) else {
                return Err(ApiError::internal());
            };
            dataset_dao::insert_additional_axis(
                connection,
                dataset_id,
                &layer.name,
                axis,
                lower,
                upper,
            )
            .await?;
        }
    }
    Ok(())
}
