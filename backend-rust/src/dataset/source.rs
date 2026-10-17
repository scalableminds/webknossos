//! The data source model shared with the datastore (`webknossos_common::datasource`), and what
//! only the backend does with it: loading it like DatasetService.dataSourceFor and persisting it
//! like DatasetLayerDAO.updateLayers.
use serde_json::Value;

pub(crate) use webknossos_common::datasource::{
    AdditionalAxis, CoordinateTransformation, DataLayerAttachments, DataSource, LayerAttachment,
    LayerKind, MagLocator, StaticLayer, UsableDataSource, VoxelSize,
};

use webknossos_common::enums::LayerAttachmentType;

use crate::error::{ApiError, ApiResult};

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
pub(crate) async fn load(pool: &sqlx::PgPool, dataset_id: &str) -> ApiResult<UsableDataSource> {
    let rendered = crate::dataset::routes::data_source_for_rpc(pool, dataset_id, true).await?;
    UsableDataSource::from_json(&rendered).map_err(|_| ApiError::internal())
}

/// DatasetLayerDAO.updateLayers (mags, transforms, attachments and axes) in
/// the caller's transaction; pending upload mags/attachments are kept.
pub(crate) async fn write_layers(
    connection: &mut sqlx::PgConnection,
    dataset_id: &str,
    layers: &[StaticLayer],
) -> ApiResult<()> {
    let names: Vec<&str> = layers.iter().map(|l| l.name.as_str()).collect();
    sqlx::query(
        "DELETE FROM webknossos.dataset_layers WHERE _dataset = $1 AND NOT (name = ANY($2))",
    )
    .bind(dataset_id)
    .bind(&names)
    .execute(&mut *connection)
    .await?;
    for layer in layers {
        let bbox = &layer.bounding_box;
        let top_left = bbox.top_left;
        let [x, y, z, width, height, depth] = [
            top_left.x,
            top_left.y,
            top_left.z,
            bbox.width,
            bbox.height,
            bbox.depth,
        ]
        .map(f64::from);
        let default = layer.default_view_configuration.clone().map(Value::Object);
        let admin = layer.admin_view_configuration.clone().map(Value::Object);
        let element_class = layer.element_class.as_str();
        let data_format = layer.data_format.as_str();
        let channels = layer.num_channels() as i32;
        match &layer.kind {
            LayerKind::Segmentation {
                largest_segment_id,
                mappings,
            } => {
                sqlx::query(
                    r#"INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, largestSegmentId, mappings, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES ($1, $2, 'segmentation', $3::webknossos.DATASET_LAYER_ELEMENT_CLASS, ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX, $10, $11, $12, $13, $14::webknossos.DATASET_LAYER_DATAFORMAT, $15)
                    ON CONFLICT (_dataset, name) DO UPDATE SET category = EXCLUDED.category, elementClass = EXCLUDED.elementClass,
                      boundingBox = EXCLUDED.boundingBox, largestSegmentId = EXCLUDED.largestSegmentId, mappings = EXCLUDED.mappings,
                      defaultViewConfiguration = EXCLUDED.defaultViewConfiguration, adminViewConfiguration = EXCLUDED.adminViewConfiguration,
                      numChannels = EXCLUDED.numChannels, dataFormat = EXCLUDED.dataFormat"#,
                )
                .bind(dataset_id)
                .bind(&layer.name)
                .bind(element_class)
                .bind(x)
                .bind(y)
                .bind(z)
                .bind(width)
                .bind(height)
                .bind(depth)
                .bind(largest_segment_id.map(|id| id as i64))
                .bind(mappings.clone().unwrap_or_default())
                .bind(default)
                .bind(admin)
                .bind(data_format)
                .bind(channels)
                .execute(&mut *connection)
                .await?;
            }
            LayerKind::Color => {
                sqlx::query(r#"INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES ($1, $2, 'color', $3::webknossos.DATASET_LAYER_ELEMENT_CLASS, ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX, $10, $11, $12::webknossos.DATASET_LAYER_DATAFORMAT, $13)
                    ON CONFLICT (_dataset, name) DO UPDATE SET category = EXCLUDED.category, elementClass = EXCLUDED.elementClass,
                      boundingBox = EXCLUDED.boundingBox, defaultViewConfiguration = EXCLUDED.defaultViewConfiguration,
                      adminViewConfiguration = EXCLUDED.adminViewConfiguration, numChannels = EXCLUDED.numChannels, dataFormat = EXCLUDED.dataFormat"#)
                    .bind(dataset_id).bind(&layer.name).bind(element_class)
                    .bind(x).bind(y).bind(z).bind(width).bind(height).bind(depth)
                    .bind(default).bind(admin).bind(data_format).bind(channels)
                    .execute(&mut *connection).await?;
            }
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_mags WHERE _dataset = $1 AND NOT uploadToPathIsPending AND NOT uploadIsPending")
        .bind(dataset_id).execute(&mut *connection).await?;
    for layer in layers {
        for mag in &layer.mags {
            let [mx, my, mz] = [mag.mag.x, mag.mag.y, mag.mag.z].map(f64::from);
            let path = mag.path.as_ref().map(ToString::to_string);
            let axis_order = mag.axis_order.map(|order| serde_json::json!(order));
            sqlx::query(r#"INSERT INTO webknossos.dataset_mags(_dataset, dataLayerName, mag, path, axisOrder, channelIndex, credentialId, uploadToPathIsPending, uploadIsPending)
                VALUES ($1, $2, ROW($3,$4,$5)::webknossos.VECTOR3, $6, $7, $8, $9, false, false)"#)
                .bind(dataset_id).bind(&layer.name).bind(mx).bind(my).bind(mz)
                .bind(path).bind(axis_order).bind(mag.channel_index).bind(&mag.credential_id)
                .execute(&mut *connection).await?;
        }
    }
    sqlx::query(
        "DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $1",
    )
    .bind(dataset_id)
    .execute(&mut *connection)
    .await?;
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
            sqlx::query("INSERT INTO webknossos.dataset_layer_coordinateTransformations(_dataset, layerName, type, matrix, correspondences, insertionOrderIndex) VALUES ($1, $2, $3, $4, $5, $6)")
                .bind(dataset_id).bind(&layer.name).bind(transform.transformation_type.as_str())
                .bind(written("matrix"))
                .bind(written("correspondences"))
                .bind(index as i32)
                .execute(&mut *connection).await?;
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_layer_attachments WHERE _dataset = $1 AND NOT uploadToPathIsPending AND NOT uploadIsPending")
        .bind(dataset_id).execute(&mut *connection).await?;
    for layer in layers {
        for (typ, attachment) in layer.attachments.iter().flat_map(typed_attachments) {
            sqlx::query(
                r#"INSERT INTO webknossos.dataset_layer_attachments(_dataset, layerName, name, path, type, dataFormat, credentialId, uploadToPathIsPending, uploadIsPending)
                VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, $7, false, false)"#,
            )
            .bind(dataset_id)
            .bind(&layer.name)
            .bind(&attachment.name)
            .bind(attachment.path.to_string())
            .bind(typ.as_str())
            .bind(attachment.data_format.as_str())
            .bind(&attachment.credential_id)
            .execute(&mut *connection)
            .await?;
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(&mut *connection)
        .await?;
    for layer in layers {
        for axis in layer.additional_axes.iter().flatten() {
            // AdditionalAxis.lowerBound/upperBound index into the bounds array.
            let (Some(lower), Some(upper)) = (axis.lower_bound(), axis.upper_bound()) else {
                return Err(ApiError::internal());
            };
            sqlx::query("INSERT INTO webknossos.dataset_layer_additionalAxes(_dataset, layerName, name, lowerBound, upperBound, index) VALUES ($1, $2, $3, $4, $5, $6)")
                .bind(dataset_id).bind(&layer.name).bind(&axis.name)
                .bind(lower).bind(upper).bind(axis.index)
                .execute(&mut *connection).await?;
        }
    }
    Ok(())
}
